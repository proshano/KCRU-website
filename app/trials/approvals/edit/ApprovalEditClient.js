'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { getTherapeuticAreaLabel } from '@/lib/communicationOptions'

const TOKEN_STORAGE_KEY = 'kcru-admin-token'
const LEGACY_TOKEN_KEYS = ['kcru-approval-token', 'kcru-updates-admin-token']

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

const PI_OTHER_VALUE = '__other__'

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
  emailTitle: '',
  emailEligibilitySummary: '',
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
  principalInvestigatorName: '',
  ctGovData: null,
}

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96)
}

function normalizeCriteriaText(value) {
  return String(value || '')
    .replace(/\\+([<>^\[\]])/g, '$1')
    .replace(/&gt;/gi, '>')
    .replace(/&lt;/gi, '<')
}

function splitList(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) => normalizeCriteriaText(item).trim())
      .filter(Boolean)
  }
  if (!value) return []
  return String(value)
    .split(/[\n,]+/)
    .map((item) => normalizeCriteriaText(item).trim())
    .filter(Boolean)
}

function mergeDraft(data) {
  const payload = data && typeof data === 'object' ? data : {}
  return {
    ...EMPTY_FORM,
    ...payload,
    therapeuticAreaIds: splitList(payload.therapeuticAreaIds),
    inclusionCriteria: splitList(payload.inclusionCriteria),
    exclusionCriteria: splitList(payload.exclusionCriteria),
    localContact: {
      ...EMPTY_FORM.localContact,
      ...(payload.localContact || {}),
    },
  }
}

function serializeDraft(data) {
  try {
    return JSON.stringify(data)
  } catch (err) {
    return ''
  }
}

