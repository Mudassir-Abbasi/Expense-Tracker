// ── Firebase Authentication + user profile service ─────────────────────────
// All user identity/session logic lives here. Firestore holds one profile
// doc per user at users/{uid} (uid = Firebase Auth UID, no separate id),
// plus a username-registry doc at usernames/{usernameLower} used to
// enforce case-insensitive, race-free username uniqueness via security
// rules (see firestore.rules) instead of a read-then-write check.

import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  deleteUser,
  sendPasswordResetEmail,
  onAuthStateChanged,
  updateEmail,
  updatePassword,
  reauthenticateWithCredential,
  EmailAuthProvider,
} from 'firebase/auth'
import {
  doc,
  getDoc,
  updateDoc,
  serverTimestamp,
  writeBatch,
} from 'firebase/firestore'
import { auth, db } from '../firebase'

// Human-readable messages for common Firebase Auth error codes, so screens
// can drop them straight into the existing error-display UI.
const AUTH_ERROR_MESSAGES = {
  'auth/invalid-email': 'Enter a valid email address.',
  'auth/user-not-found': 'No account found with this email.',
  'auth/user-disabled': 'This account has been disabled.',
  'auth/wrong-password': 'Incorrect password.',
  'auth/invalid-credential': 'Incorrect email or password.',
  'auth/email-already-in-use': 'An account with this email already exists.',
  'auth/weak-password': 'Must be at least 6 characters.',
  'auth/too-many-requests': 'Too many attempts. Please try again later.',
  'auth/network-request-failed': 'Network error. Please check your connection and try again.',
  'auth/requires-recent-login': 'Please sign in again and retry this action.',
  'app/username-taken': 'This username is already taken.',
  'app/profile-missing': 'Your account profile could not be found. Please contact support or sign up again.',
  'app/session-restore-failed': 'Your session could not be restored. Please sign in again.',
}

export function authErrorMessage(err) {
  return AUTH_ERROR_MESSAGES[err?.code] || err?.message || 'Something went wrong. Please try again.'
}

const mapProfile = (uid, data) => ({
  uid,
  username: data.username,
  email: data.email,
  profileImage: data.profileImage ?? null,
  // Firestore Timestamp -> ISO string so existing UI code (`new Date(user.createdAt)`) keeps working unchanged.
  createdAt: data.createdAt?.toDate ? data.createdAt.toDate().toISOString() : (data.createdAt ?? null),
})

const usernameDocRef = (usernameLower) => doc(db, 'usernames', usernameLower)
const userDocRef = (uid) => doc(db, 'users', uid)

export async function getUserProfile(uid) {
  const snap = await getDoc(userDocRef(uid))
  if (!snap.exists()) return null
  return mapProfile(uid, snap.data())
}

// Best-effort rollback of a just-created Auth account. Used when the
// Firestore write that must accompany account creation fails, so we never
// leave an orphaned Auth user with no profile doc behind (see bug #2).
async function rollbackAuthUser(user) {
  try {
    await deleteUser(user)
  } catch {
    // Best effort only. If this also fails (e.g. requires-recent-login),
    // the account is orphaned but will surface cleanly via the
    // app/profile-missing path on the user's next sign-in attempt rather
    // than silently failing.
  }
}

export async function signUp(username, email, password) {
  const trimmedUsername = username.trim()
  const usernameLower = trimmedUsername.toLowerCase()
  const normalizedEmail = email.trim().toLowerCase()

  const cred = await createUserWithEmailAndPassword(auth, normalizedEmail, password)

  try {
    // Atomic, race-free username claim: the security rules reject the
    // usernames/{usernameLower} create if that doc already exists, so no
    // separate read-then-write uniqueness check is needed (fixes the
    // case-sensitivity + TOCTOU race issues in one move). Because this is
    // a single batch, if the username is taken the whole batch — including
    // the users/{uid} profile write — is rejected together.
    const batch = writeBatch(db)
    batch.set(usernameDocRef(usernameLower), { uid: cred.user.uid })
    batch.set(userDocRef(cred.user.uid), {
      username: trimmedUsername,
      email: normalizedEmail,
      profileImage: null,
      createdAt: serverTimestamp(),
    })
    await batch.commit()
  } catch (err) {
    // Whatever went wrong with the Firestore write, we must not leave a
    // valid Auth account with no profile doc behind.
    await rollbackAuthUser(cred.user)

    if (err?.code === 'permission-denied') {
      const takenErr = new Error('This username is already taken.')
      takenErr.code = 'app/username-taken'
      throw takenErr
    }
    throw err
  }

  return {
    uid: cred.user.uid,
    username: trimmedUsername,
    email: normalizedEmail,
    profileImage: null,
    createdAt: new Date().toISOString(),
  }
}

