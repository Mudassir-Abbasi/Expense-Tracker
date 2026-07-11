import { useState, useEffect, useRef, useCallback, useContext, createContext } from 'react'
import { Routes, Route, Navigate, Outlet, Link, useNavigate, useLocation } from 'react-router-dom'
import Cropper from 'react-easy-crop'
import 'react-easy-crop/react-easy-crop.css'
import './App.css'
import {
  signUp,
  signIn,
  signOutUser,
  sendResetEmail,
  onAuthChange,
  updateUsernameEmail,
  updateUserPassword,
  updateAvatar,
  authErrorMessage,
} from './services/auth'
import {
  subscribeExpenses,
  addExpense,
  updateExpense,
  deleteExpense,
} from './services/expenses'

// ── Image helpers (file → data URL, crop → JPEG data URL) ─────────────────────

const readFileAsDataUrl = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (ev) => resolve(ev.target.result)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })

const loadImage = (src) =>
  new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = src
  })

// Draws the cropped region of `image` onto a square canvas and returns a JPEG data URL.
const cropImageToDataUrl = (image, cropPixels, outputSize = 300, quality = 0.85) => {
  const canvas = document.createElement('canvas')
  canvas.width = outputSize
  canvas.height = outputSize
  const ctx = canvas.getContext('2d')
  ctx.drawImage(
    image,
    cropPixels.x, cropPixels.y, cropPixels.width, cropPixels.height,
    0, 0, outputSize, outputSize
  )
  return canvas.toDataURL('image/jpeg', quality)
}

// ── Constants ─────────────────────────────────────────────────────────────────

const CATEGORIES = ['All', 'Food', 'Travel', 'Entertainment', 'Bills', 'Shopping', 'Health', 'Other']

const CATEGORY_COLORS = {
  Food: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  Travel: 'bg-sky-50 text-sky-700 border-sky-200',
  Entertainment: 'bg-violet-50 text-violet-700 border-violet-200',
  Bills: 'bg-rose-50 text-rose-700 border-rose-200',
  Shopping: 'bg-amber-50 text-amber-700 border-amber-200',
  Health: 'bg-pink-50 text-pink-700 border-pink-200',
  Other: 'bg-stone-100 text-stone-600 border-stone-200',
}

const EMPTY_EXPENSE_FORM = { title: '', amount: '', category: 'Food', date: '' }

// Firestore documents are capped at ~1MiB. Budget ~700KB of that for the
// base64 avatar string (dataUrl.length is ~1 byte per char since it's plain
// ASCII), leaving generous headroom for the rest of the profile doc's fields.
const MAX_AVATAR_DATA_URL_LENGTH = 700 * 1024

// ── Helpers ───────────────────────────────────────────────────────────────────

const isValidEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim())

const pwStrength = (p) => {
  if (!p) return 0
  let s = 0
  if (p.length >= 6) s++
  if (p.length >= 10) s++
  if (/[A-Z]/.test(p)) s++
  if (/[0-9]/.test(p)) s++
  if (/[^A-Za-z0-9]/.test(p)) s++
  return s
}

// ── Icons ─────────────────────────────────────────────────────────────────────

const Icon = {
  Money: () => (
    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  ),
  Logout: () => (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
    </svg>
  ),
  Edit: () => (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
    </svg>
  ),
  Delete: () => (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
    </svg>
  ),
  Close: () => (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
    </svg>
  ),
  Plus: () => (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
    </svg>
  ),
  Eye: () => (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
    </svg>
  ),
  EyeOff: () => (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
    </svg>
  ),
  User: () => (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
    </svg>
  ),
  Mail: () => (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
    </svg>
  ),
  Lock: () => (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
    </svg>
  ),
  Empty: () => (
    <svg className="w-14 h-14 text-stone-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
        d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
    </svg>
  ),
  Camera: () => (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  ),
  ArrowLeft: () => (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
    </svg>
  ),
  CheckCircle: () => (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  ),
  Key: () => (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
    </svg>
  ),
}

// ── Shared components ─────────────────────────────────────────────────────────

function InputField({ label, type = 'text', value, onChange, placeholder, icon: IconComp, rightSlot, error }) {
  return (
    <div>
      {label && <label className="block text-[11px] font-bold text-stone-500 uppercase tracking-widest mb-1.5">{label}</label>}
      <div className="relative">
        {IconComp && (
          <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-stone-400 pointer-events-none">
            <IconComp />
          </span>
        )}
        <input
          type={type} value={value} onChange={onChange} placeholder={placeholder}
          className={`w-full ${IconComp ? 'pl-10' : 'pl-4'} ${rightSlot ? 'pr-10' : 'pr-4'} py-3 border rounded-lg text-sm transition focus:outline-none focus:ring-2 focus:ring-amber-500/40 focus:border-amber-500 ${error ? 'border-rose-400 bg-rose-50' : 'border-stone-300 bg-white'}`}
        />
        {rightSlot && (
          <span className="absolute right-3.5 top-1/2 -translate-y-1/2">{rightSlot}</span>
        )}
      </div>
      {error && <p className="mt-1.5 text-xs text-rose-500 font-medium">{error}</p>}
    </div>
  )
}

function PasswordStrengthBar({ password }) {
  const score = pwStrength(password)
  if (!password) return null
  const labels = ['', 'Weak', 'Fair', 'Good', 'Strong', 'Very strong']
  const colors = ['', 'bg-rose-400', 'bg-orange-400', 'bg-amber-400', 'bg-emerald-400', 'bg-emerald-500']
  const textColors = ['', 'text-rose-500', 'text-orange-500', 'text-amber-600', 'text-emerald-600', 'text-emerald-600']
  return (
    <div className="mt-2">
      <div className="flex gap-1 mb-1">
        {[1, 2, 3, 4, 5].map(i => (
          <div key={i} className={`h-1 flex-1 rounded-full transition-all duration-300 ${i <= score ? colors[score] : 'bg-stone-200'}`} />
        ))}
      </div>
      <p className={`text-xs font-semibold ${textColors[score]}`}>{labels[score]}</p>
    </div>
  )
}

function Alert({ type, children }) {
  const styles = {
    success: 'bg-emerald-50 border-emerald-200 text-emerald-700',
    error:   'bg-rose-50 border-rose-200 text-rose-600',
    info:    'bg-sky-50 border-sky-200 text-sky-700',
  }
  const icons = { success: <Icon.CheckCircle />, error: null, info: null }
  return (
    <div className={`flex items-center gap-2 px-4 py-3 rounded-lg border text-sm font-medium ${styles[type]}`}>
      {icons[type]}
      <span>{children}</span>
    </div>
  )
}

