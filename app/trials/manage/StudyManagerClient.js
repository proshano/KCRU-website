'use client'

import { useEffect, useMemo, useRef, useState } from 'react'

const STATUS_OPTIONS = [
  { value: 'recruiting', label: 'Recruiting' },
  { value: 'coming_soon', label: 'Coming Soon' },
  { value: 'active_not_recruiting', label: 'Active, Not Recruiting' },
  { value: 'completed', label: 'Completed' },
]

const STUDY_TYPE_OPTIONS = [
  { value: '', label: 'Select study type' },
  { value: 'interventional', label: 'Interventional' },
  { value: 'observational', label: 'Observational' },
]

const PHASE_OPTIONS = [
  { value: '', label: 'Select phase' },
  { value: 'phase1', label: 'Phase 1' },
  { value: 'phase1_2', label: 'Phase 1/2' },
  { value: 'phase2', label: 'Phase 2' },
  { value: 'phase2_3', label: 'Phase 2/3' },
  { value: 'phase3', label: 'Phase 3' },
  { value: 'phase4', label: 'Phase 4' },
  { value: 'na', label: 'N/A' },
]

const EMPTY_FORM = {
  id: '',
  title: '',
  slug: '',
  nctId: '',
  status: 'recruiting',
  studyType: '',
  phase: '',
  therapeuticAreaIds: [],
  laySummary: '',
  eligibilityOverview: '',
  inclusionCriteria: [],
  exclusionCriteria: [],
  sponsorWebsite: '',
  acceptsReferrals: false,
  featured: false,
  localContact: {
    name: '',
    role: '',
    email: '',
    phone: '',
    displayPublicly: false,
  },
  principalInvestigatorId: '',
  ctGovData: null,
}

const TOKEN_STORAGE_KEY = 'kcru-study-session'
const EMAIL_STORAGE_KEY = 'kcru-study-email'
const DEV_PREVIEW_MODE = process.env.NODE_ENV !== 'production'

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96)
}

