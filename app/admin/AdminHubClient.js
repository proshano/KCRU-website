'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'

const TOKEN_STORAGE_KEY = 'kcru-admin-token'
const EMAIL_STORAGE_KEY = 'kcru-admin-email'
const LEGACY_TOKEN_KEYS = ['kcru-approval-token', 'kcru-updates-admin-token']
const LEGACY_EMAIL_KEYS = ['kcru-approval-email', 'kcru-updates-admin-email']
const EMPTY_ACCESS = { approvals: false, updates: false }

const MODULES = [
  {
    key: 'approvals',
    title: 'Study approvals',
    description: 'Review study submissions and approve changes before they go live.',
    href: '/admin/approvals',
    actionLabel: 'Open approvals',
  },
  {
    key: 'studies',
    accessKey: 'approvals',
    title: 'Study manager',
    description: 'Create and edit studies directly (publishes immediately for approval admins).',
    href: '/admin/studies',
    actionLabel: 'Open study manager',
  },
  {
    key: 'updates',
    title: 'Study update emails',
    description: 'Manage study update emails, publication newsletters, and send schedules.',
    href: '/admin/updates',
    actionLabel: 'Open updates',
  },
]

export default function AdminHubClient() {
  const [token, setToken] = useState('')
  const [email, setEmail] = useState('')
  const [passcode, setPasscode] = useState('')
  const [password, setPassword] = useState('')
  const [adminEmail, setAdminEmail] = useState('')
  const [access, setAccess] = useState(EMPTY_ACCESS)
  const [loadingAccess, setLoadingAccess] = useState(false)
  const [sendingCode, setSendingCode] = useState(false)
  const [verifyingCode, setVerifyingCode] = useState(false)
  const [verifyingPassword, setVerifyingPassword] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  useEffect(() => {
    let storedToken = sessionStorage.getItem(TOKEN_STORAGE_KEY)
    if (!storedToken) {
      storedToken = LEGACY_TOKEN_KEYS.map((key) => sessionStorage.getItem(key)).find(Boolean) || ''
      if (storedToken) {
        sessionStorage.setItem(TOKEN_STORAGE_KEY, storedToken)
      }
    }
    if (storedToken) setToken(storedToken)
    let storedEmail = sessionStorage.getItem(EMAIL_STORAGE_KEY)
    if (!storedEmail) {
      storedEmail = LEGACY_EMAIL_KEYS.map((key) => sessionStorage.getItem(key)).find(Boolean) || ''
      if (storedEmail) {
        sessionStorage.setItem(EMAIL_STORAGE_KEY, storedEmail)
      }
    }
    if (storedEmail) setEmail(storedEmail)
  }, [])

  useEffect(() => {
    if (token) {
      sessionStorage.setItem(TOKEN_STORAGE_KEY, token)
    } else {
      sessionStorage.removeItem(TOKEN_STORAGE_KEY)
    }
  }, [token])

  useEffect(() => {
    if (email) {
      sessionStorage.setItem(EMAIL_STORAGE_KEY, email)
    } else {
      sessionStorage.removeItem(EMAIL_STORAGE_KEY)
    }
  }, [email])

  const hasAccess = useMemo(() => access.approvals || access.updates, [access])

  const handleLogout = useCallback(() => {
    sessionStorage.removeItem(TOKEN_STORAGE_KEY)
    sessionStorage.removeItem(EMAIL_STORAGE_KEY)
    LEGACY_TOKEN_KEYS.forEach((key) => sessionStorage.removeItem(key))
    LEGACY_EMAIL_KEYS.forEach((key) => sessionStorage.removeItem(key))
    setToken('')
    setEmail('')
    setPasscode('')
    setPassword('')
    setAdminEmail('')
    setAccess(EMPTY_ACCESS)
    setError('')
    setSuccess('')
  }, [])

  const loadAccess = useCallback(async (activeToken = token) => {
    if (!activeToken) return
    setLoadingAccess(true)
    setError('')
    try {
      const res = await fetch('/api/admin/access', {
        headers: { Authorization: `Bearer ${activeToken}` },
      })
      const data = await res.json()
      if (!res.ok || !data?.ok) {
        if (res.status === 401) {
          handleLogout()
          return
        }
        throw new Error(data?.error || `Request failed (${res.status})`)
      }
      setAdminEmail(data.email || '')
      setAccess(data.access || EMPTY_ACCESS)
    } catch (err) {
      setError(err.message || 'Failed to load admin access.')
    } finally {
      setLoadingAccess(false)
    }
  }, [token, handleLogout])

  useEffect(() => {
    if (token) loadAccess(token)
  }, [token, loadAccess])

  async function sendPasscode(event) {
    event.preventDefault()
    setError('')
    setSuccess('')
    if (!email) {
      setError('Enter your email.')
      return
    }
    setSendingCode(true)
    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, scope: 'any' }),
      })
      const data = await res.json()
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || `Request failed (${res.status})`)
      }
      setSuccess('Passcode sent. Check your email.')
    } catch (err) {
      setError(err.message || 'Failed to send passcode.')
    } finally {
      setSendingCode(false)
    }
  }

  async function verifyPasscode(event) {
    event.preventDefault()
    setError('')
    setSuccess('')
    if (!email || !passcode) {
      setError('Enter your email and passcode.')
      return
    }
    setVerifyingCode(true)
    try {
      const res = await fetch('/api/admin/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, code: passcode, scope: 'any' }),
      })
      const data = await res.json()
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || `Request failed (${res.status})`)
      }
      setToken(data.token || '')
      setAdminEmail(data.email || '')
      setAccess(data.access || EMPTY_ACCESS)
      setSuccess('Signed in. Loading admin access...')
      setPasscode('')
    } catch (err) {
      setError(err.message || 'Failed to verify passcode.')
    } finally {
      setVerifyingCode(false)
    }
  }

  async function signInWithPassword(event) {
    event.preventDefault()
    setError('')
    setSuccess('')
    if (!email || !password) {
      setError('Enter your email and password.')
      return
    }
    setVerifyingPassword(true)
    try {
      const res = await fetch('/api/admin/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, scope: 'any' }),
      })
      const data = await res.json()
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || `Request failed (${res.status})`)
      }
      setToken(data.token || '')
      setAdminEmail(data.email || '')
      setAccess(data.access || EMPTY_ACCESS)
      setSuccess('Signed in. Loading admin access...')
      setPassword('')
      setPasscode('')
    } catch (err) {
      setError(err.message || 'Failed to verify password.')
    } finally {
      setVerifyingPassword(false)
    }
  }

  return (
    <main className="max-w-[1400px] mx-auto px-6 md:px-12 py-10 space-y-8">
      <header className="space-y-3">
        <p className="text-sm font-semibold text-purple uppercase tracking-wide">Admin Portal</p>
        <h1 className="text-3xl md:text-4xl font-bold tracking-tight">Admin Hub</h1>
        <p className="text-gray-600 max-w-2xl">
          Use a one-time passcode or your admin password to access your admin tools. You will only see sections you are authorized to use.
        </p>
      </header>

      {!token && (
        <section className="bg-white border border-black/5 rounded-xl p-5 md:p-6 shadow-sm space-y-4 max-w-xl">
          <div>
            <h2 className="text-lg font-semibold">Admin access</h2>
            <p className="text-sm text-gray-500">
              Request a one-time passcode or sign in with your admin password.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <form className="space-y-2" onSubmit={sendPasscode}>
              <label htmlFor="admin-hub-email" className="text-sm font-medium">Work email</label>
              <input
                id="admin-hub-email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@lhsc.on.ca"
                className="w-full border border-black/10 px-3 py-2 rounded focus:outline-none focus:ring-2 focus:ring-purple"
              />
              <p className="text-xs text-gray-500">
                We will send a one-time 6-digit code.
              </p>
              <button
                type="submit"
                disabled={sendingCode || !email}
                className="inline-flex items-center justify-center bg-purple text-white px-4 py-2 rounded shadow hover:bg-purple/90 disabled:opacity-60"
              >
                {sendingCode ? 'Sending...' : 'Send passcode'}
              </button>
            </form>
            <form className="space-y-2" onSubmit={verifyPasscode}>
              <label htmlFor="admin-hub-passcode" className="text-sm font-medium">Passcode</label>
              <input
                id="admin-hub-passcode"
                type="text"
                value={passcode}
                onChange={(event) => setPasscode(event.target.value)}
                placeholder="6-digit code"
                className="w-full border border-black/10 px-3 py-2 rounded focus:outline-none focus:ring-2 focus:ring-purple font-mono"
              />
              <p className="text-xs text-gray-500">
                Enter the 6-digit code from your email.
              </p>
              <button
                type="submit"
                disabled={verifyingCode || !email || !passcode}
                className="inline-flex items-center justify-center border border-purple text-purple px-4 py-2 rounded hover:bg-purple/10 disabled:opacity-60"
              >
                {verifyingCode ? 'Verifying...' : 'Verify passcode'}
              </button>
            </form>
            <form className="space-y-2 md:col-span-2" onSubmit={signInWithPassword}>
              <label htmlFor="admin-hub-password" className="text-sm font-medium">Password</label>
              <input
                id="admin-hub-password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Admin password"
                autoComplete="current-password"
                className="w-full border border-black/10 px-3 py-2 rounded focus:outline-none focus:ring-2 focus:ring-purple"
              />
              <p className="text-xs text-gray-500">
                Uses the email entered above.
              </p>
              <button
                type="submit"
                disabled={verifyingPassword || !email || !password}
                className="inline-flex items-center justify-center border border-purple text-purple px-4 py-2 rounded hover:bg-purple/10 disabled:opacity-60"
              >
                {verifyingPassword ? 'Signing in...' : 'Sign in'}
              </button>
            </form>
          </div>
          {(error || success) && (
            <div className="text-sm">
              {error && <p className="text-red-600">{error}</p>}
              {success && <p className="text-emerald-700">{success}</p>}
            </div>
          )}
        </section>
      )}

      {token && (
        <section className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">Available admin tools</h2>
              <p className="text-sm text-gray-500">
                {adminEmail ? `Signed in as ${adminEmail}.` : 'Signed in.'}
              </p>
              {!loadingAccess && !hasAccess && (
                <p className="text-sm text-amber-700">Your account does not have admin access.</p>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => loadAccess(token)}
                disabled={loadingAccess}
                className="inline-flex items-center justify-center border border-purple text-purple px-4 py-2 rounded hover:bg-purple/10 disabled:opacity-60"
              >
                {loadingAccess ? 'Refreshing...' : 'Refresh'}
              </button>
              <button
                type="button"
                onClick={handleLogout}
                className="inline-flex items-center justify-center text-sm text-gray-500 hover:text-gray-700"
              >
                Sign out
              </button>
            </div>
          </div>

          {(error || success) && (
            <div className="text-sm">
              {error && <p className="text-red-600">{error}</p>}
              {success && <p className="text-emerald-700">{success}</p>}
            </div>
          )}

          {loadingAccess ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-white border border-black/5 rounded-xl p-5 md:p-6 shadow-sm animate-pulse h-32" />
              <div className="bg-white border border-black/5 rounded-xl p-5 md:p-6 shadow-sm animate-pulse h-32" />
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {MODULES.map((module) => {
                const accessKey = module.accessKey || module.key
                const allowed = Boolean(access[accessKey])
                return (
                  <article
                    key={module.key}
                    className={`border border-black/5 rounded-xl p-5 md:p-6 shadow-sm ${
                      allowed ? 'bg-white' : 'bg-gray-50 text-gray-500'
                    }`}
                  >
                    <div className="space-y-2">
                      <h3 className={`text-xl font-semibold ${allowed ? 'text-gray-900' : 'text-gray-500'}`}>
                        {module.title}
                      </h3>
                      <p className="text-sm">{module.description}</p>
                    </div>
                    <div className="mt-4">
                      {allowed ? (
                        <Link
                          href={module.href}
                          className="inline-flex items-center justify-center bg-purple text-white px-4 py-2 rounded shadow hover:bg-purple/90"
                        >
                          {module.actionLabel}
                        </Link>
                      ) : (
                        <span className="text-xs uppercase tracking-wide text-gray-400">No access</span>
                      )}
                    </div>
                  </article>
                )
              })}
            </div>
          )}
        </section>
      )}
    </main>
  )
}
