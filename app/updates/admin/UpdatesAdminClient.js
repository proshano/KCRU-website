'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { INTEREST_AREA_OPTIONS, ROLE_OPTIONS, SPECIALTY_OPTIONS } from '@/lib/communicationOptions'

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
  sendEmpty: false,
}

const DEFAULT_PUBLICATION_SETTINGS = {
  subjectTemplate: '',
  introText: '',
  emptyIntroText: '',
  outroText: '',
  signature: '',
  windowMode: 'rolling_days',
  windowDays: '',
  maxPublications: '',
  sendEmpty: false,
}

const DEFAULT_CUSTOM_FILTERS = {
  roles: [],
  specialties: [],
  interestAreas: [],
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
  const pathname = usePathname()
  const prefersAdmin = pathname.startsWith('/admin')
  const approvalsPath = prefersAdmin ? '/admin/approvals' : '/trials/approvals'
  const updatesPath = prefersAdmin ? '/admin/updates' : '/updates/admin'
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
  const [lastSendResult, setLastSendResult] = useState(null)
  const [stats, setStats] = useState({
    total: 0,
    active: 0,
    optedIn: 0,
    eligible: 0,
    lastSentAt: null,
  })
  const [settings, setSettings] = useState(DEFAULT_SETTINGS)
  const [publicationStats, setPublicationStats] = useState({
    total: 0,
    active: 0,
    optedIn: 0,
    eligible: 0,
    lastSentAt: null,
  })
  const [publicationSettings, setPublicationSettings] = useState(DEFAULT_PUBLICATION_SETTINGS)
  const [loadingPublications, setLoadingPublications] = useState(false)
  const [savingPublicationSettings, setSavingPublicationSettings] = useState(false)
  const [sendingPublicationNow, setSendingPublicationNow] = useState(false)
  const [sendingPublicationForce, setSendingPublicationForce] = useState(false)
  const [publicationLastSendResult, setPublicationLastSendResult] = useState(null)
  const [customSubject, setCustomSubject] = useState('')
  const [customMessage, setCustomMessage] = useState('')
  const [customSignature, setCustomSignature] = useState('')
  const [customFilters, setCustomFilters] = useState(DEFAULT_CUSTOM_FILTERS)
  const [customAudienceCount, setCustomAudienceCount] = useState(null)
  const [customSending, setCustomSending] = useState(false)
  const [customPreviewing, setCustomPreviewing] = useState(false)
  const [customStatus, setCustomStatus] = useState({ type: 'idle', message: '' })

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

  const handleLogout = useCallback(() => {
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
    setPublicationStats({ total: 0, active: 0, optedIn: 0, eligible: 0, lastSentAt: null })
    setPublicationSettings(DEFAULT_PUBLICATION_SETTINGS)
    setPublicationLastSendResult(null)
    setLoadingPublications(false)
    setSavingPublicationSettings(false)
    setSendingPublicationNow(false)
    setSendingPublicationForce(false)
    setCustomSubject('')
    setCustomMessage('')
    setCustomSignature('')
    setCustomFilters(DEFAULT_CUSTOM_FILTERS)
    setCustomAudienceCount(null)
    setCustomSending(false)
    setCustomPreviewing(false)
    setCustomStatus({ type: 'idle', message: '' })
    setError('')
    setSuccess('')
    setLastSendResult(null)
  }, [])

  const loadAdminData = useCallback(async (activeToken = token) => {
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
        sendEmpty: Boolean(nextSettings.sendEmpty),
      })
    } catch (err) {
      setError(err.message || 'Failed to load study update admin data.')
    } finally {
      setLoading(false)
    }
  }, [token, handleLogout])

  const loadPublicationAdminData = useCallback(async (activeToken = token) => {
    if (!activeToken) return
    setLoadingPublications(true)
    setError('')
    setSuccess('')
    try {
      const res = await fetch('/api/updates/publication-newsletter/admin', {
        headers: { Authorization: `Bearer ${activeToken}` },
      })
      const data = await res.json()
      if (!res.ok || !data?.ok) {
        if (res.status === 401) {
          handleLogout()
        }
        throw new Error(data?.error || `Request failed (${res.status})`)
      }
      setPublicationStats(data.stats || {})
      const nextSettings = data.settings || {}
      setPublicationSettings({
        subjectTemplate: nextSettings.subjectTemplate || '',
        introText: nextSettings.introText || '',
        emptyIntroText: nextSettings.emptyIntroText || '',
        outroText: nextSettings.outroText || '',
        signature: nextSettings.signature || '',
        windowMode: nextSettings.windowMode || 'rolling_days',
        windowDays: nextSettings.windowDays ? String(nextSettings.windowDays) : '',
        maxPublications: nextSettings.maxPublications ? String(nextSettings.maxPublications) : '',
        sendEmpty: Boolean(nextSettings.sendEmpty),
      })
      setCustomSignature((prev) => prev || nextSettings.signature || '')
    } catch (err) {
      setError(err.message || 'Failed to load publication newsletter data.')
    } finally {
      setLoadingPublications(false)
    }
  }, [token, handleLogout])

  useEffect(() => {
    if (token) {
      loadAdminData(token)
      loadPublicationAdminData(token)
    }
  }, [token, loadAdminData, loadPublicationAdminData])

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
        body: JSON.stringify({ email, scope: 'updates' }),
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
        body: JSON.stringify({ email, code: passcode, scope: 'updates' }),
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
    setLastSendResult(null)
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
      const summaryMessage = errors
        ? `Study updates sent with errors: ${sent} of ${total} delivered (${errors} failed).`
        : `Study updates sent: ${sent} of ${total} delivered.`
      setSuccess(summaryMessage)
      setLastSendResult({
        at: new Date().toISOString(),
        sent,
        total,
        errors,
        force,
        summaryMessage,
      })
      await loadAdminData(token)
    } catch (err) {
      setError(err.message || 'Failed to send study updates.')
    } finally {
      setSendingNow(false)
      setSendingForce(false)
    }
  }

  async function handlePublicationSend({ force }) {
    if (!token) return
    setError('')
    setSuccess('')
    setPublicationLastSendResult(null)
    if (force) {
      setSendingPublicationForce(true)
    } else {
      setSendingPublicationNow(true)
    }
    try {
      const res = await fetch('/api/updates/publication-newsletter/send', {
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
      const summaryMessage = errors
        ? `Publication newsletter sent with errors: ${sent} of ${total} delivered (${errors} failed).`
        : `Publication newsletter sent: ${sent} of ${total} delivered.`
      setSuccess(summaryMessage)
      setPublicationLastSendResult({
        at: new Date().toISOString(),
        sent,
        total,
        errors,
        force,
        summaryMessage,
      })
      await loadPublicationAdminData(token)
    } catch (err) {
      setError(err.message || 'Failed to send publication newsletter.')
    } finally {
      setSendingPublicationNow(false)
      setSendingPublicationForce(false)
    }
  }

  function updateSetting(field, value) {
    setSettings((prev) => ({ ...prev, [field]: value }))
  }

  function updatePublicationSetting(field, value) {
    setPublicationSettings((prev) => ({ ...prev, [field]: value }))
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
        sendEmpty: Boolean(settings.sendEmpty),
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
        sendEmpty: Boolean(nextSettings.sendEmpty),
      })
      setSuccess('Email settings saved.')
    } catch (err) {
      setError(err.message || 'Failed to save settings.')
    } finally {
      setSavingSettings(false)
    }
  }

  async function savePublicationSettings(event) {
    event.preventDefault()
    if (!token) return
    setError('')
    setSuccess('')
    setSavingPublicationSettings(true)
    try {
      const payload = {
        subjectTemplate: publicationSettings.subjectTemplate,
        introText: publicationSettings.introText,
        emptyIntroText: publicationSettings.emptyIntroText,
        outroText: publicationSettings.outroText,
        signature: publicationSettings.signature,
        windowMode: publicationSettings.windowMode,
        windowDays: publicationSettings.windowDays ? Number(publicationSettings.windowDays) : null,
        maxPublications: publicationSettings.maxPublications ? Number(publicationSettings.maxPublications) : null,
        sendEmpty: Boolean(publicationSettings.sendEmpty),
      }
      const res = await fetch('/api/updates/publication-newsletter/admin', {
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
      setPublicationSettings({
        subjectTemplate: nextSettings.subjectTemplate || '',
        introText: nextSettings.introText || '',
        emptyIntroText: nextSettings.emptyIntroText || '',
        outroText: nextSettings.outroText || '',
        signature: nextSettings.signature || '',
        windowMode: nextSettings.windowMode || 'rolling_days',
        windowDays: nextSettings.windowDays ? String(nextSettings.windowDays) : '',
        maxPublications: nextSettings.maxPublications ? String(nextSettings.maxPublications) : '',
        sendEmpty: Boolean(nextSettings.sendEmpty),
      })
      setCustomSignature((prev) => prev || nextSettings.signature || '')
      setSuccess('Publication newsletter settings saved.')
    } catch (err) {
      setError(err.message || 'Failed to save publication newsletter settings.')
    } finally {
      setSavingPublicationSettings(false)
    }
  }

  function toggleCustomFilter(key, value) {
    setCustomFilters((prev) => {
      const set = new Set(prev[key] || [])
      if (set.has(value)) {
        set.delete(value)
      } else {
        set.add(value)
      }
      return { ...prev, [key]: Array.from(set) }
    })
  }

  function toggleCustomInterestArea(value) {
    setCustomFilters((prev) => {
      const set = new Set(prev.interestAreas || [])
      if (set.has(value)) {
        set.delete(value)
      } else {
        set.add(value)
      }

      if (set.has('all') && value !== 'all') {
        set.delete('all')
      }

      if (value === 'all' && set.has('all')) {
        return { ...prev, interestAreas: ['all'] }
      }

      return { ...prev, interestAreas: Array.from(set) }
    })
  }

  async function previewCustomAudience() {
    if (!token) return
    setCustomPreviewing(true)
    setCustomStatus({ type: 'idle', message: '' })
    try {
      const res = await fetch('/api/updates/custom-newsletter', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ dryRun: true, filters: customFilters }),
      })
      const data = await res.json()
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || `Request failed (${res.status})`)
      }
      setCustomAudienceCount(formatCount(data?.count))
      setCustomStatus({
        type: 'success',
        message: `Audience size: ${formatCount(data?.count)} subscribers.`,
      })
    } catch (err) {
      setCustomStatus({ type: 'error', message: err.message || 'Failed to preview audience.' })
    } finally {
      setCustomPreviewing(false)
    }
  }

  async function sendCustomNewsletter() {
    if (!token) return
    setCustomStatus({ type: 'idle', message: '' })
    const subject = customSubject.trim()
    const message = customMessage.trim()
    if (!subject || !message) {
      setCustomStatus({ type: 'error', message: 'Add a subject and message before sending.' })
      return
    }
    if (!window.confirm('Send this newsletter now?')) return

    setCustomSending(true)
    try {
      const res = await fetch('/api/updates/custom-newsletter', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          subject,
          message,
          signature: customSignature,
          filters: customFilters,
        }),
      })
      const data = await res.json()
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || `Request failed (${res.status})`)
      }
      const statsPayload = data?.stats || {}
      const sent = formatCount(statsPayload.sent)
      const total = formatCount(statsPayload.total)
      const errors = formatCount(statsPayload.errors)
      const summaryMessage = errors
        ? `Newsletter sent with errors: ${sent} of ${total} delivered (${errors} failed).`
        : `Newsletter sent: ${sent} of ${total} delivered.`
      setCustomStatus({ type: errors ? 'warning' : 'success', message: summaryMessage })
      setCustomAudienceCount(total)
    } catch (err) {
      setCustomStatus({ type: 'error', message: err.message || 'Failed to send newsletter.' })
    } finally {
      setCustomSending(false)
    }
  }

  return (
    <main className="max-w-[1400px] mx-auto px-6 md:px-12 py-10 space-y-8">
      <header className="space-y-3">
        <p className="text-sm font-semibold text-purple uppercase tracking-wide">Admin Portal</p>
        <h1 className="text-3xl md:text-4xl font-bold tracking-tight">Update Emails & Newsletters</h1>
        <p className="text-gray-600 max-w-2xl">
          Manage study update emails, publication newsletters, and subscriber communications.
        </p>
        {token && (
          <div className="flex flex-wrap items-center gap-3 text-sm text-gray-500">
            <span className="text-xs uppercase tracking-wide text-gray-400">Admin links</span>
            <Link href="/admin" className="hover:text-gray-700">
              Admin hub
            </Link>
            <Link href={approvalsPath} className="hover:text-gray-700">
              Study approvals
            </Link>
            <Link href={updatesPath} className="text-purple font-medium">
              Update emails
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
                Eligible study update subscribers this month: {formatCount(stats.eligible)}
              </p>
              {adminEmail && <p className="text-sm text-gray-500">Signed in as {adminEmail}.</p>}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  loadAdminData(token)
                  loadPublicationAdminData(token)
                }}
                disabled={loading || loadingPublications}
                className="inline-flex items-center justify-center border border-purple text-purple px-4 py-2 rounded hover:bg-purple/10 disabled:opacity-60"
              >
                {loading || loadingPublications ? 'Refreshing...' : 'Refresh'}
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
            {lastSendResult && (
              <p className={`text-sm ${lastSendResult.errors ? 'text-amber-700' : 'text-emerald-700'}`}>
                {lastSendResult.force ? 'Force send' : 'Send now'} completed {formatDate(lastSendResult.at)}. {lastSendResult.summaryMessage}
              </p>
            )}
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
              <label className="inline-flex items-center gap-2 text-sm text-gray-600">
                <input
                  type="checkbox"
                  checked={settings.sendEmpty}
                  onChange={(event) => updateSetting('sendEmpty', event.target.checked)}
                />
                Send even when there are no matching studies
              </label>
              <button
                type="submit"
                disabled={savingSettings}
                className="inline-flex items-center justify-center bg-purple text-white px-4 py-2 rounded shadow hover:bg-purple/90 disabled:opacity-60"
              >
                {savingSettings ? 'Saving...' : 'Save settings'}
              </button>
            </form>
          </section>

          <div className="pt-6 border-t border-black/5" />

          <div className="space-y-2">
            <h2 className="text-2xl font-semibold">Publication newsletter</h2>
            <p className="text-sm text-gray-500">
              Send recent publications to newsletter subscribers. “Send now” respects the date window.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-white border border-black/5 rounded-xl p-4 shadow-sm">
              <p className="text-xs uppercase tracking-wide text-gray-500">Total subscribers</p>
              <p className="text-2xl font-semibold">{formatCount(publicationStats.total)}</p>
            </div>
            <div className="bg-white border border-black/5 rounded-xl p-4 shadow-sm">
              <p className="text-xs uppercase tracking-wide text-gray-500">Active + opted in</p>
              <p className="text-2xl font-semibold">{formatCount(publicationStats.optedIn)}</p>
              <p className="text-xs text-gray-400">Eligible now: {formatCount(publicationStats.eligible)}</p>
            </div>
            <div className="bg-white border border-black/5 rounded-xl p-4 shadow-sm">
              <p className="text-xs uppercase tracking-wide text-gray-500">Last sent</p>
              <p className="text-sm font-medium text-gray-700">{formatDate(publicationStats.lastSentAt)}</p>
            </div>
          </div>

          <section className="bg-white border border-black/5 rounded-xl p-5 md:p-6 shadow-sm space-y-4">
            <div>
              <h3 className="text-lg font-semibold">Send publication newsletter</h3>
              <p className="text-sm text-gray-500">
                “Send now” respects the date window. “Force send” ignores the window limits.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => handlePublicationSend({ force: false })}
                disabled={sendingPublicationNow}
                className="inline-flex items-center justify-center bg-purple text-white px-4 py-2 rounded shadow hover:bg-purple/90 disabled:opacity-60"
              >
                {sendingPublicationNow ? 'Sending...' : 'Send now'}
              </button>
              <button
                type="button"
                onClick={() => handlePublicationSend({ force: true })}
                disabled={sendingPublicationForce}
                className="inline-flex items-center justify-center border border-red-500 text-red-600 px-4 py-2 rounded hover:bg-red-50 disabled:opacity-60"
              >
                {sendingPublicationForce ? 'Sending...' : 'Force send'}
              </button>
            </div>
            {publicationLastSendResult && (
              <p className={`text-sm ${publicationLastSendResult.errors ? 'text-amber-700' : 'text-emerald-700'}`}>
                {publicationLastSendResult.force ? 'Force send' : 'Send now'} completed {formatDate(publicationLastSendResult.at)}. {publicationLastSendResult.summaryMessage}
              </p>
            )}
          </section>

          <section className="bg-white border border-black/5 rounded-xl p-5 md:p-6 shadow-sm space-y-4">
            <div>
              <h3 className="text-lg font-semibold">Publication newsletter settings</h3>
              <p className="text-sm text-gray-500">
                Control the date window and copy used in publication newsletters.
              </p>
            </div>
            <form className="space-y-4" onSubmit={savePublicationSettings}>
              <div>
                <label htmlFor="publication-subject-template" className="text-sm font-medium">Subject template</label>
                <input
                  id="publication-subject-template"
                  type="text"
                  value={publicationSettings.subjectTemplate}
                  onChange={(event) => updatePublicationSetting('subjectTemplate', event.target.value)}
                  placeholder="Research publication updates - {{month}}"
                  className="w-full border border-black/10 px-3 py-2 rounded focus:outline-none focus:ring-2 focus:ring-purple"
                />
                <p className="text-xs text-gray-500">Use <span className="font-mono">{'{{month}}'}</span>, <span className="font-mono">{'{{range}}'}</span>, or <span className="font-mono">{'{{count}}'}</span>.</p>
              </div>
              <div>
                <label htmlFor="publication-intro" className="text-sm font-medium">Intro text</label>
                <textarea
                  id="publication-intro"
                  value={publicationSettings.introText}
                  onChange={(event) => updatePublicationSetting('introText', event.target.value)}
                  rows={2}
                  placeholder="Here are the latest publications from our researchers."
                  className="w-full border border-black/10 px-3 py-2 rounded focus:outline-none focus:ring-2 focus:ring-purple"
                />
              </div>
              <div>
                <label htmlFor="publication-empty-intro" className="text-sm font-medium">Empty-state intro</label>
                <textarea
                  id="publication-empty-intro"
                  value={publicationSettings.emptyIntroText}
                  onChange={(event) => updatePublicationSetting('emptyIntroText', event.target.value)}
                  rows={2}
                  placeholder="There are no new publications to share right now."
                  className="w-full border border-black/10 px-3 py-2 rounded focus:outline-none focus:ring-2 focus:ring-purple"
                />
              </div>
              <div>
                <label htmlFor="publication-outro" className="text-sm font-medium">Closing text</label>
                <textarea
                  id="publication-outro"
                  value={publicationSettings.outroText}
                  onChange={(event) => updatePublicationSetting('outroText', event.target.value)}
                  rows={2}
                  placeholder="Thank you for staying connected with our research program."
                  className="w-full border border-black/10 px-3 py-2 rounded focus:outline-none focus:ring-2 focus:ring-purple"
                />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="publication-signature" className="text-sm font-medium">Signature</label>
                  <input
                    id="publication-signature"
                    type="text"
                    value={publicationSettings.signature}
                    onChange={(event) => updatePublicationSetting('signature', event.target.value)}
                    placeholder="London Kidney Clinical Research"
                    className="w-full border border-black/10 px-3 py-2 rounded focus:outline-none focus:ring-2 focus:ring-purple"
                  />
                </div>
                <div>
                  <label htmlFor="publication-max" className="text-sm font-medium">Max publications per email</label>
                  <input
                    id="publication-max"
                    type="number"
                    min="1"
                    max="30"
                    value={publicationSettings.maxPublications}
                    onChange={(event) => updatePublicationSetting('maxPublications', event.target.value)}
                    placeholder="8"
                    className="w-full border border-black/10 px-3 py-2 rounded focus:outline-none focus:ring-2 focus:ring-purple"
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="publication-window-mode" className="text-sm font-medium">Date window mode</label>
                  <select
                    id="publication-window-mode"
                    value={publicationSettings.windowMode}
                    onChange={(event) => updatePublicationSetting('windowMode', event.target.value)}
                    className="w-full border border-black/10 px-3 py-2 rounded focus:outline-none focus:ring-2 focus:ring-purple bg-white"
                  >
                    <option value="rolling_days">Rolling days (last N days)</option>
                    <option value="last_sent">Since last email</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="publication-window-days" className="text-sm font-medium">Date window (days)</label>
                  <input
                    id="publication-window-days"
                    type="number"
                    min="1"
                    max="365"
                    value={publicationSettings.windowDays}
                    onChange={(event) => updatePublicationSetting('windowDays', event.target.value)}
                    placeholder="30"
                    className="w-full border border-black/10 px-3 py-2 rounded focus:outline-none focus:ring-2 focus:ring-purple"
                  />
                </div>
              </div>
              <label className="inline-flex items-center gap-2 text-sm text-gray-600">
                <input
                  type="checkbox"
                  checked={publicationSettings.sendEmpty}
                  onChange={(event) => updatePublicationSetting('sendEmpty', event.target.checked)}
                />
                Send even when there are no new publications
              </label>
              <button
                type="submit"
                disabled={savingPublicationSettings}
                className="inline-flex items-center justify-center bg-purple text-white px-4 py-2 rounded shadow hover:bg-purple/90 disabled:opacity-60"
              >
                {savingPublicationSettings ? 'Saving...' : 'Save publication settings'}
              </button>
            </form>
          </section>

          <section className="bg-white border border-black/5 rounded-xl p-5 md:p-6 shadow-sm space-y-4">
            <div>
              <h3 className="text-lg font-semibold">Custom newsletter</h3>
              <p className="text-sm text-gray-500">
                Send one-off updates to newsletter subscribers. Leave filters blank to reach everyone.
              </p>
            </div>
            <div>
              <label htmlFor="custom-newsletter-subject" className="text-sm font-medium">Subject</label>
              <input
                id="custom-newsletter-subject"
                type="text"
                value={customSubject}
                onChange={(event) => setCustomSubject(event.target.value)}
                placeholder="Newsletter update"
                className="w-full border border-black/10 px-3 py-2 rounded focus:outline-none focus:ring-2 focus:ring-purple"
              />
            </div>
            <div>
              <label htmlFor="custom-newsletter-message" className="text-sm font-medium">Message</label>
              <textarea
                id="custom-newsletter-message"
                value={customMessage}
                onChange={(event) => setCustomMessage(event.target.value)}
                rows={6}
                placeholder="Write your message here. Use blank lines to separate paragraphs."
                className="w-full border border-black/10 px-3 py-2 rounded focus:outline-none focus:ring-2 focus:ring-purple"
              />
            </div>
            <div>
              <label htmlFor="custom-newsletter-signature" className="text-sm font-medium">Signature (optional)</label>
              <input
                id="custom-newsletter-signature"
                type="text"
                value={customSignature}
                onChange={(event) => setCustomSignature(event.target.value)}
                placeholder="London Kidney Clinical Research"
                className="w-full border border-black/10 px-3 py-2 rounded focus:outline-none focus:ring-2 focus:ring-purple"
              />
            </div>
            <div className="space-y-4">
              <div>
                <p className="text-sm font-medium">Filter by role</p>
                <div className="grid gap-2 sm:grid-cols-2 text-sm">
                  {ROLE_OPTIONS.map((option) => (
                    <label key={`role-${option.value}`} className="flex items-start gap-2">
                      <input
                        type="checkbox"
                        className="mt-0.5 h-4 w-4"
                        checked={customFilters.roles.includes(option.value)}
                        onChange={() => toggleCustomFilter('roles', option.value)}
                      />
                      <span>{option.title}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <p className="text-sm font-medium">Filter by specialty</p>
                <div className="grid gap-2 sm:grid-cols-2 text-sm">
                  {SPECIALTY_OPTIONS.map((option) => (
                    <label key={`specialty-${option.value}`} className="flex items-start gap-2">
                      <input
                        type="checkbox"
                        className="mt-0.5 h-4 w-4"
                        checked={customFilters.specialties.includes(option.value)}
                        onChange={() => toggleCustomFilter('specialties', option.value)}
                      />
                      <span>{option.title}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <p className="text-sm font-medium">Filter by interest area</p>
                <div className="grid gap-2 sm:grid-cols-2 text-sm">
                  {INTEREST_AREA_OPTIONS.map((option) => (
                    <label key={`interest-${option.value}`} className="flex items-start gap-2">
                      <input
                        type="checkbox"
                        className="mt-0.5 h-4 w-4"
                        checked={customFilters.interestAreas.includes(option.value)}
                        onChange={() => toggleCustomInterestArea(option.value)}
                      />
                      <span>{option.title}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={previewCustomAudience}
                disabled={customPreviewing}
                className="inline-flex items-center justify-center border border-purple text-purple px-4 py-2 rounded hover:bg-purple/10 disabled:opacity-60"
              >
                {customPreviewing ? 'Checking...' : 'Preview audience'}
              </button>
              <button
                type="button"
                onClick={sendCustomNewsletter}
                disabled={customSending}
                className="inline-flex items-center justify-center bg-purple text-white px-4 py-2 rounded shadow hover:bg-purple/90 disabled:opacity-60"
              >
                {customSending ? 'Sending...' : 'Send newsletter'}
              </button>
            </div>
            {customAudienceCount !== null && (
              <p className="text-sm text-gray-600">Current audience size: {formatCount(customAudienceCount)}</p>
            )}
            {customStatus.message && (
              <p
                className={`text-sm ${
                  customStatus.type === 'error'
                    ? 'text-red-600'
                    : customStatus.type === 'warning'
                      ? 'text-amber-700'
                      : 'text-emerald-700'
                }`}
              >
                {customStatus.message}
              </p>
            )}
          </section>
        </section>
      )}
    </main>
  )
}
