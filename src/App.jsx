import { useState, useEffect, useRef, useCallback, useContext, createContext } from 'react'
import { Routes, Route, Navigate, Outlet, Link, useNavigate, useLocation } from 'react-router-dom'
import Cropper from 'react-easy-crop'
import 'react-easy-crop/react-easy-crop.css'
import './App.css'

// ── LocalStorage helpers ──────────────────────────────────────────────────────
// Users (with their profileImage inline) live under one key; each user's
// expenses live under their own key, namespaced by a stable user id so
// renaming a username/email never requires migrating storage keys.

const LS = {
  getUsers: () => JSON.parse(localStorage.getItem('et_users') || '[]'),
  saveUsers: (users) => localStorage.setItem('et_users', JSON.stringify(users)),
  getUserByEmail: (email) => {
    const users = LS.getUsers()
    return users.find(u => u.email === email.trim().toLowerCase()) ?? null
  },
  getUserById: (id) => LS.getUsers().find(u => u.id === id) ?? null,
  updateUser: (id, updates) => {
    const users = LS.getUsers()
    const next = users.map(u => (u.id === id ? { ...u, ...updates } : u))
    LS.saveUsers(next)
    return next.find(u => u.id === id) ?? null
  },

  getSession: () => JSON.parse(localStorage.getItem('et_session') || 'null'),
  saveSession: (user) => localStorage.setItem('et_session', JSON.stringify(user)),
  clearSession: () => localStorage.removeItem('et_session'),

  getExpenses: (userId) => JSON.parse(localStorage.getItem(`et_expenses_${userId}`) || '[]'),
  saveExpenses: (userId, data) => localStorage.setItem(`et_expenses_${userId}`, JSON.stringify(data)),
}

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
  Food: 'bg-emerald-100 text-emerald-700',
  Travel: 'bg-blue-100 text-blue-700',
  Entertainment: 'bg-violet-100 text-violet-700',
  Bills: 'bg-red-100 text-red-700',
  Shopping: 'bg-amber-100 text-amber-700',
  Health: 'bg-pink-100 text-pink-700',
  Other: 'bg-gray-100 text-gray-600',
}

const EMPTY_EXPENSE_FORM = { title: '', amount: '', category: 'Food', date: '' }

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
    <svg className="w-14 h-14 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
  Shield: () => (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
    </svg>
  ),
}

// ── Shared components ─────────────────────────────────────────────────────────

function InputField({ label, type = 'text', value, onChange, placeholder, icon: IconComp, rightSlot, error }) {
  return (
    <div>
      {label && <label className="block text-sm font-semibold text-gray-700 mb-1.5">{label}</label>}
      <div className="relative">
        {IconComp && (
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none">
            <IconComp />
          </span>
        )}
        <input
          type={type} value={value} onChange={onChange} placeholder={placeholder}
          className={`w-full ${IconComp ? 'pl-10' : 'pl-4'} ${rightSlot ? 'pr-10' : 'pr-4'} py-3 border rounded-xl text-sm transition focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent ${error ? 'border-red-400 bg-red-50' : 'border-gray-200 bg-white'}`}
        />
        {rightSlot && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2">{rightSlot}</span>
        )}
      </div>
      {error && <p className="mt-1.5 text-xs text-red-500 font-medium">{error}</p>}
    </div>
  )
}

function PasswordStrengthBar({ password }) {
  const score = pwStrength(password)
  if (!password) return null
  const labels = ['', 'Weak', 'Fair', 'Good', 'Strong', 'Very strong']
  const colors = ['', 'bg-red-400', 'bg-orange-400', 'bg-yellow-400', 'bg-emerald-400', 'bg-emerald-500']
  const textColors = ['', 'text-red-500', 'text-orange-500', 'text-yellow-600', 'text-emerald-600', 'text-emerald-600']
  return (
    <div className="mt-2">
      <div className="flex gap-1 mb-1">
        {[1, 2, 3, 4, 5].map(i => (
          <div key={i} className={`h-1 flex-1 rounded-full transition-all duration-300 ${i <= score ? colors[score] : 'bg-gray-200'}`} />
        ))}
      </div>
      <p className={`text-xs font-semibold ${textColors[score]}`}>{labels[score]}</p>
    </div>
  )
}

function Alert({ type, children }) {
  const styles = {
    success: 'bg-emerald-50 border-emerald-200 text-emerald-700',
    error:   'bg-red-50 border-red-200 text-red-600',
    info:    'bg-blue-50 border-blue-200 text-blue-700',
  }
  const icons = { success: <Icon.CheckCircle />, error: null, info: null }
  return (
    <div className={`flex items-center gap-2 px-4 py-3 rounded-xl border text-sm font-medium ${styles[type]}`}>
      {icons[type]}
      <span>{children}</span>
    </div>
  )
}

