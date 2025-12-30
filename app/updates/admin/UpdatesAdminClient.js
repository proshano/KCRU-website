'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

const TOKEN_STORAGE_KEY = 'kcru-admin-token'
const EMAIL_STORAGE_KEY = 'kcru-admin-email'
const LEGACY_TOKEN_KEYS = ['kcru-updates-admin-token', 'kcru-approval-token']
const LEGACY_EMAIL_KEYS = ['kcru-updates-admin-email', 'kcru-approval-email']

const DEFAULT_SETTINGS = {
  subjectTemplate: '',
  introText: '',
  emptyIntroText: '',
  outroText: '',
  signature: '',
  maxStudies: '',
}

function formatDate(value) {
  if (!value) return 'Not sent yet'
  try {
    return new Date(value).toLocaleString()
  } catch (error) {
    return value
  }
}

function formatCount(value) {
  const num = Number(value)
  return Number.isFinite(num) ? num : 0
}

export default function UpdatesAdminClient() {
  const [token, setToken] = useState('')
  const [email, setEmail] = useState('')
  const [passcode, setPasscode] = useState('')
  const [adminEmail, setAdminEmail] = useState('')
  const [sendingCode, setSendingCode] = useState(false)
  const [verifyingCode, setVerifyingCode] = useState(false)
  const [sendingNow, setSendingNow] = useState(false)
  const [sendingForce, setSendingForce] = useState(false)
  const [savingSettings, setSavingSettings] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [stats, setStats] = useState({
    total: 0,
    active: 0,
    optedIn: 0,
    eligible: 0,
    lastSentAt: null,
  })
  const [settings, setSettings] = useState(DEFAULT_SETTINGS)

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

  async function loadAdminData(activeToken = token) {
    if (!activeToken) return
    setLoading(true)
    setError('')
    setSuccess('')
    try {
      const res = await fetch('/api/updates/admin', {
        headers: { Authorization: `Bearer ${activeToken}` },
      })
      const data = await res.json()
      if (!res.ok || !data?.ok) {
        if (res.status === 401) {
          handleLogout()
        }
        throw new Error(data?.error || `Request failed (${res.status})`)
      }
      setAdminEmail(data.adminEmail || '')
      setStats(data.stats || {})
      const nextSettings = data.settings || {}
      setSettings({
        subjectTemplate: nextSettings.subjectTemplate || '',
        introText: nextSettings.introText || '',
        emptyIntroText: nextSettings.emptyIntroText || '',
        outroText: nextSettings.outroText || '',
        signature: nextSettings.signature || '',
        maxStudies: nextSettings.maxStudies ? String(nextSettings.maxStudies) : '',
      })
    } catch (err) {
      setError(err.message || 'Failed to load study update admin data.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (token) loadAdminData(token)
  }, [token])

  function handleLogout() {
    sessionStorage.removeItem(TOKEN_STORAGE_KEY)
    sessionStorage.removeItem(EMAIL_STORAGE_KEY)
    LEGACY_TOKEN_KEYS.forEach((key) => sessionStorage.removeItem(key))
    LEGACY_EMAIL_KEYS.forEach((key) => sessionStorage.removeItem(key))
    setToken('')
    setEmail('')
    setPasscode('')
    setAdminEmail('')
    setStats({ total: 0, active: 0, optedIn: 0, eligible: 0, lastSentAt: null })
    setSettings(DEFAULT_SETTINGS)
    setError('')
    setSuccess('')
  }

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
        body: JSON.stringify({ email }),
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
        body: JSON.stringify({ email, code: passcode }),
      })
      const data = await res.json()
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || `Request failed (${res.status})`)
      }
      setToken(data.token || '')
      setSuccess('Signed in. Loading study update admin...')
      setPasscode('')
    } catch (err) {
      setError(err.message || 'Failed to verify passcode.')
    } finally {
      setVerifyingCode(false)
    }
  }

  async function handleSend({ force }) {
    if (!token) return
    setError('')
    setSuccess('')
    if (force) {
      setSendingForce(true)
    } else {
      setSendingNow(true)
    }
    try {
      const res = await fetch('/api/updates/admin/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ force }),
      })
      const data = await res.json()
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || `Request failed (${res.status})`)
      }
      const statsPayload = data?.stats || {}
      const sent = formatCount(statsPayload.sent)
      const total = formatCount(statsPayload.total)
      const errors = formatCount(statsPayload.errors)
      setSuccess(
        errors
          ? `Study updates sent with errors: ${sent} of ${total} delivered (${errors} failed).`
          : `Study updates sent: ${sent} of ${total} delivered.`
      )
      await loadAdminData(token)
    } catch (err) {
      setError(err.message || 'Failed to send study updates.')
    } finally {
      setSendingNow(false)
      setSendingForce(false)
    }
  }

  function updateSetting(field, value) {
    setSettings((prev) => ({ ...prev, [field]: value }))
  }

  async function saveSettings(event) {
    event.preventDefault()
    if (!token) return
    setError('')
    setSuccess('')
    setSavingSettings(true)
    try {
      const payload = {
        subjectTemplate: settings.subjectTemplate,
        introText: settings.introText,
        emptyIntroText: settings.emptyIntroText,
        outroText: settings.outroText,
        signature: settings.signature,
        maxStudies: settings.maxStudies ? Number(settings.maxStudies) : null,
      }
      const res = await fetch('/api/updates/admin', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || `Request failed (${res.status})`)
      }
      const nextSettings = data.settings || {}
      setSettings({
        subjectTemplate: nextSettings.subjectTemplate || '',
        introText: nextSettings.introText || '',
        emptyIntroText: nextSettings.emptyIntroText || '',
        outroText: nextSettings.outroText || '',
        signature: nextSettings.signature || '',
        maxStudies: nextSettings.maxStudies ? String(nextSettings.maxStudies) : '',
      })
      setSuccess('Email settings saved.')
    } catch (err) {
      setError(err.message || 'Failed to save settings.')
    } finally {
      setSavingSettings(false)
    }
  }

  return (
    <main className="max-w-[1400px] mx-auto px-6 md:px-12 py-10 space-y-8">
      <header className="space-y-3">
        <p className="text-sm font-semibold text-purple uppercase tracking-wide">Admin Portal</p>
        <h1 className="text-3xl md:text-4xl font-bold tracking-tight">Study Update Emails</h1>
        <p className="text-gray-600 max-w-2xl">
          Manage monthly study update emails, review subscriber counts, and send updates on demand.
        </p>
        {token && (
          <div className="flex flex-wrap items-center gap-3 text-sm text-gray-500">
            <span className="text-xs uppercase tracking-wide text-gray-400">Admin links</span>
            <Link href="/trials/approvals" className="hover:text-gray-700">
              Study approvals
            </Link>
            <Link href="/updates/admin" className="text-purple font-medium">
              Study update emails
            </Link>
          </div>
        )}
      </header>

      {!token && (
        <section className="bg-white border border-black/5 rounded-xl p-5 md:p-6 shadow-sm space-y-4 max-w-xl">
          <div>
            <h2 className="text-lg font-semibold">Admin access</h2>
            <p className="text-sm text-gray-500">
              Request a one-time passcode to sign in.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <form className="space-y-2" onSubmit={sendPasscode}>
              <label htmlFor="updates-admin-email" className="text-sm font-medium">Work email</label>
              <input
                id="updates-admin-email"
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
              <label htmlFor="updates-admin-passcode" className="text-sm font-medium">Passcode</label>
              <input
                id="updates-admin-passcode"
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
        <section className="space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">Overview</h2>
              <p className="text-sm text-gray-500">
                Eligible subscribers this month: {formatCount(stats.eligible)}
              </p>
              {adminEmail && <p className="text-sm text-gray-500">Signed in as {adminEmail}.</p>}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => loadAdminData(token)}
                disabled={loading}
                className="inline-flex items-center justify-center border border-purple text-purple px-4 py-2 rounded hover:bg-purple/10 disabled:opacity-60"
              >
                {loading ? 'Refreshing...' : 'Refresh'}
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

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-white border border-black/5 rounded-xl p-4 shadow-sm">
              <p className="text-xs uppercase tracking-wide text-gray-500">Total subscribers</p>
              <p className="text-2xl font-semibold">{formatCount(stats.total)}</p>
            </div>
            <div className="bg-white border border-black/5 rounded-xl p-4 shadow-sm">
              <p className="text-xs uppercase tracking-wide text-gray-500">Active + opted in</p>
              <p className="text-2xl font-semibold">{formatCount(stats.optedIn)}</p>
            </div>
            <div className="bg-white border border-black/5 rounded-xl p-4 shadow-sm">
              <p className="text-xs uppercase tracking-wide text-gray-500">Last sent</p>
              <p className="text-sm font-medium text-gray-700">{formatDate(stats.lastSentAt)}</p>
            </div>
          </div>

          <section className="bg-white border border-black/5 rounded-xl p-5 md:p-6 shadow-sm space-y-4">
            <div>
              <h3 className="text-lg font-semibold">Send study updates</h3>
              <p className="text-sm text-gray-500">
                “Send now” respects the monthly send window. “Force send” ignores the monthly limit.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => handleSend({ force: false })}
                disabled={sendingNow}
                className="inline-flex items-center justify-center bg-purple text-white px-4 py-2 rounded shadow hover:bg-purple/90 disabled:opacity-60"
              >
                {sendingNow ? 'Sending...' : 'Send now'}
              </button>
              <button
                type="button"
                onClick={() => handleSend({ force: true })}
                disabled={sendingForce}
                className="inline-flex items-center justify-center border border-red-500 text-red-600 px-4 py-2 rounded hover:bg-red-50 disabled:opacity-60"
              >
                {sendingForce ? 'Sending...' : 'Force send'}
              </button>
            </div>
          </section>

          <section className="bg-white border border-black/5 rounded-xl p-5 md:p-6 shadow-sm space-y-4">
            <div>
              <h3 className="text-lg font-semibold">Email settings</h3>
              <p className="text-sm text-gray-500">
                Update the subject line and the short copy shown above and below the study list.
              </p>
            </div>
            <form className="space-y-4" onSubmit={saveSettings}>
              <div>
                <label htmlFor="updates-subject-template" className="text-sm font-medium">Subject template</label>
                <input
                  id="updates-subject-template"
                  type="text"
                  value={settings.subjectTemplate}
                  onChange={(event) => updateSetting('subjectTemplate', event.target.value)}
                  placeholder="Monthly study updates - {{month}}"
                  className="w-full border border-black/10 px-3 py-2 rounded focus:outline-none focus:ring-2 focus:ring-purple"
                />
                <p className="text-xs text-gray-500">Use <span className="font-mono">{'{{month}}'}</span> for the month label.</p>
              </div>
              <div>
                <label htmlFor="updates-intro" className="text-sm font-medium">Intro text</label>
                <textarea
                  id="updates-intro"
                  value={settings.introText}
                  onChange={(event) => updateSetting('introText', event.target.value)}
                  rows={2}
                  placeholder="Here are this month's studies that may be relevant to your patients."
                  className="w-full border border-black/10 px-3 py-2 rounded focus:outline-none focus:ring-2 focus:ring-purple"
                />
              </div>
              <div>
                <label htmlFor="updates-empty-intro" className="text-sm font-medium">Empty-state intro</label>
                <textarea
                  id="updates-empty-intro"
                  value={settings.emptyIntroText}
                  onChange={(event) => updateSetting('emptyIntroText', event.target.value)}
                  rows={2}
                  placeholder="There are no recruiting studies to share right now."
                  className="w-full border border-black/10 px-3 py-2 rounded focus:outline-none focus:ring-2 focus:ring-purple"
                />
              </div>
              <div>
                <label htmlFor="updates-outro" className="text-sm font-medium">Closing text</label>
                <textarea
                  id="updates-outro"
                  value={settings.outroText}
                  onChange={(event) => updateSetting('outroText', event.target.value)}
                  rows={2}
                  placeholder="Thank you for supporting active study referrals."
                  className="w-full border border-black/10 px-3 py-2 rounded focus:outline-none focus:ring-2 focus:ring-purple"
                />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="updates-signature" className="text-sm font-medium">Signature</label>
                  <input
                    id="updates-signature"
                    type="text"
                    value={settings.signature}
                    onChange={(event) => updateSetting('signature', event.target.value)}
                    placeholder="London Kidney Clinical Research"
                    className="w-full border border-black/10 px-3 py-2 rounded focus:outline-none focus:ring-2 focus:ring-purple"
                  />
                </div>
                <div>
                  <label htmlFor="updates-max-studies" className="text-sm font-medium">Max studies per email</label>
                  <input
                    id="updates-max-studies"
                    type="number"
                    min="1"
                    max="12"
                    value={settings.maxStudies}
                    onChange={(event) => updateSetting('maxStudies', event.target.value)}
                    placeholder="4"
                    className="w-full border border-black/10 px-3 py-2 rounded focus:outline-none focus:ring-2 focus:ring-purple"
                  />
                </div>
              </div>
              <button
                type="submit"
                disabled={savingSettings}
                className="inline-flex items-center justify-center bg-purple text-white px-4 py-2 rounded shadow hover:bg-purple/90 disabled:opacity-60"
              >
                {savingSettings ? 'Saving...' : 'Save settings'}
              </button>
            </form>
          </section>
        </section>
      )}
    </main>
  )
}