function AuthCard({ children }) {
  return (
    <div className="min-h-screen bg-stone-50 flex">
      {/* Brand panel */}
      <div className="hidden lg:flex lg:w-[44%] relative bg-stone-900 text-stone-50 flex-col justify-between p-12 overflow-hidden">
        <div
          className="absolute inset-0 opacity-[0.06] pointer-events-none"
          style={{
            backgroundImage: 'linear-gradient(to right, white 1px, transparent 1px), linear-gradient(to bottom, white 1px, transparent 1px)',
            backgroundSize: '44px 44px',
          }}
        />
        <div className="relative flex items-center gap-3">
          <div className="w-10 h-10 border border-amber-400/50 rounded-full flex items-center justify-center text-amber-400">
            <Icon.Money />
          </div>
          <span className="font-serif text-lg tracking-wide">ExpenseTracker</span>
        </div>
        <div className="relative">
          <p className="font-serif text-4xl xl:text-5xl leading-tight text-stone-50">
            Every rupee,<br />rightly accounted.
          </p>
          <p className="text-stone-400 text-sm mt-5 max-w-sm leading-relaxed">
            A calmer way to see where your money goes — track spending, spot
            patterns, and stay in control of every expense.
          </p>
        </div>
        <p className="relative text-xs text-stone-500 tracking-wide">
          &copy; {new Date().getFullYear()} ExpenseTracker
        </p>
      </div>

      {/* Form panel */}
      <div className="flex-1 flex items-center justify-center p-6 sm:p-10">
        <div className="w-full max-w-md">
          <div className="lg:hidden text-center mb-8">
            <div className="w-12 h-12 bg-stone-900 rounded-full flex items-center justify-center mx-auto mb-3 text-amber-400">
              <Icon.Money />
            </div>
            <h1 className="font-serif text-2xl text-stone-900 tracking-tight">ExpenseTracker</h1>
            <p className="text-stone-400 text-xs mt-1">Your personal finance manager</p>
          </div>
          {children}
        </div>
      </div>
    </div>
  )
}

function AvatarDisplay({ avatar, username, size = 'md', className = '' }) {
  const sizes = { sm: 'w-8 h-8 text-sm', md: 'w-10 h-10 text-sm', lg: 'w-24 h-24 text-3xl', xl: 'w-32 h-32 text-4xl' }
  const cls = `${sizes[size]} rounded-full flex items-center justify-center font-bold shrink-0 overflow-hidden ${className}`
  return avatar
    ? <img src={avatar} alt={username} className={`${cls} object-cover`} />
    : (
      <div className={`${cls} bg-gradient-to-br from-amber-400 to-amber-600 text-stone-900`}>
        {username?.charAt(0)?.toUpperCase() ?? '?'}
      </div>
    )
}

// ── Sign In ───────────────────────────────────────────────────────────────────