export async function signIn(email, password) {
  const normalizedEmail = email.trim().toLowerCase()
  const cred = await signInWithEmailAndPassword(auth, normalizedEmail, password)

  const profile = await getUserProfile(cred.user.uid)
  if (!profile) {
    // Auth succeeded but there's no matching profile doc — do not return
    // null as if this were a normal login (bug #1). Surface a
    // distinguishable, user-facing error instead.
    const err = new Error('Your account profile could not be found. Please contact support or sign up again.')
    err.code = 'app/profile-missing'
    throw err
  }
  return profile
}

export async function signOutUser() {
  await signOut(auth)
}

export async function sendResetEmail(email) {
  await sendPasswordResetEmail(auth, email.trim().toLowerCase())
}

// Wraps onAuthStateChanged, resolving the Firestore profile doc so the
// callback always receives (profile, error). `profile` is null whenever the
// user is signed out OR whenever their session had to be forcibly ended
// because their profile doc could not be loaded — `error` distinguishes the
// latter case so the caller can surface an explanatory message instead of
// silently rendering the login screen (bug #1).
export function onAuthChange(callback) {
  return onAuthStateChanged(auth, async (user) => {
    if (!user) {
      callback(null, null)
      return
    }
    try {
      const profile = await getUserProfile(user.uid)
      if (!profile) {
        await signOut(auth)
        const err = new Error('Your session could not be restored. Please sign in again.')
        err.code = 'app/profile-missing'
        callback(null, err)
        return
      }
      callback(profile, null)
    } catch {
      // Fetch itself failed (network/permissions/etc). Don't leave the
      // Firebase Auth session dangling while the app thinks it's logged
      // out — explicitly sign out so the two stay consistent.
      try {
        await signOut(auth)
      } catch {
        // best-effort sign-out
      }
      const err = new Error('Your session could not be restored. Please sign in again.')
      err.code = 'app/session-restore-failed'
      callback(null, err)
    }
  })
}

// `currentProfile` is the caller's already-loaded profile (React state), not
// re-fetched here — the caller always has a fresh copy by construction, and
// skipping the read shaves a full round-trip off the time-to-success-toast.
export async function updateUsernameEmail(currentProfile, { username, email }) {
  const uid = currentProfile.uid
  const trimmedUsername = username.trim()
  const usernameLower = trimmedUsername.toLowerCase()
  const normalizedEmail = email.trim().toLowerCase()

  const oldUsernameLower = currentProfile.username.trim().toLowerCase()
  const usernameChanged = oldUsernameLower !== usernameLower
  const emailChanged = normalizedEmail !== currentProfile.email

  // 1) Firestore first (bug #6). The username-registry swap is atomic and
  // race-free the same way as signUp: the create of the new
  // usernames/{usernameLower} doc is rejected by security rules if it's
  // already taken, failing the whole batch (old username doc stays intact).
  const batch = writeBatch(db)
  if (usernameChanged) {
    batch.delete(usernameDocRef(oldUsernameLower))
    batch.set(usernameDocRef(usernameLower), { uid })
  }
  batch.update(userDocRef(uid), {
    username: trimmedUsername,
    email: normalizedEmail,
  })

  try {
    await batch.commit()
  } catch (err) {
    if (err?.code === 'permission-denied' && usernameChanged) {
      const takenErr = new Error('This username is already taken.')
      takenErr.code = 'app/username-taken'
      throw takenErr
    }
    throw err
  }

  // 2) Only touch Firebase Auth once Firestore has committed successfully.
  if (emailChanged && auth.currentUser) {
    try {
      await updateEmail(auth.currentUser, normalizedEmail)
    } catch (err) {
      // Auth update failed after Firestore already changed — roll the
      // Firestore side back so the two stores don't drift out of sync.
      const rollback = writeBatch(db)
      if (usernameChanged) {
        rollback.delete(usernameDocRef(usernameLower))
        rollback.set(usernameDocRef(oldUsernameLower), { uid })
      }
      rollback.update(userDocRef(uid), {
        username: currentProfile.username,
        email: currentProfile.email,
      })
      try {
        await rollback.commit()
      } catch {
        // Best-effort rollback. If this also fails, Firestore and Auth are
        // now out of sync and will need manual reconciliation — this is
        // strictly better than silently swallowing the failure.
      }
      throw err
    }
  }

  return { ...currentProfile, username: trimmedUsername, email: normalizedEmail }
}

export async function updateUserPassword(currentPassword, newPassword) {
  const user = auth.currentUser
  if (!user) {
    const err = new Error('Not authenticated.')
    err.code = 'auth/no-current-user'
    throw err
  }
  const credential = EmailAuthProvider.credential(user.email, currentPassword)
  await reauthenticateWithCredential(user, credential)
  await updatePassword(user, newPassword)
}

export async function updateAvatar(currentProfile, dataUrl) {
  await updateDoc(userDocRef(currentProfile.uid), { profileImage: dataUrl })
  return { ...currentProfile, profileImage: dataUrl }
}
