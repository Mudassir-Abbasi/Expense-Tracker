// ── Firestore expense CRUD service ──────────────────────────────────────────
// Expenses live in the users/{uid}/expenses subcollection, ordered newest
// first by createdAt (mirrors the previous newest-added-first display order).

import {
  collection,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  query,
  orderBy,
  serverTimestamp,
} from 'firebase/firestore'
import { db } from '../firebase'

const expensesCollection = (uid) => collection(db, 'users', uid, 'expenses')

// Subscribes to live updates on a user's expenses. Returns the unsubscribe
// function so callers can clean up in a useEffect.
export function subscribeExpenses(uid, callback) {
  const q = query(expensesCollection(uid), orderBy('createdAt', 'desc'))
  return onSnapshot(q, (snap) => {
    const expenses = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
    callback(expenses)
  })
}

export async function addExpense(uid, { title, amount, category, date }) {
  await addDoc(expensesCollection(uid), {
    title,
    amount,
    category,
    date,
    createdAt: serverTimestamp(),
  })
}

export async function updateExpense(uid, expenseId, updates) {
  await updateDoc(doc(db, 'users', uid, 'expenses', expenseId), updates)
}

export async function deleteExpense(uid, expenseId) {
  await deleteDoc(doc(db, 'users', uid, 'expenses', expenseId))
}