function SignInScreen({ onSuccess }) {
  const [form, setForm] = useState({ email: '', password: '' })
  const [errors, setErrors] = useState({})
  const [showPw, setShowPw] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const set = (k) => (e) => { setForm(p => ({ ...p, [k]: e.target.value })); setErrors(p => ({ ...p, [k]: '' })) }

  const handleSubmit = async (e) => {
    e.preventDefault()
    const errs = {}
    if (!form.email.trim()) errs.email = 'Email is required.'
    else if (!isValidEmail(form.email)) errs.email = 'Enter a valid email address.'
    if (!form.password) errs.password = 'Password is required.'
    if (Object.keys(errs).length) { setErrors(errs); return }

    setSubmitting(true)
    try {
      const user = await signIn(form.email, form.password)
      onSuccess(user)
    } catch (err) {
      if (err.code === 'auth/user-not-found') setErrors({ email: 'No account found with this email.' })
      else if (err.code === 'auth/wrong-password') setErrors({ password: 'Incorrect password.' })
      else if (err.code === 'auth/invalid-credential' || err.code === 'auth/invalid-login-credentials') {
        setErrors({ password: 'Incorrect email or password.' })
      } else {
        setErrors({ password: authErrorMessage(err) })
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AuthCard>
      <div className="mb-8">
        <p className="text-xs font-bold tracking-[0.2em] text-amber-600 uppercase mb-2">Welcome back</p>
        <h2 className="font-serif text-3xl text-stone-900">Sign in to continue</h2>
      </div>
      <form onSubmit={handleSubmit} className="space-y-5" noValidate>
        <InputField label="Email address" type="email" value={form.email} onChange={set('email')}
          placeholder="you@example.com" icon={Icon.Mail} error={errors.email} />
        <InputField label="Password" type={showPw ? 'text' : 'password'} value={form.password}
          onChange={set('password')} placeholder="Enter your password" icon={Icon.Lock} error={errors.password}
          rightSlot={
            <button type="button" onClick={() => setShowPw(p => !p)} className="text-stone-400 hover:text-stone-600" tabIndex={-1}>
              {showPw ? <Icon.EyeOff /> : <Icon.Eye />}
            </button>
          }
        />
        <div className="flex justify-end -mt-1">
          <Link to="/forgot-password"
            className="text-xs font-semibold text-stone-500 hover:text-amber-600 transition">
            Forgot password?
          </Link>
        </div>
        <button type="submit" disabled={submitting}
          className="w-full bg-stone-900 text-white py-3.5 rounded-full font-semibold hover:bg-amber-600 transition shadow-sm text-sm tracking-wide disabled:opacity-60">
          Sign In
        </button>
      </form>
      <p className="text-center text-sm text-stone-400 mt-8">
        Don&apos;t have an account?{' '}
        <Link to="/signup" className="text-stone-900 font-semibold hover:text-amber-600 transition">Create one</Link>
      </p>
    </AuthCard>
  )
}

// ── Sign Up ───────────────────────────────────────────────────────────────────

function SignUpScreen({ onSuccess }) {
  const [form, setForm] = useState({ username: '', email: '', password: '', confirm: '' })
  const [errors, setErrors] = useState({})
  const [showPw, setShowPw] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const set = (k) => (e) => { setForm(p => ({ ...p, [k]: e.target.value })); setErrors(p => ({ ...p, [k]: '' })) }

  const handleSubmit = async (e) => {
    e.preventDefault()
    const errs = {}
    if (!form.username.trim()) errs.username = 'Username is required.'
    else if (form.username.trim().length < 3) errs.username = 'Must be at least 3 characters.'
    else if (/\s/.test(form.username)) errs.username = 'No spaces allowed.'

    if (!form.email.trim()) errs.email = 'Email is required.'
    else if (!isValidEmail(form.email)) errs.email = 'Enter a valid email address.'

    if (!form.password) errs.password = 'Password is required.'
    else if (form.password.length < 6) errs.password = 'Must be at least 6 characters.'

    if (!form.confirm) errs.confirm = 'Please confirm your password.'
    else if (form.confirm !== form.password) errs.confirm = 'Passwords do not match.'

    if (Object.keys(errs).length) { setErrors(errs); return }

    setSubmitting(true)
    try {
      const user = await signUp(form.username, form.email, form.password)
      onSuccess(user)
    } catch (err) {
      if (err.code === 'app/username-taken') setErrors({ username: err.message })
      else if (err.code === 'auth/email-already-in-use') setErrors({ email: 'An account with this email already exists.' })
      else if (err.code === 'auth/weak-password') setErrors({ password: 'Must be at least 6 characters.' })
      else setErrors({ email: authErrorMessage(err) })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AuthCard>
      <div className="mb-7">
        <p className="text-xs font-bold tracking-[0.2em] text-amber-600 uppercase mb-2">Get started</p>
        <h2 className="font-serif text-3xl text-stone-900">Create your account</h2>
        <p className="text-stone-400 text-sm mt-1.5">Start tracking your expenses for free</p>
      </div>
      <form onSubmit={handleSubmit} className="space-y-5" noValidate>
        <InputField label="Username" value={form.username} onChange={set('username')}
          placeholder="e.g. johndoe" icon={Icon.User} error={errors.username} />
        <InputField label="Email address" type="email" value={form.email} onChange={set('email')}
          placeholder="you@example.com" icon={Icon.Mail} error={errors.email} />
        <div>
          <InputField label="Password" type={showPw ? 'text' : 'password'} value={form.password}
            onChange={set('password')} placeholder="Min. 6 characters" icon={Icon.Lock} error={errors.password}
            rightSlot={
              <button type="button" onClick={() => setShowPw(p => !p)} className="text-stone-400 hover:text-stone-600" tabIndex={-1}>
                {showPw ? <Icon.EyeOff /> : <Icon.Eye />}
              </button>
            }
          />
          <PasswordStrengthBar password={form.password} />
        </div>
        <InputField label="Confirm password" type={showConfirm ? 'text' : 'password'} value={form.confirm}
          onChange={set('confirm')} placeholder="Re-enter your password" icon={Icon.Lock} error={errors.confirm}
          rightSlot={
            <button type="button" onClick={() => setShowConfirm(p => !p)} className="text-stone-400 hover:text-stone-600" tabIndex={-1}>
              {showConfirm ? <Icon.EyeOff /> : <Icon.Eye />}
            </button>
          }
        />
        <button type="submit" disabled={submitting}
          className="w-full bg-stone-900 text-white py-3.5 rounded-full font-semibold hover:bg-amber-600 transition shadow-sm text-sm tracking-wide mt-1 disabled:opacity-60">
          Create Account
        </button>
      </form>
      <p className="text-center text-sm text-stone-400 mt-8">
        Already have an account?{' '}
        <Link to="/login" className="text-stone-900 font-semibold hover:text-amber-600 transition">Sign in</Link>
      </p>
    </AuthCard>
  )
}

// ── Forgot Password ───────────────────────────────────────────────────────────

function ForgotPasswordScreen() {
  const [step, setStep] = useState(1)          // 1 = enter email, 2 = check your inbox
  const [email, setEmail] = useState('')
  const [emailError, setEmailError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const handleFindAccount = async (e) => {
    e.preventDefault()
    if (!email.trim()) { setEmailError('Email is required.'); return }
    if (!isValidEmail(email)) { setEmailError('Enter a valid email address.'); return }

    setEmailError('')
    setSubmitting(true)
    try {
      await sendResetEmail(email)
      setStep(2)
    } catch (err) {
      setEmailError(authErrorMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  if (step === 2) {
    return (
      <AuthCard>
        <div className="text-center py-6">
          <div className="w-16 h-16 border border-emerald-200 bg-emerald-50 rounded-full flex items-center justify-center mx-auto mb-5 text-emerald-600">
            <Icon.CheckCircle />
          </div>
          <h2 className="font-serif text-2xl text-stone-900 mb-2">Check your inbox</h2>
          <p className="text-stone-400 text-sm mb-7">
            We&apos;ve sent a password reset link to <span className="font-semibold text-amber-600">{email}</span>.
            Follow the instructions in the email to set a new password.
          </p>
          <Link to="/login"
            className="block w-full bg-stone-900 text-white py-3.5 rounded-full font-semibold hover:bg-amber-600 transition shadow-sm text-sm text-center tracking-wide">
            Back to Sign In
          </Link>
        </div>
      </AuthCard>
    )
  }

  return (
    <AuthCard>
      <Link to="/login" className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-stone-400 hover:text-amber-600 mb-7 transition">
        <Icon.ArrowLeft /> Back to Sign In
      </Link>

      <div className="mb-7">
        <div className="w-12 h-12 border border-amber-200 bg-amber-50 rounded-full flex items-center justify-center mb-4 text-amber-600">
          <Icon.Key />
        </div>
        <h2 className="font-serif text-3xl text-stone-900">Forgot password?</h2>
        <p className="text-stone-400 text-sm mt-1.5">Enter your registered email to reset your password.</p>
      </div>
      <form onSubmit={handleFindAccount} className="space-y-5" noValidate>
        <InputField label="Registered email" type="email" value={email}
          onChange={e => { setEmail(e.target.value); setEmailError('') }}
          placeholder="you@example.com" icon={Icon.Mail} error={emailError} />
        <button type="submit" disabled={submitting}
          className="w-full bg-stone-900 text-white py-3.5 rounded-full font-semibold hover:bg-amber-600 transition shadow-sm text-sm tracking-wide disabled:opacity-60">
          Find Account
        </button>
      </form>
    </AuthCard>
  )
}

// ── Profile Page ──────────────────────────────────────────────────────────────

function ProfilePage({ currentUser, onUserUpdate }) {
  const navigate = useNavigate()
  const showToast = useToast()
  const avatar = currentUser.profileImage
  const [cropperImage, setCropperImage] = useState(null)

  // Edit profile form
  const [profile, setProfile] = useState({ username: currentUser.username, email: currentUser.email })
  const [profileErrors, setProfileErrors] = useState({})
  const [profileSuccess, setProfileSuccess] = useState('')
  const [profileSubmitting, setProfileSubmitting] = useState(false)

  // Change password form
  const [pw, setPw] = useState({ current: '', newPw: '', confirm: '' })
  const [pwErrors, setPwErrors] = useState({})
  const [pwSuccess, setPwSuccess] = useState('')
  const [pwSubmitting, setPwSubmitting] = useState(false)
  const [showCurrent, setShowCurrent] = useState(false)
  const [showNew, setShowNew] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)

  const fileRef = useRef()

  const handleFileSelect = async (e) => {
    const file = e.target.files[0]
    e.target.value = ''
    if (!file || !file.type.startsWith('image/')) return
    setCropperImage(await readFileAsDataUrl(file))
  }

  const handleCropSave = async (croppedImage) => {
    try {
      const updatedUser = await updateAvatar(currentUser.uid, croppedImage)
      onUserUpdate(updatedUser)
    } catch (err) {
      showToast(authErrorMessage(err))
    } finally {
      setCropperImage(null)
    }
  }

  const handleCropCancel = () => setCropperImage(null)

  const handleRemoveAvatar = async () => {
    try {
      const updatedUser = await updateAvatar(currentUser.uid, null)
      onUserUpdate(updatedUser)
    } catch (err) {
      showToast(authErrorMessage(err))
    }
  }

  const handleProfileSave = async (e) => {
    e.preventDefault()
    setProfileSuccess('')
    const errs = {}
    if (!profile.username.trim()) errs.username = 'Username is required.'
    else if (profile.username.trim().length < 3) errs.username = 'Must be at least 3 characters.'
    else if (/\s/.test(profile.username)) errs.username = 'No spaces allowed.'
    if (!profile.email.trim()) errs.email = 'Email is required.'
    else if (!isValidEmail(profile.email)) errs.email = 'Enter a valid email address.'
    if (Object.keys(errs).length) { setProfileErrors(errs); return }

    setProfileSubmitting(true)
    try {
      const updatedUser = await updateUsernameEmail(currentUser.uid, { username: profile.username, email: profile.email })
      onUserUpdate(updatedUser)
      setProfileErrors({})
      setProfileSuccess('Profile updated successfully!')
      setTimeout(() => setProfileSuccess(''), 4000)
    } catch (err) {
      if (err.code === 'app/username-taken') setProfileErrors({ username: err.message })
      else if (err.code === 'auth/email-already-in-use') setProfileErrors({ email: 'This email is already in use.' })
      else setProfileErrors({ email: authErrorMessage(err) })
    } finally {
      setProfileSubmitting(false)
    }
  }

  const handlePasswordSave = async (e) => {
    e.preventDefault()
    setPwSuccess('')
    const errs = {}
    if (!pw.current) errs.current = 'Current password is required.'
    if (!pw.newPw) errs.newPw = 'New password is required.'
    else if (pw.newPw.length < 6) errs.newPw = 'Must be at least 6 characters.'
    if (!pw.confirm) errs.confirm = 'Please confirm your new password.'
    else if (pw.confirm !== pw.newPw) errs.confirm = 'Passwords do not match.'
    if (Object.keys(errs).length) { setPwErrors(errs); return }
    if (pw.newPw === pw.current) { setPwErrors({ newPw: 'New password must be different from current password.' }); return }

    setPwSubmitting(true)
    try {
      await updateUserPassword(pw.current, pw.newPw)
      setPw({ current: '', newPw: '', confirm: '' })
      setPwErrors({})
      setPwSuccess('Password changed successfully!')
      setTimeout(() => setPwSuccess(''), 4000)
    } catch (err) {
      if (err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential') {
        setPwErrors({ current: 'Current password is incorrect.' })
      } else if (err.code === 'auth/weak-password') {
        setPwErrors({ newPw: 'Must be at least 6 characters.' })
      } else {
        setPwErrors({ current: authErrorMessage(err) })
      }
    } finally {
      setPwSubmitting(false)
    }
  }

  const setPField = (k) => (e) => {
    setProfile(p => ({ ...p, [k]: e.target.value }))
    setProfileErrors(p => ({ ...p, [k]: '' }))
    setProfileSuccess('')
  }
  const setPwField = (k) => (e) => {
    setPw(p => ({ ...p, [k]: e.target.value }))
    setPwErrors(p => ({ ...p, [k]: '' }))
    setPwSuccess('')
  }

  const memberSince = currentUser.createdAt
    ? new Date(currentUser.createdAt).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
    : null

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-10">
      {/* Back button */}
      <button onClick={() => navigate('/')}
        className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-stone-400 hover:text-amber-600 mb-8 transition">
        <Icon.ArrowLeft /> Back to Expenses
      </button>

      <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-8">
        {/* ── Sidebar ── */}
        <aside className="lg:sticky lg:top-8 h-fit">
          <div className="bg-white border border-stone-200 rounded-2xl p-6 text-center">
            <div className="relative w-fit mx-auto mb-4">
              <AvatarDisplay avatar={avatar} username={currentUser.username} size="xl"
                className="ring-4 ring-stone-100" />
              <button
                onClick={() => fileRef.current.click()}
                title="Change photo"
                className="absolute bottom-0 right-0 w-8 h-8 bg-stone-900 text-amber-400 rounded-full flex items-center justify-center shadow-sm hover:bg-amber-600 hover:text-white transition"
              >
                <Icon.Camera />
              </button>
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFileSelect} />
            </div>
            <h2 className="font-serif text-xl text-stone-900">{currentUser.username}</h2>
            <p className="text-stone-400 text-sm">{currentUser.email}</p>
            {memberSince && <p className="text-[11px] font-bold uppercase tracking-widest text-stone-300 mt-3">Member since {memberSince}</p>}

            <div className="flex flex-col gap-2 mt-5">
              <button onClick={() => fileRef.current.click()}
                className="w-full px-4 py-2.5 bg-stone-900 text-white text-sm font-semibold rounded-full hover:bg-amber-600 transition shadow-sm">
                {avatar ? 'Change Photo' : 'Upload Photo'}
              </button>
              {avatar && (
                <button onClick={handleRemoveAvatar}
                  className="w-full px-4 py-2.5 border border-stone-300 text-stone-500 text-sm font-semibold rounded-full hover:bg-stone-50 transition">
                  Remove Photo
                </button>
              )}
            </div>
          </div>
        </aside>

        {/* ── Main column ── */}
        <div className="space-y-8">
          {/* Edit Profile */}
          <section className="bg-white border border-stone-200 rounded-2xl p-6 sm:p-8">
            <div className="flex items-baseline gap-3 mb-6 pb-5 border-b border-stone-100">
              <span className="font-serif text-amber-600 text-sm">01</span>
              <div>
                <h3 className="font-serif text-lg text-stone-900">Edit Profile</h3>
                <p className="text-xs text-stone-400 mt-0.5">Update your username and email</p>
              </div>
            </div>

            {profileSuccess && <div className="mb-5"><Alert type="success">{profileSuccess}</Alert></div>}

            <form onSubmit={handleProfileSave} className="space-y-5" noValidate>
              <InputField label="Username" value={profile.username} onChange={setPField('username')}
                placeholder="Your username" icon={Icon.User} error={profileErrors.username} />
              <InputField label="Email address" type="email" value={profile.email} onChange={setPField('email')}
                placeholder="your@email.com" icon={Icon.Mail} error={profileErrors.email} />
              <div className="flex justify-end">
                <button type="submit" disabled={profileSubmitting}
                  className="px-6 py-2.5 bg-stone-900 text-white rounded-full font-semibold hover:bg-amber-600 transition shadow-sm text-sm tracking-wide disabled:opacity-60">
                  {profileSubmitting ? 'Saving…' : 'Save Changes'}
                </button>
              </div>
            </form>
          </section>

          {/* Change Password */}
          <section className="bg-white border border-stone-200 rounded-2xl p-6 sm:p-8">
            <div className="flex items-baseline gap-3 mb-6 pb-5 border-b border-stone-100">
              <span className="font-serif text-amber-600 text-sm">02</span>
              <div>
                <h3 className="font-serif text-lg text-stone-900">Change Password</h3>
                <p className="text-xs text-stone-400 mt-0.5">Keep your account secure</p>
              </div>
            </div>

            {pwSuccess && <div className="mb-5"><Alert type="success">{pwSuccess}</Alert></div>}

            <form onSubmit={handlePasswordSave} className="space-y-5" noValidate>
              <InputField label="Current password" type={showCurrent ? 'text' : 'password'} value={pw.current}
                onChange={setPwField('current')} placeholder="Enter current password" icon={Icon.Lock} error={pwErrors.current}
                rightSlot={
                  <button type="button" onClick={() => setShowCurrent(p => !p)} className="text-stone-400 hover:text-stone-600" tabIndex={-1}>
                    {showCurrent ? <Icon.EyeOff /> : <Icon.Eye />}
                  </button>
                }
              />
              <div>
                <InputField label="New password" type={showNew ? 'text' : 'password'} value={pw.newPw}
                  onChange={setPwField('newPw')} placeholder="Min. 6 characters" icon={Icon.Lock} error={pwErrors.newPw}
                  rightSlot={
                    <button type="button" onClick={() => setShowNew(p => !p)} className="text-stone-400 hover:text-stone-600" tabIndex={-1}>
                      {showNew ? <Icon.EyeOff /> : <Icon.Eye />}
                    </button>
                  }
                />
                <PasswordStrengthBar password={pw.newPw} />
              </div>
              <InputField label="Confirm new password" type={showConfirm ? 'text' : 'password'} value={pw.confirm}
                onChange={setPwField('confirm')} placeholder="Re-enter new password" icon={Icon.Lock} error={pwErrors.confirm}
                rightSlot={
                  <button type="button" onClick={() => setShowConfirm(p => !p)} className="text-stone-400 hover:text-stone-600" tabIndex={-1}>
                    {showConfirm ? <Icon.EyeOff /> : <Icon.Eye />}
                  </button>
                }
              />
              <div className="flex justify-end">
                <button type="submit" disabled={pwSubmitting}
                  className="px-6 py-2.5 bg-stone-900 text-white rounded-full font-semibold hover:bg-amber-600 transition shadow-sm text-sm tracking-wide disabled:opacity-60">
                  {pwSubmitting ? 'Updating…' : 'Update Password'}
                </button>
              </div>
            </form>
          </section>
        </div>
      </div>

      {cropperImage && (
        <AvatarCropperModal imageSrc={cropperImage} onCancel={handleCropCancel} onSave={handleCropSave} />
      )}
    </div>
  )
}

// ── Avatar Cropper ────────────────────────────────────────────────────────────

function AvatarCropperModal({ imageSrc, onCancel, onSave }) {
  const [crop, setCrop] = useState({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const [croppedAreaPixels, setCroppedAreaPixels] = useState(null)
  const [previewUrl, setPreviewUrl] = useState(null)
  const [saving, setSaving] = useState(false)
  const [sizeError, setSizeError] = useState('')
  const imageRef = useRef(null)

  useEffect(() => {
    let cancelled = false
    loadImage(imageSrc).then(img => { if (!cancelled) imageRef.current = img })
    return () => { cancelled = true }
  }, [imageSrc])

  const onCropComplete = useCallback((_croppedArea, pixels) => {
    setCroppedAreaPixels(pixels)
    if (imageRef.current) {
      setPreviewUrl(cropImageToDataUrl(imageRef.current, pixels, 160))
    }
  }, [])

  const handleSave = () => {
    if (!croppedAreaPixels || !imageRef.current) return
    setSizeError('')
    const finalImage = cropImageToDataUrl(imageRef.current, croppedAreaPixels, 320)
    if (finalImage.length > MAX_AVATAR_DATA_URL_LENGTH) {
      setSizeError('Image is too large — please choose a smaller photo or crop it tighter.')
      return
    }
    setSaving(true)
    onSave(finalImage)
    setSaving(false)
  }

  return (
    <div className="fixed inset-0 bg-stone-900/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl border border-stone-200 shadow-xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-5 pb-4 border-b border-stone-100">
          <h3 className="font-serif text-xl text-stone-900">Adjust Photo</h3>
          <button onClick={onCancel} className="text-stone-400 hover:text-stone-600 hover:bg-stone-100 p-1.5 rounded-full transition">
            <Icon.Close />
          </button>
        </div>

        <div className="relative w-full h-72 bg-stone-900 rounded-xl overflow-hidden">
          <Cropper
            image={imageSrc}
            crop={crop}
            zoom={zoom}
            aspect={1}
            cropShape="round"
            showGrid={false}
            onCropChange={setCrop}
            onZoomChange={setZoom}
            onCropComplete={onCropComplete}
          />
        </div>

        <div className="flex items-center gap-3 mt-4">
          <span className="text-[11px] font-bold uppercase tracking-widest text-stone-400 shrink-0">Zoom</span>
          <input type="range" min={1} max={3} step={0.01} value={zoom}
            onChange={e => setZoom(Number(e.target.value))}
            className="flex-1 accent-amber-600"
          />
        </div>

        <div className="flex items-center gap-3 mt-4">
          <div className="w-16 h-16 rounded-full overflow-hidden ring-2 ring-stone-200 shrink-0 bg-stone-100 flex items-center justify-center">
            {previewUrl
              ? <img src={previewUrl} alt="Profile preview" className="w-full h-full object-cover" />
              : <span className="w-5 h-5 border-2 border-stone-300 border-t-transparent rounded-full animate-spin" />}
          </div>
          <p className="text-xs text-stone-400">Live preview of your new profile picture</p>
        </div>

        {sizeError && <div className="mt-4"><Alert type="error">{sizeError}</Alert></div>}

        <div className="flex gap-3 pt-6">
          <button type="button" onClick={onCancel}
            className="flex-1 py-2.5 border border-stone-300 rounded-full text-sm font-semibold text-stone-600 hover:bg-stone-50 transition">
            Cancel
          </button>
          <button type="button" onClick={handleSave} disabled={saving || !croppedAreaPixels}
            className="flex-1 py-2.5 bg-stone-900 text-white rounded-full text-sm font-semibold hover:bg-amber-600 transition shadow-sm disabled:opacity-60">
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Expense Modal ─────────────────────────────────────────────────────────────

function ExpenseModal({ editingExpense, onClose, onSave }) {
  const [form, setForm] = useState(
    editingExpense
      ? { title: editingExpense.title, amount: String(editingExpense.amount), category: editingExpense.category, date: editingExpense.date }
      : EMPTY_EXPENSE_FORM
  )
  const [error, setError] = useState('')

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!form.title.trim()) { setError('Expense title is required.'); return }
    if (!form.amount || isNaN(form.amount) || Number(form.amount) <= 0) { setError('Enter a valid amount greater than 0.'); return }
    if (!form.date) { setError('Date is required.'); return }
    onSave({ ...form, amount: parseFloat(Number(form.amount).toFixed(2)) })
  }

  return (
    <div className="fixed inset-0 bg-stone-900/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl border border-stone-200 shadow-xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-6 pb-4 border-b border-stone-100">
          <h3 className="font-serif text-xl text-stone-900">{editingExpense ? 'Edit Expense' : 'Add New Expense'}</h3>
          <button onClick={onClose} className="text-stone-400 hover:text-stone-600 hover:bg-stone-100 p-1.5 rounded-full transition">
            <Icon.Close />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          {[
            { label: 'Expense Name', key: 'title', type: 'text', placeholder: 'e.g. Grocery Shopping' },
            { label: 'Amount ($)', key: 'amount', type: 'number', placeholder: '0.00', extra: { step: '0.01', min: '0' } },
          ].map(({ label, key, type, placeholder, extra }) => (
            <div key={key}>
              <label className="block text-[11px] font-bold text-stone-500 uppercase tracking-widest mb-1.5">{label}</label>
              <input type={type} value={form[key]} placeholder={placeholder} {...(extra || {})}
                onChange={e => setForm(p => ({ ...p, [key]: e.target.value }))}
                className="w-full px-4 py-2.5 border border-stone-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500/40 focus:border-amber-500 text-sm"
              />
            </div>
          ))}
          <div>
            <label className="block text-[11px] font-bold text-stone-500 uppercase tracking-widest mb-1.5">Category</label>
            <select value={form.category} onChange={e => setForm(p => ({ ...p, category: e.target.value }))}
              className="w-full px-4 py-2.5 border border-stone-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500/40 focus:border-amber-500 text-sm bg-white">
              {CATEGORIES.filter(c => c !== 'All').map(c => <option key={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-bold text-stone-500 uppercase tracking-widest mb-1.5">Date</label>
            <input type="date" value={form.date} onChange={e => setForm(p => ({ ...p, date: e.target.value }))}
              className="w-full px-4 py-2.5 border border-stone-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500/40 focus:border-amber-500 text-sm"
            />
          </div>
          {error && <Alert type="error">{error}</Alert>}
          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose}
              className="flex-1 py-2.5 border border-stone-300 rounded-full text-sm font-semibold text-stone-600 hover:bg-stone-50 transition">
              Cancel
            </button>
            <button type="submit"
              className="flex-1 py-2.5 bg-stone-900 text-white rounded-full text-sm font-semibold hover:bg-amber-600 transition shadow-sm">
              {editingExpense ? 'Update' : 'Add Expense'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Summary Card ──────────────────────────────────────────────────────────────

function SummaryCard({ label, value, accent, sub }) {
  return (
    <div className={`bg-white rounded-2xl border border-stone-200 border-t-4 p-5 ${accent}`}>
      <p className="text-[11px] font-bold text-stone-400 uppercase tracking-widest mb-2">{label}</p>
      <p className="font-serif text-3xl text-stone-900">{value}</p>
      {sub && <p className="text-xs text-stone-400 mt-1">{sub}</p>}
    </div>
  )
}

// ── Toast notifications ──────────────────────────────────────────────────────

const ToastContext = createContext(null)

function useToast() {
  return useContext(ToastContext)
}

function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])

  const dismissToast = useCallback((id) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])

  const showToast = useCallback((message) => {
    const id = Date.now() + Math.random()
    setToasts(prev => [...prev, { id, message }])
    setTimeout(() => dismissToast(id), 3000)
  }, [dismissToast])

  return (
    <ToastContext.Provider value={showToast}>
      {children}
      <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[100] flex flex-col items-center gap-2 w-full px-4 sm:w-auto pointer-events-none">
        {toasts.map(t => (
          <div key={t.id}
            className="pointer-events-auto flex items-center gap-3 bg-stone-900 border border-stone-800 shadow-lg rounded-full pl-4 pr-3 py-3 text-sm font-semibold text-white w-full sm:min-w-[320px] animate-[toast-slide-in_0.25s_ease-out]">
            <span className="text-emerald-400 shrink-0"><Icon.CheckCircle /></span>
            <span className="flex-1">{t.message}</span>
            <button onClick={() => dismissToast(t.id)} aria-label="Dismiss"
              className="text-stone-400 hover:text-white shrink-0 p-1 -m-1 rounded-full transition">
              <Icon.Close />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

// ── Navbar ────────────────────────────────────────────────────────────────────

function Navbar({ currentUser, onLogout }) {
  const isProfile = useLocation().pathname === '/profile'
  const profileLinkCls = `hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-semibold transition ${isProfile ? 'bg-amber-500 text-stone-900' : 'text-stone-300 hover:bg-stone-800'}`
  const mobileLinkCls = `sm:hidden w-9 h-9 rounded-full flex items-center justify-center transition overflow-hidden ${isProfile ? 'ring-2 ring-amber-400' : ''}`

  return (
    <nav className="bg-stone-900 sticky top-0 z-10">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3.5 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-3">
          <div className="w-9 h-9 border border-amber-400/50 rounded-full flex items-center justify-center text-amber-400">
            <Icon.Money />
          </div>
          <span className="font-serif text-lg text-stone-50 tracking-wide hidden sm:block">ExpenseTracker</span>
        </Link>
        <div className="flex items-center gap-2">
          {/* Profile link */}
          <Link to={isProfile ? '/' : '/profile'} className={profileLinkCls}>
            <AvatarDisplay avatar={currentUser.profileImage} username={currentUser.username} size="sm" />
            <div className="leading-tight text-left">
              <p className="text-sm font-semibold">{currentUser.username}</p>
              <p className={`text-xs hidden md:block ${isProfile ? 'text-stone-800' : 'text-stone-400'}`}>{currentUser.email}</p>
            </div>
          </Link>
          {/* Mobile profile link */}
          <Link to={isProfile ? '/' : '/profile'} className={mobileLinkCls}>
            <AvatarDisplay avatar={currentUser.profileImage} username={currentUser.username} size="md" />
          </Link>
          <button onClick={onLogout}
            className="flex items-center gap-2 border border-stone-700 text-stone-300 px-3 py-1.5 rounded-full text-sm font-semibold hover:bg-stone-800 hover:text-white transition">
            <Icon.Logout />
            <span className="hidden sm:inline">Logout</span>
          </button>
        </div>
      </div>
    </nav>
  )
}

// ── Protected layout ─────────────────────────────────────────────────────────

function ProtectedRoute({ currentUser }) {
  return currentUser ? <Outlet /> : <Navigate to="/login" replace />
}

function AppLayout({ currentUser, onLogout }) {
  return (
    <div className="min-h-screen bg-stone-50">
      <Navbar currentUser={currentUser} onLogout={onLogout} />
      <Outlet />
    </div>
  )
}

// ── Expenses Page ─────────────────────────────────────────────────────────────

const pad2 = (n) => String(n).padStart(2, '0')
const toDateStr = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`

const FILTER_MODES = [
  { key: 'all', label: 'All Time' },
  { key: 'month', label: 'This Month' },
  { key: 'custom', label: 'Custom Range' },
]

function ExpensesPage({ expenses, onAdd, onUpdate, onDelete }) {
  const [filterMode, setFilterMode] = useState('all') // 'all' | 'month' | 'custom'
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate]     = useState('')
  const [showModal, setShowModal] = useState(false)
  const [editingExp, setEditingExp] = useState(null)

  const now = new Date()
  const monthStart = toDateStr(new Date(now.getFullYear(), now.getMonth(), 1))
  const monthEnd   = toDateStr(new Date(now.getFullYear(), now.getMonth() + 1, 0))
  const monthLabel = now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })

  const effectiveFrom = filterMode === 'month' ? monthStart : filterMode === 'custom' ? fromDate : ''
  const effectiveTo   = filterMode === 'month' ? monthEnd   : filterMode === 'custom' ? toDate   : ''

  const openAddModal  = () => { setEditingExp(null); setShowModal(true) }
  const openEditModal = (exp) => { setEditingExp(exp); setShowModal(true) }
  const closeModal    = () => { setShowModal(false); setEditingExp(null) }
  const clearFilters  = () => { setFilterMode('all'); setFromDate(''); setToDate('') }

  const handleSave = (formData) => {
    if (editingExp) onUpdate(editingExp.id, formData)
    else onAdd(formData)
    closeModal()
  }

  const filtered = expenses.filter(e =>
    (!effectiveFrom || e.date >= effectiveFrom) && (!effectiveTo || e.date <= effectiveTo)
  )
  const totalAmount = filtered.reduce((s, e) => s + e.amount, 0)
  const hasFilters  = filterMode !== 'all'

  const topCategory = (() => {
    if (!filtered.length) return null
    const totals = {}
    filtered.forEach(e => { totals[e.category] = (totals[e.category] || 0) + e.amount })
    const [category, amount] = Object.entries(totals).sort((a, b) => b[1] - a[1])[0]
    return { category, amount }
  })()

  return (
    <main className="max-w-6xl mx-auto px-4 sm:px-6 py-10">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 mb-10 pb-6 border-b border-stone-200">
        <div>
          <p className="text-xs font-bold tracking-[0.2em] text-amber-600 uppercase mb-2">Dashboard</p>
          <h2 className="font-serif text-3xl text-stone-900">My Expenses</h2>
          <p className="text-stone-500 text-sm mt-1">Track and manage all your spending in one place</p>
        </div>
        <button onClick={openAddModal}
          className="inline-flex items-center justify-center gap-2 bg-stone-900 text-white px-5 py-3 rounded-full font-semibold hover:bg-amber-600 transition shadow-sm text-sm tracking-wide">
          <Icon.Plus /> Add Expense
        </button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        <SummaryCard label="Total Expenses" value={filtered.length} accent="border-amber-500"
          sub={hasFilters ? `of ${expenses.length} total` : undefined} />
        <SummaryCard label="Total Amount" value={`$${totalAmount.toFixed(2)}`} accent="border-emerald-500" />
        <SummaryCard label="Top Category" value={topCategory ? topCategory.category : 'No Data'} accent="border-stone-900" />
      </div>

      {/* Filters */}
      <div className="bg-white rounded-2xl border border-stone-200 p-5 mb-6">
        <div className="flex items-center justify-between flex-wrap gap-2 mb-4">
          <h3 className="text-[11px] font-bold text-stone-400 uppercase tracking-widest">Filter Expenses</h3>
          {hasFilters && (
            <button onClick={clearFilters}
              className="text-xs font-semibold text-stone-500 hover:text-amber-600 transition">
              Clear Filters
            </button>
          )}
        </div>

        {/* Mode switcher */}
        <div className="inline-flex flex-wrap gap-1 rounded-full border border-stone-200 bg-stone-100 p-1 mb-4">
          {FILTER_MODES.map(({ key, label }) => (
            <button key={key} onClick={() => setFilterMode(key)}
              className={`px-4 py-1.5 rounded-full text-sm font-semibold transition ${
                filterMode === key ? 'bg-stone-900 text-white shadow-sm' : 'text-stone-500 hover:text-stone-700'
              }`}>
              {label}
            </button>
          ))}
        </div>

        {filterMode === 'month' && (
          <p className="text-sm text-stone-600">
            Showing expenses for <span className="font-semibold text-stone-900">{monthLabel}</span>
          </p>
        )}

        {filterMode === 'custom' && (
          <>
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="flex-1">
                <label className="block text-[11px] font-bold text-stone-500 uppercase tracking-widest mb-1.5">From Date</label>
                <input type="date" value={fromDate} max={toDate || undefined} onChange={e => setFromDate(e.target.value)}
                  className="w-full px-4 py-2.5 border border-stone-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500/40 focus:border-amber-500 text-sm"
                />
              </div>
              <div className="flex-1">
                <label className="block text-[11px] font-bold text-stone-500 uppercase tracking-widest mb-1.5">To Date</label>
                <input type="date" value={toDate} min={fromDate || undefined} onChange={e => setToDate(e.target.value)}
                  className="w-full px-4 py-2.5 border border-stone-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500/40 focus:border-amber-500 text-sm"
                />
              </div>
            </div>
            {(fromDate || toDate) && (
              <div className="flex flex-wrap gap-2 mt-3">
                {fromDate && (
                  <span className="inline-flex items-center gap-1 bg-amber-50 text-amber-700 text-xs font-semibold px-3 py-1 rounded-full border border-amber-200">
                    From: {fromDate}
                    <button onClick={() => setFromDate('')} className="ml-1 hover:text-amber-900">×</button>
                  </span>
                )}
                {toDate && (
                  <span className="inline-flex items-center gap-1 bg-stone-100 text-stone-700 text-xs font-semibold px-3 py-1 rounded-full border border-stone-300">
                    To: {toDate}
                    <button onClick={() => setToDate('')} className="ml-1 hover:text-stone-900">×</button>
                  </span>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-stone-200 overflow-hidden">
        {filtered.length === 0 ? (
          <div className="text-center py-20">
            <div className="flex justify-center mb-4"><Icon.Empty /></div>
            <p className="text-stone-600 font-semibold text-lg font-serif">No expenses found</p>
            <p className="text-stone-400 text-sm mt-1">
              {hasFilters ? 'Try adjusting or clearing your date range.' : 'Click "Add Expense" to get started.'}
            </p>
            {hasFilters && (
              <button onClick={clearFilters} className="mt-4 text-amber-600 text-sm font-semibold hover:underline">
                Clear Filters
              </button>
            )}
          </div>
        ) : (
          <>
            {/* Desktop */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full">
                <thead className="bg-stone-50 border-b border-stone-200">
                  <tr>
                    {['#', 'Expense Name', 'Category', 'Date', 'Amount', 'Actions'].map(h => (
                      <th key={h} className={`px-6 py-3.5 text-[11px] font-bold text-stone-400 uppercase tracking-widest ${h === 'Amount' || h === 'Actions' ? 'text-right' : 'text-left'}`}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {filtered.map((exp, idx) => (
                    <tr key={exp.id} className="hover:bg-amber-50/40 transition-colors">
                      <td className="px-6 py-4 text-sm text-stone-400 font-mono">{idx + 1}</td>
                      <td className="px-6 py-4 font-semibold text-stone-800">{exp.title}</td>
                      <td className="px-6 py-4">
                        <span className={`inline-block px-3 py-1 rounded-full border text-xs font-bold ${CATEGORY_COLORS[exp.category] || 'bg-stone-100 text-stone-600 border-stone-200'}`}>{exp.category}</span>
                      </td>
                      <td className="px-6 py-4 text-sm text-stone-500 font-mono">{exp.date}</td>
                      <td className="px-6 py-4 text-right font-mono font-semibold text-stone-800">${exp.amount.toFixed(2)}</td>
                      <td className="px-6 py-4">
                        <div className="flex items-center justify-end gap-1">
                          <button onClick={() => openEditModal(exp)} className="p-2 text-stone-500 hover:bg-amber-100 hover:text-amber-700 rounded-full transition" title="Edit"><Icon.Edit /></button>
                          <button onClick={() => onDelete(exp.id)} className="p-2 text-stone-500 hover:bg-rose-100 hover:text-rose-600 rounded-full transition" title="Delete"><Icon.Delete /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-stone-50 border-t border-stone-200">
                  <tr>
                    <td colSpan={4} className="px-6 py-4 text-sm font-bold text-stone-600">
                      Total ({filtered.length} {filtered.length === 1 ? 'item' : 'items'})
                    </td>
                    <td className="px-6 py-4 text-right font-mono font-bold text-amber-600 text-lg">${totalAmount.toFixed(2)}</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>

            {/* Mobile */}
            <div className="md:hidden divide-y divide-stone-100">
              {filtered.map(exp => (
                <div key={exp.id} className="p-4 hover:bg-stone-50 transition">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-stone-800 truncate">{exp.title}</p>
                      <div className="flex items-center gap-2 mt-1.5">
                        <span className={`px-2.5 py-0.5 rounded-full border text-xs font-bold ${CATEGORY_COLORS[exp.category] || 'bg-stone-100 text-stone-600 border-stone-200'}`}>{exp.category}</span>
                        <span className="text-xs text-stone-400 font-mono">{exp.date}</span>
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-2 shrink-0">
                      <span className="font-mono font-semibold text-stone-800">${exp.amount.toFixed(2)}</span>
                      <div className="flex gap-1">
                        <button onClick={() => openEditModal(exp)} className="p-1.5 text-stone-500 hover:bg-amber-100 hover:text-amber-700 rounded-full transition"><Icon.Edit /></button>
                        <button onClick={() => onDelete(exp.id)} className="p-1.5 text-stone-500 hover:bg-rose-100 hover:text-rose-600 rounded-full transition"><Icon.Delete /></button>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
              <div className="px-4 py-3.5 bg-stone-50 flex justify-between items-center">
                <span className="text-sm font-bold text-stone-600">Total ({filtered.length} {filtered.length === 1 ? 'item' : 'items'})</span>
                <span className="font-mono font-bold text-amber-600">${totalAmount.toFixed(2)}</span>
              </div>
            </div>
          </>
        )}
      </div>

      {showModal && <ExpenseModal editingExpense={editingExp} onClose={closeModal} onSave={handleSave} />}
    </main>
  )
}

// ── App ───────────────────────────────────────────────────────────────────────

function AppRoutes() {
  const navigate  = useNavigate()
  const showToast = useToast()

  const [currentUser, setCurrentUser] = useState(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [expenses, setExpenses]       = useState([])

  // Subscribe to Firebase Auth session state on mount. `err` is set when a
  // signed-in Firebase Auth user's profile doc couldn't be loaded — in that
  // case the service has already forced a sign-out, and we surface a toast
  // explaining why instead of silently dropping to the login screen.
  useEffect(() => {
    const unsubscribe = onAuthChange((user, err) => {
      setCurrentUser(user)
      setAuthLoading(false)
      if (err) {
        showToast(authErrorMessage(err))
      }
    })
    return unsubscribe
  }, [showToast])

  // Subscribe to live Firestore updates for the signed-in user's expenses.
  useEffect(() => {
    if (!currentUser) { setExpenses([]); return }
    const unsubscribe = subscribeExpenses(currentUser.uid, setExpenses)
    return unsubscribe
  }, [currentUser?.uid])

  const handleLoginSuccess = (user) => {
    setCurrentUser(user)
    showToast('Login Successfully')
    navigate('/')
  }

  const handleSignupSuccess = (user) => {
    setCurrentUser(user)
    navigate('/')
  }

  const handleLogout = async () => {
    try {
      await signOutUser()
    } catch (err) {
      showToast(authErrorMessage(err))
    }
    setCurrentUser(null)
    setExpenses([])
    showToast('Logout Successfully')
    navigate('/login')
  }

  // Called by ProfilePage when the user document changes (profile, password, avatar)
  const handleUserUpdate = (updatedUser) => {
    setCurrentUser(updatedUser)
  }

  const handleAddExpense = async (formData) => {
    try {
      await addExpense(currentUser.uid, formData)
      showToast('Expense Added Successfully')
    } catch (err) {
      showToast(authErrorMessage(err))
    }
  }

  const handleUpdateExpense = async (id, formData) => {
    try {
      await updateExpense(currentUser.uid, id, formData)
      showToast('Expense Updated Successfully')
    } catch (err) {
      showToast(authErrorMessage(err))
    }
  }

  const handleDeleteExpense = async (id) => {
    try {
      await deleteExpense(currentUser.uid, id)
      showToast('Expense Deleted Successfully')
    } catch (err) {
      showToast(authErrorMessage(err))
    }
  }

  // Avoid flashing the login screen while Firebase resolves the session on first load.
  if (authLoading) {
    return <div className="min-h-screen bg-stone-50" />
  }

  return (
    <Routes>
      <Route path="/login" element={currentUser ? <Navigate to="/" replace /> : <SignInScreen onSuccess={handleLoginSuccess} />} />
      <Route path="/signup" element={currentUser ? <Navigate to="/" replace /> : <SignUpScreen onSuccess={handleSignupSuccess} />} />
      <Route path="/forgot-password" element={currentUser ? <Navigate to="/" replace /> : <ForgotPasswordScreen />} />

      <Route element={<ProtectedRoute currentUser={currentUser} />}>
        <Route element={<AppLayout currentUser={currentUser} onLogout={handleLogout} />}>
          <Route path="/" element={
            <ExpensesPage expenses={expenses} onAdd={handleAddExpense} onUpdate={handleUpdateExpense} onDelete={handleDeleteExpense} />
          } />
          <Route path="/profile" element={<ProfilePage currentUser={currentUser} onUserUpdate={handleUserUpdate} />} />
        </Route>
      </Route>

      <Route path="*" element={<Navigate to={currentUser ? '/' : '/login'} replace />} />
    </Routes>
  )
}

export default function App() {
  return (
    <ToastProvider>
      <AppRoutes />
    </ToastProvider>
  )
}