function AuthCard({ children }) {
  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-600 via-purple-600 to-pink-500 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-6">
          <div className="w-14 h-14 bg-white/20 backdrop-blur rounded-2xl flex items-center justify-center mx-auto mb-3 text-white shadow-lg">
            <Icon.Money />
          </div>
          <h1 className="text-3xl font-bold text-white tracking-tight">ExpenseTracker</h1>
          <p className="text-white/70 text-sm mt-1">Your personal finance manager</p>
        </div>
        <div className="bg-white rounded-3xl shadow-2xl p-8">{children}</div>
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
      <div className={`${cls} bg-gradient-to-br from-indigo-400 to-purple-500 text-white`}>
        {username?.charAt(0)?.toUpperCase() ?? '?'}
      </div>
    )
}

// ── Sign In ───────────────────────────────────────────────────────────────────

function SignInScreen({ onSuccess }) {
  const [form, setForm] = useState({ email: '', password: '' })
  const [errors, setErrors] = useState({})
  const [showPw, setShowPw] = useState(false)

  const set = (k) => (e) => { setForm(p => ({ ...p, [k]: e.target.value })); setErrors(p => ({ ...p, [k]: '' })) }

  const handleSubmit = (e) => {
    e.preventDefault()
    const errs = {}
    if (!form.email.trim()) errs.email = 'Email is required.'
    else if (!isValidEmail(form.email)) errs.email = 'Enter a valid email address.'
    if (!form.password) errs.password = 'Password is required.'
    if (Object.keys(errs).length) { setErrors(errs); return }

    const match = LS.getUserByEmail(form.email.trim())
    if (!match) { setErrors({ email: 'No account found with this email.' }); return }
    if (match.password !== form.password) { setErrors({ password: 'Incorrect password.' }); return }

    LS.saveSession(match)
    onSuccess(match)
  }

  return (
    <AuthCard>
      <div className="mb-7">
        <h2 className="text-2xl font-bold text-gray-900">Welcome back</h2>
        <p className="text-gray-500 text-sm mt-1">Sign in to your account to continue</p>
      </div>
      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <InputField label="Email address" type="email" value={form.email} onChange={set('email')}
          placeholder="you@example.com" icon={Icon.Mail} error={errors.email} />
        <InputField label="Password" type={showPw ? 'text' : 'password'} value={form.password}
          onChange={set('password')} placeholder="Enter your password" icon={Icon.Lock} error={errors.password}
          rightSlot={
            <button type="button" onClick={() => setShowPw(p => !p)} className="text-gray-400 hover:text-gray-600" tabIndex={-1}>
              {showPw ? <Icon.EyeOff /> : <Icon.Eye />}
            </button>
          }
        />
        <div className="flex justify-end">
          <Link to="/forgot-password"
            className="text-sm text-indigo-600 font-semibold hover:text-indigo-800 hover:underline transition">
            Forgot password?
          </Link>
        </div>
        <button type="submit"
          className="w-full bg-gradient-to-r from-indigo-600 to-purple-600 text-white py-3 rounded-xl font-semibold hover:from-indigo-700 hover:to-purple-700 transition shadow-md hover:shadow-lg text-sm">
          Sign In
        </button>
      </form>
      <p className="text-center text-sm text-gray-500 mt-6">
        Don&apos;t have an account?{' '}
        <Link to="/signup" className="text-indigo-600 font-semibold hover:underline">Create one</Link>
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

  const set = (k) => (e) => { setForm(p => ({ ...p, [k]: e.target.value })); setErrors(p => ({ ...p, [k]: '' })) }

  const handleSubmit = (e) => {
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

    const users = LS.getUsers()
    if (users.some(u => u.email === form.email.trim().toLowerCase())) {
      setErrors({ email: 'An account with this email already exists.' }); return
    }
    if (users.some(u => u.username.toLowerCase() === form.username.trim().toLowerCase())) {
      setErrors({ username: 'This username is already taken.' }); return
    }

    const newUser = {
      id: Date.now(),
      username: form.username.trim(),
      email: form.email.trim().toLowerCase(),
      password: form.password,
      profileImage: null,
      createdAt: new Date().toISOString(),
    }
    LS.saveUsers([...users, newUser])
    LS.saveExpenses(newUser.id, [])
    LS.saveSession(newUser)
    onSuccess(newUser)
  }

  return (
    <AuthCard>
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-gray-900">Create account</h2>
        <p className="text-gray-500 text-sm mt-1">Start tracking your expenses for free</p>
      </div>
      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <InputField label="Username" value={form.username} onChange={set('username')}
          placeholder="e.g. johndoe" icon={Icon.User} error={errors.username} />
        <InputField label="Email address" type="email" value={form.email} onChange={set('email')}
          placeholder="you@example.com" icon={Icon.Mail} error={errors.email} />
        <div>
          <InputField label="Password" type={showPw ? 'text' : 'password'} value={form.password}
            onChange={set('password')} placeholder="Min. 6 characters" icon={Icon.Lock} error={errors.password}
            rightSlot={
              <button type="button" onClick={() => setShowPw(p => !p)} className="text-gray-400 hover:text-gray-600" tabIndex={-1}>
                {showPw ? <Icon.EyeOff /> : <Icon.Eye />}
              </button>
            }
          />
          <PasswordStrengthBar password={form.password} />
        </div>
        <InputField label="Confirm password" type={showConfirm ? 'text' : 'password'} value={form.confirm}
          onChange={set('confirm')} placeholder="Re-enter your password" icon={Icon.Lock} error={errors.confirm}
          rightSlot={
            <button type="button" onClick={() => setShowConfirm(p => !p)} className="text-gray-400 hover:text-gray-600" tabIndex={-1}>
              {showConfirm ? <Icon.EyeOff /> : <Icon.Eye />}
            </button>
          }
        />
        <button type="submit"
          className="w-full bg-gradient-to-r from-indigo-600 to-purple-600 text-white py-3 rounded-xl font-semibold hover:from-indigo-700 hover:to-purple-700 transition shadow-md hover:shadow-lg text-sm mt-1">
          Create Account
        </button>
      </form>
      <p className="text-center text-sm text-gray-500 mt-6">
        Already have an account?{' '}
        <Link to="/login" className="text-indigo-600 font-semibold hover:underline">Sign in</Link>
      </p>
    </AuthCard>
  )
}

// ── Forgot Password ───────────────────────────────────────────────────────────

function ForgotPasswordScreen() {
  const [step, setStep] = useState(1)          // 1 = enter email, 2 = reset password
  const [email, setEmail] = useState('')
  const [emailError, setEmailError] = useState('')
  const [form, setForm] = useState({ newPw: '', confirm: '' })
  const [errors, setErrors] = useState({})
  const [showNew, setShowNew] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [done, setDone] = useState(false)

  const handleFindAccount = (e) => {
    e.preventDefault()
    if (!email.trim()) { setEmailError('Email is required.'); return }
    if (!isValidEmail(email)) { setEmailError('Enter a valid email address.'); return }
    const user = LS.getUserByEmail(email.trim())
    if (!user) { setEmailError('No account found with this email address.'); return }
    setEmailError('')
    setStep(2)
  }

  const handleReset = (e) => {
    e.preventDefault()
    const errs = {}
    if (!form.newPw) errs.newPw = 'New password is required.'
    else if (form.newPw.length < 6) errs.newPw = 'Must be at least 6 characters.'
    if (!form.confirm) errs.confirm = 'Please confirm your password.'
    else if (form.confirm !== form.newPw) errs.confirm = 'Passwords do not match.'
    if (Object.keys(errs).length) { setErrors(errs); return }

    const user = LS.getUserByEmail(email.trim())
    LS.updateUser(user.id, { password: form.newPw })
    setDone(true)
  }

  if (done) {
    return (
      <AuthCard>
        <div className="text-center py-6">
          <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-4 text-emerald-600">
            <Icon.CheckCircle />
          </div>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Password reset!</h2>
          <p className="text-gray-500 text-sm mb-6">Your password has been updated successfully. You can now sign in with your new password.</p>
          <Link to="/login"
            className="block w-full bg-gradient-to-r from-indigo-600 to-purple-600 text-white py-3 rounded-xl font-semibold hover:from-indigo-700 hover:to-purple-700 transition shadow-md text-sm text-center">
            Back to Sign In
          </Link>
        </div>
      </AuthCard>
    )
  }

  return (
    <AuthCard>
      <Link to="/login" className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 font-medium mb-6 transition">
        <Icon.ArrowLeft /> Back to Sign In
      </Link>

      {step === 1 ? (
        <>
          <div className="mb-6">
            <div className="w-12 h-12 bg-indigo-100 rounded-xl flex items-center justify-center mb-4 text-indigo-600">
              <Icon.Key />
            </div>
            <h2 className="text-2xl font-bold text-gray-900">Forgot password?</h2>
            <p className="text-gray-500 text-sm mt-1">Enter your registered email to reset your password.</p>
          </div>
          <form onSubmit={handleFindAccount} className="space-y-4" noValidate>
            <InputField label="Registered email" type="email" value={email}
              onChange={e => { setEmail(e.target.value); setEmailError('') }}
              placeholder="you@example.com" icon={Icon.Mail} error={emailError} />
            <button type="submit"
              className="w-full bg-gradient-to-r from-indigo-600 to-purple-600 text-white py-3 rounded-xl font-semibold hover:from-indigo-700 hover:to-purple-700 transition shadow-md text-sm">
              Find Account
            </button>
          </form>
        </>
      ) : (
        <>
          <div className="mb-6">
            <div className="w-12 h-12 bg-indigo-100 rounded-xl flex items-center justify-center mb-4 text-indigo-600">
              <Icon.Shield />
            </div>
            <h2 className="text-2xl font-bold text-gray-900">Reset password</h2>
            <p className="text-gray-500 text-sm mt-1">
              Account found for <span className="font-semibold text-indigo-600">{email}</span>.
              Set your new password below.
            </p>
          </div>
          <form onSubmit={handleReset} className="space-y-4" noValidate>
            <div>
              <InputField label="New password" type={showNew ? 'text' : 'password'} value={form.newPw}
                onChange={e => { setForm(p => ({ ...p, newPw: e.target.value })); setErrors(p => ({ ...p, newPw: '' })) }}
                placeholder="Min. 6 characters" icon={Icon.Lock} error={errors.newPw}
                rightSlot={
                  <button type="button" onClick={() => setShowNew(p => !p)} className="text-gray-400 hover:text-gray-600" tabIndex={-1}>
                    {showNew ? <Icon.EyeOff /> : <Icon.Eye />}
                  </button>
                }
              />
              <PasswordStrengthBar password={form.newPw} />
            </div>
            <InputField label="Confirm new password" type={showConfirm ? 'text' : 'password'} value={form.confirm}
              onChange={e => { setForm(p => ({ ...p, confirm: e.target.value })); setErrors(p => ({ ...p, confirm: '' })) }}
              placeholder="Re-enter new password" icon={Icon.Lock} error={errors.confirm}
              rightSlot={
                <button type="button" onClick={() => setShowConfirm(p => !p)} className="text-gray-400 hover:text-gray-600" tabIndex={-1}>
                  {showConfirm ? <Icon.EyeOff /> : <Icon.Eye />}
                </button>
              }
            />
            <button type="submit"
              className="w-full bg-gradient-to-r from-indigo-600 to-purple-600 text-white py-3 rounded-xl font-semibold hover:from-indigo-700 hover:to-purple-700 transition shadow-md text-sm">
              Reset Password
            </button>
          </form>
        </>
      )}
    </AuthCard>
  )
}

// ── Profile Page ──────────────────────────────────────────────────────────────

function ProfilePage({ currentUser, onUserUpdate }) {
  const navigate = useNavigate()
  const avatar = currentUser.profileImage
  const [cropperImage, setCropperImage] = useState(null)

  // Edit profile form
  const [profile, setProfile] = useState({ username: currentUser.username, email: currentUser.email })
  const [profileErrors, setProfileErrors] = useState({})
  const [profileSuccess, setProfileSuccess] = useState('')

  // Change password form
  const [pw, setPw] = useState({ current: '', newPw: '', confirm: '' })
  const [pwErrors, setPwErrors] = useState({})
  const [pwSuccess, setPwSuccess] = useState('')
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

  const handleCropSave = (croppedImage) => {
    const updatedUser = LS.updateUser(currentUser.id, { profileImage: croppedImage })
    onUserUpdate(updatedUser)
    setCropperImage(null)
  }

  const handleCropCancel = () => setCropperImage(null)

  const handleRemoveAvatar = () => {
    const updatedUser = LS.updateUser(currentUser.id, { profileImage: null })
    onUserUpdate(updatedUser)
  }

  const handleProfileSave = (e) => {
    e.preventDefault()
    setProfileSuccess('')
    const errs = {}
    if (!profile.username.trim()) errs.username = 'Username is required.'
    else if (profile.username.trim().length < 3) errs.username = 'Must be at least 3 characters.'
    else if (/\s/.test(profile.username)) errs.username = 'No spaces allowed.'
    if (!profile.email.trim()) errs.email = 'Email is required.'
    else if (!isValidEmail(profile.email)) errs.email = 'Enter a valid email address.'
    if (Object.keys(errs).length) { setProfileErrors(errs); return }

    const newEmail = profile.email.trim().toLowerCase()
    const newUsername = profile.username.trim()
    const users = LS.getUsers()

    if (newEmail !== currentUser.email &&
      users.some(u => u.email === newEmail)) {
      setProfileErrors({ email: 'This email is already in use.' }); return
    }
    if (newUsername.toLowerCase() !== currentUser.username.toLowerCase() &&
      users.some(u => u.username.toLowerCase() === newUsername.toLowerCase())) {
      setProfileErrors({ username: 'This username is already taken.' }); return
    }

    const updatedUser = LS.updateUser(currentUser.id, { username: newUsername, email: newEmail })
    LS.saveSession(updatedUser)
    onUserUpdate(updatedUser)
    setProfileErrors({})
    setProfileSuccess('Profile updated successfully!')
    setTimeout(() => setProfileSuccess(''), 4000)
  }

  const handlePasswordSave = (e) => {
    e.preventDefault()
    setPwSuccess('')
    const errs = {}
    if (!pw.current) errs.current = 'Current password is required.'
    if (!pw.newPw) errs.newPw = 'New password is required.'
    else if (pw.newPw.length < 6) errs.newPw = 'Must be at least 6 characters.'
    if (!pw.confirm) errs.confirm = 'Please confirm your new password.'
    else if (pw.confirm !== pw.newPw) errs.confirm = 'Passwords do not match.'
    if (Object.keys(errs).length) { setPwErrors(errs); return }

    const user = LS.getUserById(currentUser.id)
    if (user.password !== pw.current) { setPwErrors({ current: 'Current password is incorrect.' }); return }
    if (pw.newPw === pw.current) { setPwErrors({ newPw: 'New password must be different from current password.' }); return }

    LS.updateUser(currentUser.id, { password: pw.newPw })
    setPw({ current: '', newPw: '', confirm: '' })
    setPwErrors({})
    setPwSuccess('Password changed successfully!')
    setTimeout(() => setPwSuccess(''), 4000)
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
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-8">
      {/* Back button */}
      <button onClick={() => navigate('/')}
        className="flex items-center gap-2 text-sm text-gray-500 hover:text-indigo-600 font-semibold mb-6 transition">
        <Icon.ArrowLeft /> Back to Expenses
      </button>

      {/* ── Profile hero ── */}
      <div className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden mb-6">
        {/* Banner */}
        <div className="h-28 bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500" />
        {/* Avatar + info */}
        <div className="px-6 pb-6">
          <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 -mt-12 mb-4">
            <div className="relative w-fit">
              <AvatarDisplay avatar={avatar} username={currentUser.username} size="xl"
                className="ring-4 ring-white shadow-lg" />
              <button
                onClick={() => fileRef.current.click()}
                title="Change photo"
                className="absolute bottom-1 right-1 w-8 h-8 bg-indigo-600 text-white rounded-full flex items-center justify-center shadow-md hover:bg-indigo-700 transition"
              >
                <Icon.Camera />
              </button>
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFileSelect} />
            </div>
            <div className="flex gap-2 mb-1">
              <button onClick={() => fileRef.current.click()}
                className="px-4 py-2 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700 transition shadow-sm">
                {avatar ? 'Change Photo' : 'Upload Photo'}
              </button>
              {avatar && (
                <button onClick={handleRemoveAvatar}
                  className="px-4 py-2 border border-gray-200 text-gray-600 text-sm font-semibold rounded-xl hover:bg-gray-50 transition">
                  Remove
                </button>
              )}
            </div>
          </div>
          <h2 className="text-xl font-bold text-gray-900">{currentUser.username}</h2>
          <p className="text-gray-500 text-sm">{currentUser.email}</p>
          {memberSince && <p className="text-gray-400 text-xs mt-1">Member since {memberSince}</p>}
        </div>
      </div>

      {/* ── Edit Profile ── */}
      <div className="bg-white rounded-3xl shadow-sm border border-gray-100 p-6 mb-6">
        <div className="flex items-center gap-3 mb-5">
          <div className="w-9 h-9 bg-indigo-100 rounded-xl flex items-center justify-center text-indigo-600">
            <Icon.User />
          </div>
          <div>
            <h3 className="font-bold text-gray-900">Edit Profile</h3>
            <p className="text-xs text-gray-400">Update your username and email</p>
          </div>
        </div>

        {profileSuccess && <div className="mb-4"><Alert type="success">{profileSuccess}</Alert></div>}

        <form onSubmit={handleProfileSave} className="space-y-4" noValidate>
          <InputField label="Username" value={profile.username} onChange={setPField('username')}
            placeholder="Your username" icon={Icon.User} error={profileErrors.username} />
          <InputField label="Email address" type="email" value={profile.email} onChange={setPField('email')}
            placeholder="your@email.com" icon={Icon.Mail} error={profileErrors.email} />
          <div className="flex justify-end">
            <button type="submit"
              className="px-6 py-2.5 bg-gradient-to-r from-indigo-600 to-purple-600 text-white rounded-xl font-semibold hover:from-indigo-700 hover:to-purple-700 transition shadow-md text-sm">
              Save Changes
            </button>
          </div>
        </form>
      </div>

      {/* ── Change Password ── */}
      <div className="bg-white rounded-3xl shadow-sm border border-gray-100 p-6">
        <div className="flex items-center gap-3 mb-5">
          <div className="w-9 h-9 bg-indigo-100 rounded-xl flex items-center justify-center text-indigo-600">
            <Icon.Shield />
          </div>
          <div>
            <h3 className="font-bold text-gray-900">Change Password</h3>
            <p className="text-xs text-gray-400">Keep your account secure</p>
          </div>
        </div>

        {pwSuccess && <div className="mb-4"><Alert type="success">{pwSuccess}</Alert></div>}

        <form onSubmit={handlePasswordSave} className="space-y-4" noValidate>
          <InputField label="Current password" type={showCurrent ? 'text' : 'password'} value={pw.current}
            onChange={setPwField('current')} placeholder="Enter current password" icon={Icon.Lock} error={pwErrors.current}
            rightSlot={
              <button type="button" onClick={() => setShowCurrent(p => !p)} className="text-gray-400 hover:text-gray-600" tabIndex={-1}>
                {showCurrent ? <Icon.EyeOff /> : <Icon.Eye />}
              </button>
            }
          />
          <div>
            <InputField label="New password" type={showNew ? 'text' : 'password'} value={pw.newPw}
              onChange={setPwField('newPw')} placeholder="Min. 6 characters" icon={Icon.Lock} error={pwErrors.newPw}
              rightSlot={
                <button type="button" onClick={() => setShowNew(p => !p)} className="text-gray-400 hover:text-gray-600" tabIndex={-1}>
                  {showNew ? <Icon.EyeOff /> : <Icon.Eye />}
                </button>
              }
            />
            <PasswordStrengthBar password={pw.newPw} />
          </div>
          <InputField label="Confirm new password" type={showConfirm ? 'text' : 'password'} value={pw.confirm}
            onChange={setPwField('confirm')} placeholder="Re-enter new password" icon={Icon.Lock} error={pwErrors.confirm}
            rightSlot={
              <button type="button" onClick={() => setShowConfirm(p => !p)} className="text-gray-400 hover:text-gray-600" tabIndex={-1}>
                {showConfirm ? <Icon.EyeOff /> : <Icon.Eye />}
              </button>
            }
          />
          <div className="flex justify-end">
            <button type="submit"
              className="px-6 py-2.5 bg-gradient-to-r from-indigo-600 to-purple-600 text-white rounded-xl font-semibold hover:from-indigo-700 hover:to-purple-700 transition shadow-md text-sm">
              Update Password
            </button>
          </div>
        </form>
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
    setSaving(true)
    const finalImage = cropImageToDataUrl(imageRef.current, croppedAreaPixels, 320)
    onSave(finalImage)
    setSaving(false)
  }

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-xl font-bold text-gray-900">Adjust Photo</h3>
          <button onClick={onCancel} className="text-gray-400 hover:text-gray-600 hover:bg-gray-100 p-1.5 rounded-lg transition">
            <Icon.Close />
          </button>
        </div>

        <div className="relative w-full h-72 bg-gray-900 rounded-2xl overflow-hidden">
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
          <span className="text-xs font-semibold text-gray-500 shrink-0">Zoom</span>
          <input type="range" min={1} max={3} step={0.01} value={zoom}
            onChange={e => setZoom(Number(e.target.value))}
            className="flex-1 accent-indigo-600"
          />
        </div>

        <div className="flex items-center gap-3 mt-4">
          <div className="w-16 h-16 rounded-full overflow-hidden ring-2 ring-gray-200 shrink-0 bg-gray-100 flex items-center justify-center">
            {previewUrl
              ? <img src={previewUrl} alt="Profile preview" className="w-full h-full object-cover" />
              : <span className="w-5 h-5 border-2 border-gray-300 border-t-transparent rounded-full animate-spin" />}
          </div>
          <p className="text-xs text-gray-400">Live preview of your new profile picture</p>
        </div>

        <div className="flex gap-3 pt-5">
          <button type="button" onClick={onCancel}
            className="flex-1 py-2.5 border border-gray-200 rounded-xl text-sm font-semibold text-gray-600 hover:bg-gray-50 transition">
            Cancel
          </button>
          <button type="button" onClick={handleSave} disabled={saving || !croppedAreaPixels}
            className="flex-1 py-2.5 bg-gradient-to-r from-indigo-600 to-purple-600 text-white rounded-xl text-sm font-semibold hover:from-indigo-700 hover:to-purple-700 transition shadow-md disabled:opacity-60">
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
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-xl font-bold text-gray-900">{editingExpense ? 'Edit Expense' : 'Add New Expense'}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 hover:bg-gray-100 p-1.5 rounded-lg transition">
            <Icon.Close />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          {[
            { label: 'Expense Name', key: 'title', type: 'text', placeholder: 'e.g. Grocery Shopping' },
            { label: 'Amount ($)', key: 'amount', type: 'number', placeholder: '0.00', extra: { step: '0.01', min: '0' } },
          ].map(({ label, key, type, placeholder, extra }) => (
            <div key={key}>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">{label}</label>
              <input type={type} value={form[key]} placeholder={placeholder} {...(extra || {})}
                onChange={e => setForm(p => ({ ...p, [key]: e.target.value }))}
                className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm"
              />
            </div>
          ))}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1.5">Category</label>
            <select value={form.category} onChange={e => setForm(p => ({ ...p, category: e.target.value }))}
              className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm bg-white">
              {CATEGORIES.filter(c => c !== 'All').map(c => <option key={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1.5">Date</label>
            <input type="date" value={form.date} onChange={e => setForm(p => ({ ...p, date: e.target.value }))}
              className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm"
            />
          </div>
          {error && <Alert type="error">{error}</Alert>}
          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose}
              className="flex-1 py-2.5 border border-gray-200 rounded-xl text-sm font-semibold text-gray-600 hover:bg-gray-50 transition">
              Cancel
            </button>
            <button type="submit"
              className="flex-1 py-2.5 bg-gradient-to-r from-indigo-600 to-purple-600 text-white rounded-xl text-sm font-semibold hover:from-indigo-700 hover:to-purple-700 transition shadow-md">
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
    <div className={`bg-white rounded-2xl shadow-sm p-5 border-l-4 ${accent}`}>
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">{label}</p>
      <p className="text-2xl font-bold text-gray-800">{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
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
            className="pointer-events-auto flex items-center gap-3 bg-white border border-emerald-200 shadow-lg rounded-2xl pl-4 pr-3 py-3 text-sm font-semibold text-gray-800 w-full sm:min-w-[320px] animate-[toast-slide-in_0.25s_ease-out]">
            <span className="text-emerald-500 shrink-0"><Icon.CheckCircle /></span>
            <span className="flex-1">{t.message}</span>
            <button onClick={() => dismissToast(t.id)} aria-label="Dismiss"
              className="text-gray-300 hover:text-gray-500 shrink-0 p-1 -m-1 rounded-lg transition">
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
  const profileLinkCls = `hidden sm:flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-semibold transition ${isProfile ? 'bg-indigo-100 text-indigo-700' : 'text-gray-600 hover:bg-gray-100'}`
  const mobileLinkCls = `sm:hidden w-9 h-9 rounded-xl flex items-center justify-center transition overflow-hidden ${isProfile ? 'ring-2 ring-indigo-500' : ''}`

  return (
    <nav className="bg-white border-b border-gray-200 sticky top-0 z-10 shadow-sm">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-3">
          <div className="w-9 h-9 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-xl flex items-center justify-center text-white shadow">
            <Icon.Money />
          </div>
          <span className="text-lg font-bold text-gray-900 hidden sm:block">ExpenseTracker</span>
        </Link>
        <div className="flex items-center gap-2">
          {/* Profile link */}
          <Link to={isProfile ? '/' : '/profile'} className={profileLinkCls}>
            <AvatarDisplay avatar={currentUser.profileImage} username={currentUser.username} size="sm" />
            <div className="leading-tight text-left">
              <p className="text-sm font-semibold text-gray-800">{currentUser.username}</p>
              <p className="text-xs text-gray-400 hidden md:block">{currentUser.email}</p>
            </div>
          </Link>
          {/* Mobile profile link */}
          <Link to={isProfile ? '/' : '/profile'} className={mobileLinkCls}>
            <AvatarDisplay avatar={currentUser.profileImage} username={currentUser.username} size="md" />
          </Link>
          <button onClick={onLogout}
            className="flex items-center gap-2 bg-red-50 text-red-600 border border-red-200 px-3 py-2 rounded-xl text-sm font-semibold hover:bg-red-100 transition">
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
    <div className="min-h-screen bg-gray-50">
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
    <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">My Expenses</h2>
          <p className="text-gray-500 text-sm mt-0.5">Track and manage all your spending in one place</p>
        </div>
        <button onClick={openAddModal}
          className="inline-flex items-center justify-center gap-2 bg-gradient-to-r from-indigo-600 to-purple-600 text-white px-5 py-2.5 rounded-xl font-semibold hover:from-indigo-700 hover:to-purple-700 transition shadow-md hover:shadow-lg text-sm">
          <Icon.Plus /> Add Expense
        </button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        <SummaryCard label="Total Expenses" value={filtered.length} accent="border-indigo-500"
          sub={hasFilters ? `of ${expenses.length} total` : undefined} />
        <SummaryCard label="Total Amount" value={`$${totalAmount.toFixed(2)}`} accent="border-emerald-500" />
        <SummaryCard label="Top Category" value={topCategory ? topCategory.category : 'No Data'} accent="border-purple-500" />
      </div>

      {/* Filters */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 mb-6">
        <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
          <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest">Filter Expenses</h3>
          {hasFilters && (
            <button onClick={clearFilters}
              className="text-xs font-semibold text-gray-500 hover:text-indigo-600 transition">
              Clear Filters
            </button>
          )}
        </div>

        {/* Mode switcher */}
        <div className="inline-flex flex-wrap gap-1 rounded-xl border border-gray-200 bg-gray-50 p-1 mb-4">
          {FILTER_MODES.map(({ key, label }) => (
            <button key={key} onClick={() => setFilterMode(key)}
              className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition ${
                filterMode === key ? 'bg-white text-indigo-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}>
              {label}
            </button>
          ))}
        </div>

        {filterMode === 'month' && (
          <p className="text-sm text-gray-600">
            Showing expenses for <span className="font-semibold text-gray-800">{monthLabel}</span>
          </p>
        )}

        {filterMode === 'custom' && (
          <>
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="flex-1">
                <label className="block text-xs font-semibold text-gray-500 mb-1">From Date</label>
                <input type="date" value={fromDate} max={toDate || undefined} onChange={e => setFromDate(e.target.value)}
                  className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-400 text-sm"
                />
              </div>
              <div className="flex-1">
                <label className="block text-xs font-semibold text-gray-500 mb-1">To Date</label>
                <input type="date" value={toDate} min={fromDate || undefined} onChange={e => setToDate(e.target.value)}
                  className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-400 text-sm"
                />
              </div>
            </div>
            {(fromDate || toDate) && (
              <div className="flex flex-wrap gap-2 mt-3">
                {fromDate && (
                  <span className="inline-flex items-center gap-1 bg-indigo-50 text-indigo-700 text-xs font-semibold px-3 py-1 rounded-full border border-indigo-200">
                    From: {fromDate}
                    <button onClick={() => setFromDate('')} className="ml-1 hover:text-indigo-900">×</button>
                  </span>
                )}
                {toDate && (
                  <span className="inline-flex items-center gap-1 bg-purple-50 text-purple-700 text-xs font-semibold px-3 py-1 rounded-full border border-purple-200">
                    To: {toDate}
                    <button onClick={() => setToDate('')} className="ml-1 hover:text-purple-900">×</button>
                  </span>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        {filtered.length === 0 ? (
          <div className="text-center py-20">
            <div className="flex justify-center mb-4"><Icon.Empty /></div>
            <p className="text-gray-600 font-semibold text-lg">No expenses found</p>
            <p className="text-gray-400 text-sm mt-1">
              {hasFilters ? 'Try adjusting or clearing your date range.' : 'Click "Add Expense" to get started.'}
            </p>
            {hasFilters && (
              <button onClick={clearFilters} className="mt-4 text-indigo-600 text-sm font-semibold hover:underline">
                Clear Filters
              </button>
            )}
          </div>
        ) : (
          <>
            {/* Desktop */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 border-b border-gray-100">
                  <tr>
                    {['#', 'Expense Name', 'Category', 'Date', 'Amount', 'Actions'].map(h => (
                      <th key={h} className={`px-6 py-3.5 text-xs font-bold text-gray-400 uppercase tracking-wide ${h === 'Amount' || h === 'Actions' ? 'text-right' : 'text-left'}`}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {filtered.map((exp, idx) => (
                    <tr key={exp.id} className="hover:bg-indigo-50/30 transition-colors">
                      <td className="px-6 py-4 text-sm text-gray-400 font-medium">{idx + 1}</td>
                      <td className="px-6 py-4 font-semibold text-gray-800">{exp.title}</td>
                      <td className="px-6 py-4">
                        <span className={`inline-block px-3 py-1 rounded-full text-xs font-bold ${CATEGORY_COLORS[exp.category] || 'bg-gray-100 text-gray-600'}`}>{exp.category}</span>
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-500">{exp.date}</td>
                      <td className="px-6 py-4 text-right font-bold text-gray-800">${exp.amount.toFixed(2)}</td>
                      <td className="px-6 py-4">
                        <div className="flex items-center justify-end gap-1">
                          <button onClick={() => openEditModal(exp)} className="p-2 text-indigo-600 hover:bg-indigo-100 rounded-lg transition" title="Edit"><Icon.Edit /></button>
                          <button onClick={() => onDelete(exp.id)} className="p-2 text-red-500 hover:bg-red-100 rounded-lg transition" title="Delete"><Icon.Delete /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-gray-50 border-t border-gray-200">
                  <tr>
                    <td colSpan={4} className="px-6 py-4 text-sm font-bold text-gray-600">
                      Total ({filtered.length} {filtered.length === 1 ? 'item' : 'items'})
                    </td>
                    <td className="px-6 py-4 text-right font-bold text-indigo-700 text-lg">${totalAmount.toFixed(2)}</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>

            {/* Mobile */}
            <div className="md:hidden divide-y divide-gray-100">
              {filtered.map(exp => (
                <div key={exp.id} className="p-4 hover:bg-gray-50 transition">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-gray-800 truncate">{exp.title}</p>
                      <div className="flex items-center gap-2 mt-1.5">
                        <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold ${CATEGORY_COLORS[exp.category] || 'bg-gray-100 text-gray-600'}`}>{exp.category}</span>
                        <span className="text-xs text-gray-400">{exp.date}</span>
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-2 shrink-0">
                      <span className="font-bold text-gray-800">${exp.amount.toFixed(2)}</span>
                      <div className="flex gap-1">
                        <button onClick={() => openEditModal(exp)} className="p-1.5 text-indigo-600 hover:bg-indigo-100 rounded-lg transition"><Icon.Edit /></button>
                        <button onClick={() => onDelete(exp.id)} className="p-1.5 text-red-500 hover:bg-red-100 rounded-lg transition"><Icon.Delete /></button>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
              <div className="px-4 py-3.5 bg-gray-50 flex justify-between items-center">
                <span className="text-sm font-bold text-gray-600">Total ({filtered.length} {filtered.length === 1 ? 'item' : 'items'})</span>
                <span className="font-bold text-indigo-700">${totalAmount.toFixed(2)}</span>
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

  const [currentUser, setCurrentUser] = useState(() => LS.getSession())
  const [expenses, setExpenses]       = useState(() => currentUser ? LS.getExpenses(currentUser.id) : [])

  // Persist expenses whenever they change
  useEffect(() => {
    if (currentUser) LS.saveExpenses(currentUser.id, expenses)
  }, [expenses, currentUser])

  const handleLoginSuccess = (user) => {
    setCurrentUser(user)
    setExpenses(LS.getExpenses(user.id))
    showToast('Login Successfully')
    navigate('/')
  }

  const handleSignupSuccess = (user) => {
    setCurrentUser(user)
    setExpenses([])
    navigate('/')
  }

  const handleLogout = () => {
    LS.clearSession()
    setCurrentUser(null)
    setExpenses([])
    showToast('Logout Successfully')
    navigate('/login')
  }

  // Called by ProfilePage when the user document changes (profile, password, avatar)
  const handleUserUpdate = (updatedUser) => {
    setCurrentUser(updatedUser)
  }

  const handleAddExpense = (formData) => {
    setExpenses(prev => [{ id: Date.now(), ...formData }, ...prev])
    showToast('Expense Added Successfully')
  }

  const handleUpdateExpense = (id, formData) => {
    setExpenses(prev => prev.map(e => e.id === id ? { ...e, ...formData } : e))
    showToast('Expense Updated Successfully')
  }

  const handleDeleteExpense = (id) => {
    setExpenses(prev => prev.filter(e => e.id !== id))
    showToast('Expense Deleted Successfully')
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