export default function ApprovalEditClient() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const prefersAdmin = pathname.startsWith('/admin')
  const approvalsPath = prefersAdmin ? '/admin/approvals' : '/trials/approvals'
  const approvalsEditPath = `${approvalsPath}/edit`
  const updatesPath = prefersAdmin ? '/admin/updates' : '/updates/admin'
  const [token, setToken] = useState('')
  const [submission, setSubmission] = useState(null)
  const [meta, setMeta] = useState({ areas: [], researchers: [] })
  const [form, setForm] = useState(EMPTY_FORM)
  const [piOtherSelected, setPiOtherSelected] = useState(false)
  const [baselineSnapshot, setBaselineSnapshot] = useState(() => serializeDraft(EMPTY_FORM))
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [syncLoading, setSyncLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [commsLoading, setCommsLoading] = useState(false)
  const [commsError, setCommsError] = useState('')
  const [commsSuccess, setCommsSuccess] = useState('')
  const [piError, setPiError] = useState('')
  const inclusionCriteriaRefs = useRef([])
  const exclusionCriteriaRefs = useRef([])
  const criteriaFocusRef = useRef(null)
  const piNameInputRef = useRef(null)

  const submissionId = searchParams.get('submissionId') || ''
  const formSnapshot = useMemo(() => serializeDraft(form), [form])
  const hasChanges = formSnapshot !== baselineSnapshot
  const piSelectionValue =
    form.principalInvestigatorId || (piOtherSelected || form.principalInvestigatorName ? PI_OTHER_VALUE : '')

  useEffect(() => {
    if (piSelectionValue !== PI_OTHER_VALUE) return
    const timeout = setTimeout(() => {
      piNameInputRef.current?.focus()
    }, 0)
    return () => clearTimeout(timeout)
  }, [piSelectionValue])

  useEffect(() => {
    if (form.principalInvestigatorId) {
      setPiOtherSelected(false)
      return
    }
    if (form.principalInvestigatorName) {
      setPiOtherSelected(true)
    }
  }, [form.principalInvestigatorId, form.principalInvestigatorName])

  useEffect(() => {
    const queryToken = searchParams.get('token')
    if (queryToken) {
      sessionStorage.setItem(TOKEN_STORAGE_KEY, queryToken)
      setToken(queryToken)
      const nextParams = new URLSearchParams(searchParams.toString())
      nextParams.delete('token')
      const nextQuery = nextParams.toString()
      router.replace(nextQuery ? `${approvalsEditPath}?${nextQuery}` : approvalsEditPath)
      return
    }
    let stored = sessionStorage.getItem(TOKEN_STORAGE_KEY)
    if (!stored) {
      stored = LEGACY_TOKEN_KEYS.map((key) => sessionStorage.getItem(key)).find(Boolean) || ''
      if (stored) {
        sessionStorage.setItem(TOKEN_STORAGE_KEY, stored)
      }
    }
    if (stored) setToken(stored)
  }, [approvalsEditPath, router, searchParams])

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

  const loadSubmission = useCallback(async (activeToken = token) => {
    if (!activeToken || !submissionId) return
    setLoading(true)
    setError('')
    setSuccess('')
    try {
      const res = await fetch(
        `/api/trials/approvals/submission?submissionId=${encodeURIComponent(submissionId)}`,
        {
          headers: { Authorization: `Bearer ${activeToken}` },
        }
      )
      const data = await res.json()
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || `Request failed (${res.status})`)
      }
      setSubmission(data.submission || null)
      setMeta(data.meta || { areas: [], researchers: [] })
      const nextForm = mergeDraft(data.submission?.payload || {})
      setForm(nextForm)
      setBaselineSnapshot(serializeDraft(nextForm))
      setPiError('')
      setCommsError('')
      setCommsSuccess('')
    } catch (err) {
      setError(err.message || 'Failed to load submission.')
    } finally {
      setLoading(false)
    }
  }, [submissionId, token])

  useEffect(() => {
    if (token && submissionId) loadSubmission(token)
  }, [token, submissionId, loadSubmission])

  function updateFormField(key, value) {
    if (key === 'principalInvestigatorName') {
      setPiError('')
    }
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  function updatePrincipalInvestigator(value) {
    setPiError('')
    if (value === PI_OTHER_VALUE) {
      setPiOtherSelected(true)
      setForm((prev) => ({
        ...prev,
        principalInvestigatorId: '',
        principalInvestigatorName: prev.principalInvestigatorName || '',
      }))
      return
    }
    setPiOtherSelected(false)
    if (!value) {
      setForm((prev) => ({
        ...prev,
        principalInvestigatorId: '',
        principalInvestigatorName: '',
      }))
      return
    }
    setForm((prev) => ({
      ...prev,
      principalInvestigatorId: value,
      principalInvestigatorName: '',
    }))
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

  function buildCommunicationsPayload(source) {
    const ctGovData = source?.ctGovData || {}
    return {
      id: source?.id || undefined,
      nctId: String(source?.nctId || '').trim().toUpperCase(),
      title: source?.title || '',
      officialTitle: ctGovData?.officialTitle || '',
      briefTitle: ctGovData?.briefTitle || '',
      eligibilityCriteriaRaw: ctGovData?.eligibilityCriteriaRaw || '',
      inclusionCriteria: splitList(source?.inclusionCriteria),
      exclusionCriteria: splitList(source?.exclusionCriteria),
    }
  }

  async function requestCommunicationSuggestions(payload) {
    const res = await fetch('/api/trials/communications', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(payload),
    })
    const data = await res.json()
    if (!res.ok || !data?.ok) {
      throw new Error(data?.error || `Request failed (${res.status})`)
    }
    return data
  }

  async function handleGenerateCommunications({ fillOnly = false, overrideForm = null } = {}) {
    const source = overrideForm || form
    const payload = buildCommunicationsPayload(source)
    const hasContext =
      payload.title ||
      payload.officialTitle ||
      payload.briefTitle ||
      payload.nctId ||
      payload.inclusionCriteria.length ||
      payload.eligibilityCriteriaRaw

    setCommsError('')
    setCommsSuccess('')

    if (!hasContext) {
      setCommsError('Add a study title or eligibility criteria before generating.')
      return
    }

    if (!fillOnly && (source.emailTitle || source.emailEligibilitySummary)) {
      const confirmed = window.confirm('Replace the current short clinical title and eligibility statement?')
      if (!confirmed) return
    }

    setCommsLoading(true)
    try {
      const data = await requestCommunicationSuggestions(payload)
      if (!data?.emailTitle && !data?.emailEligibilitySummary) {
        throw new Error('No suggestions returned.')
      }
      setForm((prev) => ({
        ...prev,
        emailTitle: fillOnly
          ? prev.emailTitle || data.emailTitle || ''
          : data.emailTitle || prev.emailTitle,
        emailEligibilitySummary: fillOnly
          ? prev.emailEligibilitySummary || data.emailEligibilitySummary || ''
          : data.emailEligibilitySummary || prev.emailEligibilitySummary,
      }))
      setCommsSuccess(
        fillOnly ? 'AI suggestions added. Review and edit as needed.' : 'AI suggestions generated. Review and edit as needed.'
      )
    } catch (err) {
      setCommsError(err.message || 'Failed to generate AI suggestions.')
    } finally {
      setCommsLoading(false)
    }
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
        }),
      })
      const data = await res.json()
      if (!res.ok || !data?.success) {
        throw new Error(data?.error || `Sync failed (${res.status})`)
      }
      const synced = data?.data || {}
      const suggestedTitle =
        synced?.displayTitle || synced?.ctGovData?.briefTitle || synced?.ctGovData?.officialTitle
      const hasSyncedInclusion =
        Array.isArray(synced.inclusionCriteria) ||
        (typeof synced.inclusionCriteria === 'string' && synced.inclusionCriteria.trim())
      const hasSyncedExclusion =
        Array.isArray(synced.exclusionCriteria) ||
        (typeof synced.exclusionCriteria === 'string' && synced.exclusionCriteria.trim())
      const nextForm = {
        ...form,
        title: form.title || suggestedTitle || '',
        slug: form.slug || (suggestedTitle ? slugify(suggestedTitle) : ''),
        studyType: synced.studyType || form.studyType,
        phase: synced.phase || form.phase,
        inclusionCriteria: hasSyncedInclusion
          ? splitList(synced.inclusionCriteria)
          : splitList(form.inclusionCriteria),
        exclusionCriteria: hasSyncedExclusion
          ? splitList(synced.exclusionCriteria)
          : splitList(form.exclusionCriteria),
        laySummary: synced.laySummary || form.laySummary,
        ctGovData: synced.ctGovData || form.ctGovData,
      }
      setForm(nextForm)
      setSuccess('ClinicalTrials.gov data pulled in. Review and save when ready.')
      if (!nextForm.emailTitle || !nextForm.emailEligibilitySummary) {
        await handleGenerateCommunications({ fillOnly: true, overrideForm: nextForm })
      }
    } catch (err) {
      setError(err.message || 'Sync failed')
    } finally {
      setSyncLoading(false)
    }
  }

  async function saveEdits() {
    if (!token) {
      setError('Sign in to edit submissions.')
      return false
    }
    if (!submissionId) {
      setError('Missing submission id.')
      return false
    }
    const piName = form.principalInvestigatorName.trim()
    if (!form.principalInvestigatorId && !piName) {
      setPiError('Select a principal investigator or choose Other and enter a name.')
      return false
    }
    setSaving(true)
    setError('')
    setSuccess('')
    try {
      const res = await fetch('/api/trials/approvals/submission', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ submissionId, payload: form }),
      })
      const data = await res.json()
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || `Request failed (${res.status})`)
      }
      setBaselineSnapshot(formSnapshot)
      setSuccess('Edits saved. You can approve the submission when ready.')
      return true
    } catch (err) {
      setError(err.message || 'Failed to save edits.')
      return false
    } finally {
      setSaving(false)
    }
  }

  async function handleSave(event) {
    event.preventDefault()
    if (!hasChanges) return
    await saveEdits()
  }

  const inclusionItems = Array.isArray(form.inclusionCriteria) ? form.inclusionCriteria : []
  const exclusionItems = Array.isArray(form.exclusionCriteria) ? form.exclusionCriteria : []

  return (
    <main className="max-w-[1400px] mx-auto px-6 md:px-12 py-10 space-y-8">
      <header className="space-y-3">
        <p className="text-sm font-semibold text-purple uppercase tracking-wide">Admin Portal</p>
        <h1 className="text-3xl md:text-4xl font-bold tracking-tight">Edit Submission</h1>
        <p className="text-gray-600 max-w-2xl">
          Edit pending study submissions before approving them. Save changes here, then approve in the approvals list.
        </p>
        {token && (
          <div className="flex flex-wrap items-center gap-3 text-sm text-gray-500">
            <span className="text-xs uppercase tracking-wide text-gray-400">Admin links</span>
            <Link href="/admin" className="hover:text-gray-700">
              Admin hub
            </Link>
            <Link href={approvalsPath} className="text-purple font-medium">
              Study approvals
            </Link>
            <Link href={updatesPath} className="hover:text-gray-700">
              Study update emails
            </Link>
          </div>
        )}
        <Link href={approvalsPath} className="text-sm text-purple hover:text-purple/80">
          Back to approvals
        </Link>
      </header>

      {(error || success) && (
        <div className="text-sm">
          {error && <p className="text-red-600">{error}</p>}
          {success && <p className="text-emerald-700">{success}</p>}
        </div>
      )}

      {!submissionId && (
        <section className="bg-white border border-black/5 rounded-xl p-5 md:p-6 shadow-sm">
          <p className="text-sm text-gray-600">Select a submission to edit from the approvals list.</p>
        </section>
      )}

      {submissionId && (
        <form onSubmit={handleSave} className="space-y-6">
          <section className="bg-white border border-black/5 rounded-xl p-5 md:p-6 shadow-sm space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">Submission details</h2>
                {submission?.submittedAt && (
                  <p className="text-sm text-gray-500">
                    Submitted {new Date(submission.submittedAt).toLocaleString()}
                  </p>
                )}
                {submission?.submittedBy?.email && (
                  <p className="text-sm text-gray-500">Submitted by {submission.submittedBy.email}</p>
                )}
              </div>
              <button
                type="submit"
                disabled={saving || loading || !hasChanges}
                className="inline-flex items-center justify-center bg-purple text-white px-4 py-2 rounded shadow hover:bg-purple/90 disabled:opacity-60"
              >
                {saving ? 'Saving...' : 'Save edits'}
              </button>
            </div>
            {loading && <p className="text-sm text-gray-500">Loading submission...</p>}
          </section>

          <section className="bg-white border border-black/5 rounded-xl p-5 md:p-6 shadow-sm space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-lg font-semibold">Study Details</h2>
            </div>

            <div className="space-y-1">
              <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_auto] gap-3 items-end">
                <div className="space-y-1">
                  <label htmlFor="approval-edit-nct-id" className="text-sm font-medium">NCT ID (start here)</label>
                  <input
                    id="approval-edit-nct-id"
                    type="text"
                    value={form.nctId}
                    onChange={(e) => updateFormField('nctId', e.target.value.toUpperCase())}
                    placeholder="NCT12345678"
                    className="w-full border border-black/10 px-3 py-2 rounded focus:outline-none focus:ring-2 focus:ring-purple font-mono"
                  />
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
              <p className="text-xs text-gray-500">
                Enter the NCT ID to pull details from ClinicalTrials.gov. If there is no NCT ID, leave this blank.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1">
                <label htmlFor="approval-edit-title" className="text-sm font-medium">Display title</label>
                <input
                  id="approval-edit-title"
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
                  placeholder="Study title"
                  className="w-full border border-black/10 px-3 py-2 rounded focus:outline-none focus:ring-2 focus:ring-purple"
                />
                <p className="text-xs text-gray-500">
                  This is the public title shown on the website.
                </p>
              </div>
              <div className="space-y-1">
                <label htmlFor="approval-edit-slug" className="text-sm font-medium">URL slug</label>
                <input
                  id="approval-edit-slug"
                  type="text"
                  value={form.slug}
                  onChange={(e) => updateFormField('slug', e.target.value)}
                  placeholder="auto-generated"
                  className="w-full border border-black/10 px-3 py-2 rounded focus:outline-none focus:ring-2 focus:ring-purple font-mono text-sm"
                />
                <p className="text-xs text-gray-500">
                  Used in the page URL (lowercase words with hyphens).
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-1">
                <label htmlFor="approval-edit-status" className="text-sm font-medium">Recruitment status</label>
                <select
                  id="approval-edit-status"
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
                <p className="text-xs text-gray-500">
                  Shows current recruitment status on the public page.
                </p>
              </div>
              <div className="space-y-1">
                <label htmlFor="approval-edit-type" className="text-sm font-medium">Study type</label>
                <select
                  id="approval-edit-type"
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
                <p className="text-xs text-gray-500">
                  Choose the study design (as listed on ClinicalTrials.gov).
                </p>
              </div>
              <div className="space-y-1">
                <label htmlFor="approval-edit-phase" className="text-sm font-medium">Phase</label>
                <select
                  id="approval-edit-phase"
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
                <p className="text-xs text-gray-500">
                  Select N/A for observational studies.
                </p>
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
            <p className="text-xs text-gray-500">
              Featured studies appear on the homepage. The Accepts referrals toggle shows the referral option to visitors.
            </p>
          </section>

          <section className="bg-white border border-black/5 rounded-xl p-5 md:p-6 shadow-sm space-y-4">
            <div>
              <h3 className="text-lg font-semibold">Therapeutic Areas</h3>
              <p className="text-sm text-gray-500">
                These tags help visitors filter studies and determine who receives study updates and recruitment reminders
                (for example, GN studies go to GN fellows, physicians, nurses, and pharmacists). Select all that apply.
              </p>
            </div>

            <div className="space-y-2">
              <label id="approval-therapeutic-areas-label" className="text-sm font-medium">Therapeutic areas</label>
              <div role="group" aria-labelledby="approval-therapeutic-areas-label" className="grid grid-cols-1 sm:grid-cols-2 gap-2">
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
                      {getTherapeuticAreaLabel(area.name)}
                    </span>
                  </label>
                ))}
                {!meta.areas?.length && <p className="text-xs text-gray-500">No therapeutic areas configured.</p>}
              </div>
            </div>
          </section>

          <section className="bg-white border border-black/5 rounded-xl p-5 md:p-6 shadow-sm space-y-4">
            <div>
              <h3 className="text-lg font-semibold">Local Contact & PI</h3>
              <p className="text-sm text-gray-500">
                This is the main contact for participants. Only shown publicly if you enable it below.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1">
                <label htmlFor="approval-edit-contact-name" className="text-sm font-medium">Contact name</label>
                <input
                  id="approval-edit-contact-name"
                  type="text"
                  value={form.localContact.name}
                  onChange={(e) => updateContactField('name', e.target.value)}
                  placeholder="Jane Doe"
                  className="w-full border border-black/10 px-3 py-2 rounded focus:outline-none focus:ring-2 focus:ring-purple"
                />
              </div>
              <div className="space-y-1">
                <label htmlFor="approval-edit-contact-role" className="text-sm font-medium">Contact role</label>
                <input
                  id="approval-edit-contact-role"
                  type="text"
                  value={form.localContact.role}
                  onChange={(e) => updateContactField('role', e.target.value)}
                  placeholder="Study coordinator"
                  className="w-full border border-black/10 px-3 py-2 rounded focus:outline-none focus:ring-2 focus:ring-purple"
                />
              </div>
              <div className="space-y-1">
                <label htmlFor="approval-edit-contact-email" className="text-sm font-medium">Contact email</label>
                <input
                  id="approval-edit-contact-email"
                  type="email"
                  value={form.localContact.email}
                  onChange={(e) => updateContactField('email', e.target.value)}
                  placeholder="contact@lhsc.on.ca"
                  className="w-full border border-black/10 px-3 py-2 rounded focus:outline-none focus:ring-2 focus:ring-purple"
                />
              </div>
              <div className="space-y-1">
                <label htmlFor="approval-edit-contact-phone" className="text-sm font-medium">Contact phone</label>
                <input
                  id="approval-edit-contact-phone"
                  type="text"
                  value={form.localContact.phone}
                  onChange={(e) => updateContactField('phone', e.target.value)}
                  placeholder="555-555-5555"
                  className="w-full border border-black/10 px-3 py-2 rounded focus:outline-none focus:ring-2 focus:ring-purple"
                />
              </div>
              <label className="flex items-center gap-3 text-sm text-gray-700 md:col-span-2">
                <input
                  type="checkbox"
                  checked={form.localContact.displayPublicly}
                  onChange={(e) => updateContactField('displayPublicly', e.target.checked)}
                  className="h-4 w-4"
                />
                <span>Display contact info publicly</span>
              </label>
              <p className="text-xs text-gray-500 md:col-span-2">
                When checked, the contact name, role, email, and phone appear on the public study page. This is not
                required to facilitate referrals; leaving it unchecked keeps the information hidden.
              </p>
            </div>

            <div className="space-y-1">
              <label htmlFor="approval-edit-pi" className="text-sm font-medium">Principal investigator</label>
              <select
                id="approval-edit-pi"
                value={piSelectionValue}
                onChange={(e) => updatePrincipalInvestigator(e.target.value)}
                className={`w-full border border-black/10 px-3 py-2 rounded bg-white focus:outline-none focus:ring-2 ${piError ? 'focus:ring-red-500 border-red-300' : 'focus:ring-purple'}`}
                aria-invalid={piError ? 'true' : 'false'}
                aria-describedby={piError ? 'approval-edit-pi-error' : undefined}
              >
                <option value="">Select a PI</option>
                {(meta.researchers || []).map((researcher) => (
                  <option key={researcher._id} value={researcher._id}>
                    {researcher.name}
                  </option>
                ))}
                <option value={PI_OTHER_VALUE}>Other (not listed)</option>
              </select>
              {piSelectionValue === PI_OTHER_VALUE && (
                <div className="space-y-1">
                  <label htmlFor="approval-edit-pi-name" className="text-sm font-medium">PI name</label>
                  <input
                    id="approval-edit-pi-name"
                    type="text"
                    value={form.principalInvestigatorName}
                    onChange={(e) => updateFormField('principalInvestigatorName', e.target.value)}
                    placeholder="Enter PI name"
                    className={`w-full border border-black/10 px-3 py-2 rounded focus:outline-none focus:ring-2 ${piError ? 'focus:ring-red-500 border-red-300' : 'focus:ring-purple'}`}
                    aria-invalid={piError ? 'true' : 'false'}
                    aria-describedby={piError ? 'approval-edit-pi-error' : undefined}
                    ref={piNameInputRef}
                  />
                  <p className="text-xs text-gray-500">
                    Use this when the PI is not in the researcher list.
                  </p>
                </div>
              )}
              {piError && (
                <p id="approval-edit-pi-error" className="text-xs text-red-600">
                  {piError}
                </p>
              )}
            </div>
          </section>

          <section className="bg-white border border-black/5 rounded-xl p-5 md:p-6 shadow-sm space-y-4">
            <div>
              <h3 className="text-lg font-semibold">Summaries & Details</h3>
              <p className="text-sm text-gray-500">
                These appear on the public study page. If populated from ClinicalTrials.gov, the summary is
                generated by AI and should be reviewed for accuracy.
              </p>
            </div>

            <div className="space-y-1">
              <label htmlFor="approval-edit-lay-summary" className="text-sm font-medium">Clinical summary</label>
              <textarea
                id="approval-edit-lay-summary"
                value={form.laySummary}
                onChange={(e) => updateFormField('laySummary', e.target.value)}
                rows={4}
                className="w-full border border-black/10 px-3 py-2 rounded focus:outline-none focus:ring-2 focus:ring-purple"
              />
              <p className="text-xs text-gray-500">
                3-5 sentences for clinicians. Summarize the study purpose, intervention, and key inclusion features.
              </p>
            </div>

            <div className="space-y-1">
              <label htmlFor="approval-edit-sponsor-website" className="text-sm font-medium">Study website (if available)</label>
              <input
                id="approval-edit-sponsor-website"
                type="url"
                value={form.sponsorWebsite}
                onChange={(e) => updateFormField('sponsorWebsite', e.target.value)}
                placeholder="https://"
                className="w-full border border-black/10 px-3 py-2 rounded focus:outline-none focus:ring-2 focus:ring-purple"
              />
              <p className="text-xs text-gray-500">
                Public link to the sponsor or trial page. Leave blank if none.
              </p>
            </div>
          </section>

          <section className="bg-white border border-black/5 rounded-xl p-5 md:p-6 shadow-sm space-y-4">
            <div>
              <h3 className="text-lg font-semibold">Clinical Communications</h3>
              <p className="text-sm text-gray-500">
                Used in communications with clinical audiences (emails, outreach, referral requests). Not shown on the
                public site.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => handleGenerateCommunications()}
                disabled={commsLoading}
                className="inline-flex items-center justify-center border border-purple text-purple px-4 py-2 rounded hover:bg-purple/10 disabled:opacity-60"
              >
                {commsLoading ? 'Generating...' : 'Generate with AI'}
              </button>
              <p className="text-xs text-gray-500">
                Uses inclusion criteria and the official title when available.
              </p>
            </div>
            {commsError && <p className="text-xs text-red-600">{commsError}</p>}
            {!commsError && commsSuccess && <p className="text-xs text-emerald-700">{commsSuccess}</p>}

            <div className="space-y-1">
              <label htmlFor="approval-edit-email-title" className="text-sm font-medium">Short clinical title</label>
              <input
                id="approval-edit-email-title"
                type="text"
                value={form.emailTitle}
                onChange={(e) => updateFormField('emailTitle', e.target.value)}
                placeholder="SGLT2 inhibitor in CKD trial"
                className="w-full border border-black/10 px-3 py-2 rounded focus:outline-none focus:ring-2 focus:ring-purple"
              />
              <p className="text-xs text-gray-500">
                One-line clinical headline for fast scanning. Example: &quot;SGLT2 inhibitor in CKD trial&quot;.
              </p>
            </div>

            <div className="space-y-1">
              <label htmlFor="approval-edit-email-eligibility" className="text-sm font-medium">
                Eligibility statement
              </label>
              <textarea
                id="approval-edit-email-eligibility"
                value={form.emailEligibilitySummary}
                onChange={(e) => updateFormField('emailEligibilitySummary', e.target.value)}
                rows={3}
                className="w-full border border-black/10 px-3 py-2 rounded focus:outline-none focus:ring-2 focus:ring-purple"
              />
              <p className="text-xs text-gray-500">
                1-2 sentences with major inclusion criteria only. Example: &quot;Adults with CKD stage 3-4 and albuminuria;
                stable on ACEi/ARB.&quot; The coordinator will confirm full eligibility.
              </p>
            </div>
          </section>

          <section className="bg-white border border-black/5 rounded-xl p-5 md:p-6 shadow-sm space-y-4">
            <div>
              <h3 className="text-lg font-semibold">Eligibility Criteria</h3>
              <p className="text-sm text-gray-500">
                Add one requirement per item. Press Enter to add another, or paste a list.
              </p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label id="approval-inclusion-criteria-label" className="text-sm font-medium">Inclusion criteria</label>
                <p id="approval-inclusion-criteria-help" className="text-xs text-gray-500">Who can join the study.</p>
                <div className="space-y-2">
                  {inclusionItems.length ? (
                    inclusionItems.map((item, index) => (
                      <div
                        key={`approval-inclusion-${index}`}
                        className="flex items-center gap-2 rounded-lg border border-black/10 bg-white px-3 py-2"
                      >
                        <span className="w-6 text-right text-xs text-gray-400">{index + 1}.</span>
                        <input
                          ref={(el) => {
                            inclusionCriteriaRefs.current[index] = el
                          }}
                          type="text"
                          aria-label={`Inclusion criterion ${index + 1}`}
                          aria-describedby="approval-inclusion-criteria-help"
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
                          placeholder="Example: Age 18-65"
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
                <label id="approval-exclusion-criteria-label" className="text-sm font-medium">Exclusion criteria</label>
                <p id="approval-exclusion-criteria-help" className="text-xs text-gray-500">Who cannot join the study.</p>
                <div className="space-y-2">
                  {exclusionItems.length ? (
                    exclusionItems.map((item, index) => (
                      <div
                        key={`approval-exclusion-${index}`}
                        className="flex items-center gap-2 rounded-lg border border-black/10 bg-white px-3 py-2"
                      >
                        <span className="w-6 text-right text-xs text-gray-400">{index + 1}.</span>
                        <input
                          ref={(el) => {
                            exclusionCriteriaRefs.current[index] = el
                          }}
                          type="text"
                          aria-label={`Exclusion criterion ${index + 1}`}
                          aria-describedby="approval-exclusion-criteria-help"
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
                          placeholder="Example: Pregnant or breastfeeding"
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
          </section>

          <div className="flex items-center justify-end gap-3">
            <button
              type="submit"
              disabled={saving || loading || !hasChanges}
              className="inline-flex items-center justify-center bg-purple text-white px-5 py-2 rounded shadow hover:bg-purple/90 disabled:opacity-60"
            >
              {saving ? 'Saving...' : 'Save edits'}
            </button>
          </div>
        </form>
      )}
    </main>
  )
}