function splitList(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) => String(item || '').trim())
      .filter(Boolean)
  }
  if (!value) return []
  return String(value)
    .split(/[\n,]+/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function joinList(items) {
  if (!Array.isArray(items)) return ''
  return items.filter(Boolean).join('\n')
}

function mapTrialToForm(trial) {
  return {
    id: trial?._id || '',
    title: trial?.title || '',
    slug: trial?.slug || '',
    nctId: trial?.nctId || '',
    status: trial?.status || 'recruiting',
    studyType: trial?.studyType || '',
    phase: trial?.phase || '',
    therapeuticAreaIds: trial?.therapeuticAreaIds || [],
    laySummary: trial?.laySummary || '',
    eligibilityOverview: trial?.eligibilityOverview || '',
    inclusionCriteria: splitList(trial?.inclusionCriteria),
    exclusionCriteria: splitList(trial?.exclusionCriteria),
    sponsorWebsite: trial?.sponsorWebsite || '',
    acceptsReferrals: Boolean(trial?.acceptsReferrals),
    featured: Boolean(trial?.featured),
    localContact: {
      name: trial?.localContact?.name || '',
      role: trial?.localContact?.role || '',
      email: trial?.localContact?.email || '',
      phone: trial?.localContact?.phone || '',
      displayPublicly: Boolean(trial?.localContact?.displayPublicly),
    },
    principalInvestigatorId: trial?.principalInvestigatorId || '',
    ctGovData: null,
  }
}

function statusBadge(status) {
  if (status === 'recruiting') return 'bg-emerald-100 text-emerald-800'
  if (status === 'coming_soon') return 'bg-amber-100 text-amber-800'
  if (status === 'active_not_recruiting') return 'bg-purple/10 text-purple'
  return 'bg-gray-100 text-gray-600'
}

function statusLabel(status) {
  const match = STATUS_OPTIONS.find((option) => option.value === status)
  return match?.label || status || 'draft'
}

export default function StudyManagerClient() {
  const [token, setToken] = useState('')
  const [email, setEmail] = useState('')
  const [passcode, setPasscode] = useState('')
  const [sendingCode, setSendingCode] = useState(false)
  const [verifyingCode, setVerifyingCode] = useState(false)
  const [loading, setLoading] = useState(false)
  const [syncLoading, setSyncLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [trials, setTrials] = useState([])
  const [meta, setMeta] = useState({ areas: [], researchers: [] })
  const [form, setForm] = useState(EMPTY_FORM)
  const [search, setSearch] = useState('')
  const inclusionCriteriaRefs = useRef([])
  const exclusionCriteriaRefs = useRef([])
  const criteriaFocusRef = useRef(null)
  const canViewManager = Boolean(token) || DEV_PREVIEW_MODE
  const canSubmit = Boolean(token)

  useEffect(() => {
    const stored = sessionStorage.getItem(TOKEN_STORAGE_KEY)
    const storedEmail = sessionStorage.getItem(EMAIL_STORAGE_KEY)
    if (stored) {
      setToken(stored)
    }
    if (storedEmail) {
      setEmail(storedEmail)
    }
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

  useEffect(() => {
    if (token || DEV_PREVIEW_MODE) {
      loadData()
    }
  }, [token])

  useEffect(() => {
    const pending = criteriaFocusRef.current
    if (!pending) return
    const refs =
      pending.key === 'inclusionCriteria' ? inclusionCriteriaRefs.current : exclusionCriteriaRefs.current
    const target = refs[pending.index]
    if (target) {
      target.focus()
      target.select?.()
    }
    criteriaFocusRef.current = null
  }, [form.inclusionCriteria, form.exclusionCriteria])

  const filteredTrials = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) return trials
    return trials.filter((trial) => {
      const title = trial?.title?.toLowerCase() || ''
      const nct = trial?.nctId?.toLowerCase() || ''
      return title.includes(query) || nct.includes(query)
    })
  }, [search, trials])

  async function loadData() {
    setError('')
    setSuccess('')
    if (!token && !DEV_PREVIEW_MODE) {
      setError('Sign in to load studies.')
      return null
    }
    setLoading(true)
    try {
      const res = await fetch('/api/trials/manage', {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      })
      const data = await res.json()
      if (!res.ok || !data?.ok) {
        if (res.status === 401) {
          handleSignOut()
        }
        throw new Error(data?.error || `Request failed (${res.status})`)
      }
      setTrials(data.trials || [])
      setMeta({
        areas: data.meta?.areas || [],
        researchers: data.meta?.researchers || [],
      })
      return data
    } catch (err) {
      setError(err.message || 'Failed to load studies')
      return null
    } finally {
      setLoading(false)
    }
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
      const res = await fetch('/api/trials/manage/login', {
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
      const res = await fetch('/api/trials/manage/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, code: passcode }),
      })
      const data = await res.json()
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || `Request failed (${res.status})`)
      }
      setToken(data.token || '')
      setSuccess('Signed in. Loading studies...')
      setPasscode('')
    } catch (err) {
      setError(err.message || 'Failed to verify passcode.')
    } finally {
      setVerifyingCode(false)
    }
  }

  function handleSignOut() {
    sessionStorage.removeItem(TOKEN_STORAGE_KEY)
    sessionStorage.removeItem(EMAIL_STORAGE_KEY)
    setToken('')
    setTrials([])
    setSuccess('')
    setError('')
  }

  function handleSelectStudy(trial) {
    setError('')
    setSuccess('')
    setForm(mapTrialToForm(trial))
  }

  function handleNewStudy() {
    setError('')
    setSuccess('')
    setForm(EMPTY_FORM)
  }

  function updateFormField(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  function updateCriteriaItem(key, index, value) {
    setForm((prev) => {
      const existing = Array.isArray(prev[key]) ? prev[key] : []
      const next = [...existing]
      next[index] = value
      return { ...prev, [key]: next }
    })
  }

  function addCriteriaItem(key) {
    setForm((prev) => {
      const existing = Array.isArray(prev[key]) ? prev[key] : []
      const nextIndex = existing.length
      criteriaFocusRef.current = { key, index: nextIndex }
      return { ...prev, [key]: [...existing, ''] }
    })
  }

  function removeCriteriaItem(key, index) {
    setForm((prev) => {
      const existing = Array.isArray(prev[key]) ? prev[key] : []
      const next = existing.filter((_, itemIndex) => itemIndex !== index)
      return { ...prev, [key]: next }
    })
  }

  function insertCriteriaItemAfter(key, index) {
    setForm((prev) => {
      const existing = Array.isArray(prev[key]) ? prev[key] : []
      const next = [...existing]
      next.splice(index + 1, 0, '')
      criteriaFocusRef.current = { key, index: index + 1 }
      return { ...prev, [key]: next }
    })
  }

  function handleCriteriaPaste(event, key, index) {
    const pasted = event.clipboardData?.getData('text') || ''
    const items = splitList(pasted)
    if (items.length <= 1) return
    event.preventDefault()
    setForm((prev) => {
      const existing = Array.isArray(prev[key]) ? prev[key] : []
      const next = [...existing]
      next.splice(index, 1, ...items)
      return { ...prev, [key]: next }
    })
  }

  function handleCriteriaKeyDown(event, key, index, value) {
    if (event.key === 'Enter') {
      event.preventDefault()
      insertCriteriaItemAfter(key, index)
      return
    }
    if (event.key === 'Backspace' && !String(value || '').trim()) {
      const existing = Array.isArray(form[key]) ? form[key] : []
      if (existing.length <= 1) return
      event.preventDefault()
      setForm((prev) => {
        const current = Array.isArray(prev[key]) ? prev[key] : []
        const next = current.filter((_, itemIndex) => itemIndex !== index)
        const focusIndex = Math.max(0, index - 1)
        criteriaFocusRef.current = { key, index: focusIndex }
        return { ...prev, [key]: next }
      })
    }
  }

  function updateContactField(key, value) {
    setForm((prev) => ({
      ...prev,
      localContact: {
        ...prev.localContact,
        [key]: value,
      },
    }))
  }

  function toggleMultiSelect(key, id) {
    setForm((prev) => {
      const existing = prev[key] || []
      const next = existing.includes(id)
        ? existing.filter((item) => item !== id)
        : [...existing, id]
      return { ...prev, [key]: next }
    })
  }

  async function handleSync() {
    setError('')
    setSuccess('')
    if (!form.nctId) {
      setError('Enter an NCT ID before syncing.')
      return
    }
    setSyncLoading(true)
    try {
      const res = await fetch('/api/trials/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nctId: form.nctId,
          generateSummary: true,
          generateEligibilityOverview: true,
        }),
      })
      const data = await res.json()
      if (!res.ok || !data?.success) {
        throw new Error(data?.error || `Sync failed (${res.status})`)
      }
      const synced = data?.data || {}
      const suggestedTitle = synced?.ctGovData?.briefTitle || synced?.ctGovData?.officialTitle
      const hasSyncedInclusion =
        Array.isArray(synced.inclusionCriteria) ||
        (typeof synced.inclusionCriteria === 'string' && synced.inclusionCriteria.trim())
      const hasSyncedExclusion =
        Array.isArray(synced.exclusionCriteria) ||
        (typeof synced.exclusionCriteria === 'string' && synced.exclusionCriteria.trim())
      setForm((prev) => ({
        ...prev,
        title: prev.title || suggestedTitle || '',
        slug: prev.slug || (suggestedTitle ? slugify(suggestedTitle) : ''),
        studyType: synced.studyType || prev.studyType,
        phase: synced.phase || prev.phase,
        inclusionCriteria: hasSyncedInclusion
          ? splitList(synced.inclusionCriteria)
          : splitList(prev.inclusionCriteria),
        exclusionCriteria: hasSyncedExclusion
          ? splitList(synced.exclusionCriteria)
          : splitList(prev.exclusionCriteria),
        laySummary: synced.laySummary || prev.laySummary,
        eligibilityOverview: synced.eligibilityOverview || prev.eligibilityOverview,
        ctGovData: synced.ctGovData || prev.ctGovData,
      }))
      setSuccess('ClinicalTrials.gov data pulled in. Review and save when ready.')
    } catch (err) {
      setError(err.message || 'Sync failed')
    } finally {
      setSyncLoading(false)
    }
  }

  async function handleSave(event) {
    event.preventDefault()
    setError('')
    setSuccess('')
    if (!token) {
      setError('Sign in to submit studies.')
      return
    }
    setSaving(true)
    try {
      const payload = {
        id: form.id || undefined,
        title: form.title,
        slug: form.slug,
        nctId: form.nctId,
        status: form.status,
        studyType: form.studyType,
        phase: form.phase,
        therapeuticAreaIds: form.therapeuticAreaIds,
        laySummary: form.laySummary,
        eligibilityOverview: form.eligibilityOverview,
        inclusionCriteria: splitList(form.inclusionCriteria),
        exclusionCriteria: splitList(form.exclusionCriteria),
        sponsorWebsite: form.sponsorWebsite,
        acceptsReferrals: form.acceptsReferrals,
        featured: form.featured,
        localContact: form.localContact,
        principalInvestigatorId: form.principalInvestigatorId || '',
        ctGovData: form.ctGovData || undefined,
      }

      const res = await fetch('/api/trials/manage', {
        method: form.id ? 'PATCH' : 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(payload),
      })
      const saveResult = await res.json()
      if (!res.ok || !saveResult?.ok) {
        if (res.status === 401) {
          handleSignOut()
        }
        throw new Error(saveResult?.error || `Submission failed (${res.status})`)
      }
      setSuccess(form.id ? 'Update submitted for approval.' : 'New study submitted for approval.')
      await loadData()
    } catch (err) {
      setError(err.message || 'Submission failed')
    } finally {
      setSaving(false)
    }
  }

  const inclusionItems = Array.isArray(form.inclusionCriteria) ? form.inclusionCriteria : []
  const exclusionItems = Array.isArray(form.exclusionCriteria) ? form.exclusionCriteria : []

  return (
    <main className="max-w-[1400px] mx-auto px-6 md:px-12 py-10 space-y-8">
      <header className="space-y-3">
        <p className="text-sm font-semibold text-purple uppercase tracking-wide">Coordinator Portal</p>
        <h1 className="text-3xl md:text-4xl font-bold tracking-tight">Study Manager</h1>
        <p className="text-gray-600 max-w-2xl">
          Submit or edit studies. Submissions are sent to an approval admin before changes go live. For studies
          registered with ClinicalTrials.gov (i.e., those that have an NCT number), use the sync tool to pull details
          from ClinicalTrials.gov first.
        </p>
      </header>

      <section className="bg-white border border-black/5 rounded-xl p-5 md:p-6 shadow-sm space-y-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-lg font-semibold">Access</h2>
            <p className="text-sm text-gray-500">
              Sign in with your lhsc.on.ca email to receive a passcode.
            </p>
            {token && (
              <p className="text-sm text-gray-500">Signed in as {email || 'coordinator'}.</p>
            )}
          </div>
          {token && (
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={loadData}
                disabled={loading}
                className="inline-flex items-center justify-center border border-purple text-purple px-4 py-2 rounded hover:bg-purple/10 disabled:opacity-60"
              >
                {loading ? 'Refreshing...' : 'Refresh'}
              </button>
              <button
                type="button"
                onClick={handleSignOut}
                className="text-sm text-gray-500 hover:text-gray-700"
              >
                Sign out
              </button>
            </div>
          )}
        </div>

        {!token && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <form className="space-y-2" onSubmit={sendPasscode}>
              <label className="text-sm font-medium">Work email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@lhsc.on.ca"
                className="w-full border border-black/10 px-3 py-2 rounded focus:outline-none focus:ring-2 focus:ring-purple"
              />
              <button
                type="submit"
                disabled={sendingCode || !email}
                className="inline-flex items-center justify-center bg-purple text-white px-4 py-2 rounded shadow hover:bg-purple/90 disabled:opacity-60"
              >
                {sendingCode ? 'Sending...' : 'Send passcode'}
              </button>
            </form>
            <form className="space-y-2" onSubmit={verifyPasscode}>
              <label className="text-sm font-medium">Passcode</label>
              <input
                type="text"
                value={passcode}
                onChange={(e) => setPasscode(e.target.value)}
                placeholder="6-digit code"
                className="w-full border border-black/10 px-3 py-2 rounded focus:outline-none focus:ring-2 focus:ring-purple font-mono"
              />
              <button
                type="submit"
                disabled={verifyingCode || !email || !passcode}
                className="inline-flex items-center justify-center border border-purple text-purple px-4 py-2 rounded hover:bg-purple/10 disabled:opacity-60"
              >
                {verifyingCode ? 'Verifying...' : 'Verify passcode'}
              </button>
            </form>
          </div>
        )}

        {(error || success) && (
          <div className="text-sm">
            {error && <p className="text-red-600">{error}</p>}
            {success && <p className="text-emerald-700">{success}</p>}
          </div>
        )}
      </section>

      {canViewManager ? (
        <section className="grid grid-cols-1 xl:grid-cols-[360px_1fr] gap-8">
          <div className="bg-white border border-black/5 rounded-xl p-5 md:p-6 shadow-sm space-y-4 h-fit">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold">Existing Studies</h2>
              <button
                type="button"
                onClick={handleNewStudy}
                className="text-sm font-medium text-purple hover:text-purple/80"
              >
                + New study
              </button>
            </div>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by title or NCT ID"
              className="w-full border border-black/10 px-3 py-2 rounded focus:outline-none focus:ring-2 focus:ring-purple text-sm"
            />
            <div className="text-xs text-gray-500">
              {filteredTrials.length} studies loaded
            </div>
            <div className="max-h-[140vh] overflow-y-auto divide-y divide-black/5">
              {filteredTrials.map((trial) => (
                <button
                  key={trial._id}
                  type="button"
                  onClick={() => handleSelectStudy(trial)}
                  className={`w-full text-left py-3 px-1 space-y-1 hover:bg-purple/5 ${
                    form.id === trial._id ? 'bg-purple/10' : ''
                  }`}
                >
                  <div className="space-y-1">
                    <div className="font-medium text-sm text-[#222]">{trial.title || 'Untitled study'}</div>
                    <div className="text-xs text-gray-500">
                      {trial.nctId || 'No NCT ID'} - {trial.slug || 'no-slug'}
                    </div>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full whitespace-nowrap inline-flex ${statusBadge(trial.status)}`}>
                      {statusLabel(trial.status)}
                    </span>
                  </div>
                </button>
              ))}
              {!filteredTrials.length && (
                <div className="text-sm text-gray-500 py-4">
                  No studies loaded yet. Refresh to load studies.
                </div>
              )}
            </div>
          </div>

          <form onSubmit={handleSave} className="space-y-6">
            <div className="bg-white border border-black/5 rounded-xl p-5 md:p-6 shadow-sm space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-lg font-semibold">Study Details</h2>
                <button
                  type="submit"
                  disabled={saving || !canSubmit}
                  className="inline-flex items-center justify-center bg-purple text-white px-4 py-2 rounded shadow hover:bg-purple/90 disabled:opacity-60"
                >
                  {saving ? 'Submitting...' : form.id ? 'Submit changes' : 'Submit new study'}
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_auto] gap-3 items-end">
                <div className="space-y-1">
                  <label className="text-sm font-medium">NCT ID (start here)</label>
                  <input
                    type="text"
                    value={form.nctId}
                    onChange={(e) => updateFormField('nctId', e.target.value.toUpperCase())}
                    placeholder="NCT12345678"
                    className="w-full border border-black/10 px-3 py-2 rounded focus:outline-none focus:ring-2 focus:ring-purple font-mono"
                  />
                  <p className="text-xs text-gray-500">Enter the NCT ID to pull details from ClinicalTrials.gov.</p>
                </div>
                <button
                  type="button"
                  onClick={handleSync}
                  disabled={syncLoading || !form.nctId}
                  className="inline-flex items-center justify-center border border-purple text-purple px-4 py-2 rounded hover:bg-purple/10 disabled:opacity-60"
                >
                  {syncLoading ? 'Syncing...' : 'Fetch from ClinicalTrials.gov'}
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-sm font-medium">Display title</label>
                  <input
                    type="text"
                    value={form.title}
                    onChange={(e) => {
                      const nextTitle = e.target.value
                      setForm((prev) => ({
                        ...prev,
                        title: nextTitle,
                        slug: prev.slug ? prev.slug : slugify(nextTitle),
                      }))
                    }}
                    placeholder="Patient-friendly study title"
                    className="w-full border border-black/10 px-3 py-2 rounded focus:outline-none focus:ring-2 focus:ring-purple"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium">URL slug</label>
                  <input
                    type="text"
                    value={form.slug}
                    onChange={(e) => updateFormField('slug', e.target.value)}
                    placeholder="auto-generated"
                    className="w-full border border-black/10 px-3 py-2 rounded focus:outline-none focus:ring-2 focus:ring-purple font-mono text-sm"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-1">
                  <label className="text-sm font-medium">Recruitment status</label>
                  <select
                    value={form.status}
                    onChange={(e) => updateFormField('status', e.target.value)}
                    className="w-full border border-black/10 px-3 py-2 rounded bg-white focus:outline-none focus:ring-2 focus:ring-purple"
                  >
                    {STATUS_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium">Study type</label>
                  <select
                    value={form.studyType}
                    onChange={(e) => updateFormField('studyType', e.target.value)}
                    className="w-full border border-black/10 px-3 py-2 rounded bg-white focus:outline-none focus:ring-2 focus:ring-purple"
                  >
                    {STUDY_TYPE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium">Phase</label>
                  <select
                    value={form.phase}
                    onChange={(e) => updateFormField('phase', e.target.value)}
                    className="w-full border border-black/10 px-3 py-2 rounded bg-white focus:outline-none focus:ring-2 focus:ring-purple"
                  >
                    {PHASE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-6 text-sm text-gray-700">
                <label className="inline-flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={form.featured}
                    onChange={(e) => updateFormField('featured', e.target.checked)}
                    className="h-4 w-4"
                  />
                  Feature on homepage
                </label>
                <label className="inline-flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={form.acceptsReferrals}
                    onChange={(e) => updateFormField('acceptsReferrals', e.target.checked)}
                    className="h-4 w-4"
                  />
                  Accepts referrals
                </label>
              </div>
            </div>

          <div className="bg-white border border-black/5 rounded-xl p-5 md:p-6 shadow-sm space-y-4">
            <div>
              <h3 className="text-lg font-semibold">Therapeutic Areas</h3>
              <p className="text-sm text-gray-500">Select all that apply for filtering.</p>
            </div>

            <div className="space-y-2">
                  <label className="text-sm font-medium">Therapeutic areas</label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {(meta.areas || []).map((area) => (
                      <label key={area._id} className="inline-flex items-center gap-2 text-sm">
                        <input
                      type="checkbox"
                      checked={form.therapeuticAreaIds.includes(area._id)}
                      onChange={() => toggleMultiSelect('therapeuticAreaIds', area._id)}
                        className="h-4 w-4"
                      />
                      <span>
                      {area.shortLabel ? `${area.shortLabel} - ` : ''}
                      {area.name}
                    </span>
                  </label>
                ))}
                {!meta.areas?.length && <p className="text-xs text-gray-500">No therapeutic areas configured.</p>}
              </div>
            </div>

          </div>

          <div className="bg-white border border-black/5 rounded-xl p-5 md:p-6 shadow-sm space-y-4">
            <div>
              <h3 className="text-lg font-semibold">Local Contact & PI</h3>
              <p className="text-sm text-gray-500">Displayed in referrals and optionally on the study page.</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="text-sm font-medium">Contact name</label>
                <input
                  type="text"
                  value={form.localContact.name}
                  onChange={(e) => updateContactField('name', e.target.value)}
                  className="w-full border border-black/10 px-3 py-2 rounded focus:outline-none focus:ring-2 focus:ring-purple"
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">Contact role</label>
                <input
                  type="text"
                  value={form.localContact.role}
                  onChange={(e) => updateContactField('role', e.target.value)}
                  className="w-full border border-black/10 px-3 py-2 rounded focus:outline-none focus:ring-2 focus:ring-purple"
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">Contact email</label>
                <input
                  type="email"
                  value={form.localContact.email}
                  onChange={(e) => updateContactField('email', e.target.value)}
                  className="w-full border border-black/10 px-3 py-2 rounded focus:outline-none focus:ring-2 focus:ring-purple"
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">Contact phone</label>
                <input
                  type="text"
                  value={form.localContact.phone}
                  onChange={(e) => updateContactField('phone', e.target.value)}
                  className="w-full border border-black/10 px-3 py-2 rounded focus:outline-none focus:ring-2 focus:ring-purple"
                />
              </div>
              <div className="flex items-center gap-3 text-sm text-gray-700 md:col-span-2">
                <input
                  type="checkbox"
                  checked={form.localContact.displayPublicly}
                  onChange={(e) => updateContactField('displayPublicly', e.target.checked)}
                  className="h-4 w-4"
                />
                Display contact info publicly
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium">Principal investigator</label>
              <select
                value={form.principalInvestigatorId}
                onChange={(e) => updateFormField('principalInvestigatorId', e.target.value)}
                className="w-full border border-black/10 px-3 py-2 rounded bg-white focus:outline-none focus:ring-2 focus:ring-purple"
              >
                <option value="">Select a PI</option>
                {(meta.researchers || []).map((researcher) => (
                  <option key={researcher._id} value={researcher._id}>
                    {researcher.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="bg-white border border-black/5 rounded-xl p-5 md:p-6 shadow-sm space-y-4">
            <div>
              <h3 className="text-lg font-semibold">Summaries & Details</h3>
              <p className="text-sm text-gray-500">These appear on the public study page.</p>
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium">Plain language summary</label>
              <textarea
                value={form.laySummary}
                onChange={(e) => updateFormField('laySummary', e.target.value)}
                rows={4}
                className="w-full border border-black/10 px-3 py-2 rounded focus:outline-none focus:ring-2 focus:ring-purple"
              />
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium">Eligibility overview</label>
              <textarea
                value={form.eligibilityOverview}
                onChange={(e) => updateFormField('eligibilityOverview', e.target.value)}
                rows={3}
                className="w-full border border-black/10 px-3 py-2 rounded focus:outline-none focus:ring-2 focus:ring-purple"
              />
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium">Study website (if available)</label>
              <input
                type="url"
                value={form.sponsorWebsite}
                onChange={(e) => updateFormField('sponsorWebsite', e.target.value)}
                placeholder="https://"
                className="w-full border border-black/10 px-3 py-2 rounded focus:outline-none focus:ring-2 focus:ring-purple"
              />
            </div>
          </div>

          <div className="bg-white border border-black/5 rounded-xl p-5 md:p-6 shadow-sm space-y-4">
            <div>
              <h3 className="text-lg font-semibold">Eligibility Criteria</h3>
              <p className="text-sm text-gray-500">Add each criterion as its own item.</p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Inclusion criteria</label>
                <div className="space-y-2">
                  {inclusionItems.length ? (
                    inclusionItems.map((item, index) => (
                      <div
                        key={`inclusion-${index}`}
                        className="flex items-center gap-2 rounded-lg border border-black/10 bg-white px-3 py-2"
                      >
                        <span className="w-6 text-right text-xs text-gray-400">{index + 1}.</span>
                        <input
                          ref={(el) => {
                            inclusionCriteriaRefs.current[index] = el
                          }}
                          type="text"
                          value={item}
                          onChange={(e) => updateCriteriaItem('inclusionCriteria', index, e.target.value)}
                          onBlur={(e) => {
                            const trimmed = e.target.value.trim()
                            if (trimmed !== e.target.value) {
                              updateCriteriaItem('inclusionCriteria', index, trimmed)
                            }
                          }}
                          onKeyDown={(e) => handleCriteriaKeyDown(e, 'inclusionCriteria', index, item)}
                          onPaste={(e) => handleCriteriaPaste(e, 'inclusionCriteria', index)}
                          placeholder="Add inclusion criterion"
                          className="flex-1 bg-transparent text-sm focus:outline-none"
                        />
                        <button
                          type="button"
                          onClick={() => removeCriteriaItem('inclusionCriteria', index)}
                          className="text-xs text-gray-400 hover:text-gray-700"
                          aria-label={`Remove inclusion criterion ${index + 1}`}
                        >
                          Remove
                        </button>
                      </div>
                    ))
                  ) : (
                    <p className="text-xs text-gray-500">No inclusion criteria yet.</p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => addCriteriaItem('inclusionCriteria')}
                  className="inline-flex items-center gap-2 rounded border border-dashed border-black/15 px-3 py-2 text-sm text-gray-600 hover:border-purple hover:text-purple"
                >
                  + Add item
                </button>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Exclusion criteria</label>
                <div className="space-y-2">
                  {exclusionItems.length ? (
                    exclusionItems.map((item, index) => (
                      <div
                        key={`exclusion-${index}`}
                        className="flex items-center gap-2 rounded-lg border border-black/10 bg-white px-3 py-2"
                      >
                        <span className="w-6 text-right text-xs text-gray-400">{index + 1}.</span>
                        <input
                          ref={(el) => {
                            exclusionCriteriaRefs.current[index] = el
                          }}
                          type="text"
                          value={item}
                          onChange={(e) => updateCriteriaItem('exclusionCriteria', index, e.target.value)}
                          onBlur={(e) => {
                            const trimmed = e.target.value.trim()
                            if (trimmed !== e.target.value) {
                              updateCriteriaItem('exclusionCriteria', index, trimmed)
                            }
                          }}
                          onKeyDown={(e) => handleCriteriaKeyDown(e, 'exclusionCriteria', index, item)}
                          onPaste={(e) => handleCriteriaPaste(e, 'exclusionCriteria', index)}
                          placeholder="Add exclusion criterion"
                          className="flex-1 bg-transparent text-sm focus:outline-none"
                        />
                        <button
                          type="button"
                          onClick={() => removeCriteriaItem('exclusionCriteria', index)}
                          className="text-xs text-gray-400 hover:text-gray-700"
                          aria-label={`Remove exclusion criterion ${index + 1}`}
                        >
                          Remove
                        </button>
                      </div>
                    ))
                  ) : (
                    <p className="text-xs text-gray-500">No exclusion criteria yet.</p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => addCriteriaItem('exclusionCriteria')}
                  className="inline-flex items-center gap-2 rounded border border-dashed border-black/15 px-3 py-2 text-sm text-gray-600 hover:border-purple hover:text-purple"
                >
                  + Add item
                </button>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-end gap-3">
            <button
              type="submit"
              disabled={saving || !canSubmit}
              className="inline-flex items-center justify-center bg-purple text-white px-5 py-2 rounded shadow hover:bg-purple/90 disabled:opacity-60"
            >
              {saving ? 'Submitting...' : form.id ? 'Submit changes' : 'Submit new study'}
            </button>
          </div>
          </form>
        </section>
      ) : (
        <p className="text-sm text-gray-500">Sign in to view and manage studies.</p>
      )}
    </main>
  )
}
