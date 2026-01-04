'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { getTherapeuticAreaLabel } from '@/lib/communicationOptions'

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

const TOKEN_STORAGE_KEY = 'kcru-study-session'
const EMAIL_STORAGE_KEY = 'kcru-study-email'
const ADMIN_TOKEN_STORAGE_KEY = 'kcru-admin-token'
const ADMIN_EMAIL_STORAGE_KEY = 'kcru-admin-email'
const DEV_PREVIEW_MODE = process.env.NODE_ENV !== 'production'
const AUTOSAVE_DEBOUNCE_MS = 10000

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

function joinList(items) {
  if (!Array.isArray(items)) return ''
  return items.filter(Boolean).join('\n')
}

function normalizeNctId(value) {
  return String(value || '').trim().toUpperCase()
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
    emailTitle: trial?.emailTitle || '',
    emailEligibilitySummary: trial?.emailEligibilitySummary || '',
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
    principalInvestigatorName: trial?.principalInvestigatorName || '',
    ctGovData: null,
  }
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

function formatDraftTimestamp(value) {
  if (!value) return 'recently'
  const time = Date.parse(value)
  if (Number.isNaN(time)) return 'recently'
  return new Date(time).toLocaleString()
}

function serializeDraft(data) {
  try {
    return JSON.stringify(data)
  } catch (err) {
    return ''
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

export default function StudyManagerClient({ adminMode = false } = {}) {
  const [token, setToken] = useState('')
  const [email, setEmail] = useState('')
  const [passcode, setPasscode] = useState('')
  const [canBypassApprovals, setCanBypassApprovals] = useState(false)
  const [sendingCode, setSendingCode] = useState(false)
  const [verifyingCode, setVerifyingCode] = useState(false)
  const [loading, setLoading] = useState(false)
  const [syncLoading, setSyncLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [commsLoading, setCommsLoading] = useState(false)
  const [commsError, setCommsError] = useState('')
  const [commsSuccess, setCommsSuccess] = useState('')
  const [piError, setPiError] = useState('')
  const [duplicateMatch, setDuplicateMatch] = useState(null)
  const [trials, setTrials] = useState([])
  const [meta, setMeta] = useState({ areas: [], researchers: [] })
  const [form, setForm] = useState(EMPTY_FORM)
  const [piOtherSelected, setPiOtherSelected] = useState(false)
  const [baselineSnapshot, setBaselineSnapshot] = useState(() => serializeDraft(EMPTY_FORM))
  const [search, setSearch] = useState('')
  const [draft, setDraft] = useState(null)
  const [draftLoading, setDraftLoading] = useState(false)
  const [draftSaving, setDraftSaving] = useState(false)
  const [draftError, setDraftError] = useState('')
  const [draftAction, setDraftAction] = useState('')
  const autosaveTimeoutRef = useRef(null)
  const autosavePendingRef = useRef(false)
  const autosaveSuppressRef = useRef(false)
  const lastSavedSnapshotRef = useRef('')
  const draftSavingRef = useRef(false)
  const saveDraftRef = useRef(null)
  const inclusionCriteriaRefs = useRef([])
  const exclusionCriteriaRefs = useRef([])
  const criteriaFocusRef = useRef(null)
  const piNameInputRef = useRef(null)
  const canViewManager = Boolean(token) || DEV_PREVIEW_MODE
  const canSubmit = Boolean(token)
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

  const handleSignOut = useCallback(() => {
    sessionStorage.removeItem(TOKEN_STORAGE_KEY)
    sessionStorage.removeItem(EMAIL_STORAGE_KEY)
    if (adminMode) {
      sessionStorage.removeItem(ADMIN_TOKEN_STORAGE_KEY)
      sessionStorage.removeItem(ADMIN_EMAIL_STORAGE_KEY)
    }
    if (autosaveTimeoutRef.current) {
      clearTimeout(autosaveTimeoutRef.current)
      autosaveTimeoutRef.current = null
    }
    autosavePendingRef.current = false
    autosaveSuppressRef.current = false
    lastSavedSnapshotRef.current = ''
    setToken('')
    setCanBypassApprovals(false)
    setTrials([])
    setDraft(null)
    setDraftLoading(false)
    setDraftSaving(false)
    setDraftError('')
    setDraftAction('')
    setSuccess('')
    setError('')
    setCommsError('')
    setCommsSuccess('')
    setCommsLoading(false)
    setDuplicateMatch(null)
  }, [adminMode])

  useEffect(() => {
    if (adminMode) {
      const storedAdminToken = sessionStorage.getItem(ADMIN_TOKEN_STORAGE_KEY)
      const storedAdminEmail = sessionStorage.getItem(ADMIN_EMAIL_STORAGE_KEY)
      if (storedAdminToken) {
        setToken(storedAdminToken)
      }
      if (storedAdminEmail) {
        setEmail(storedAdminEmail)
      }
      return
    }

    const stored = sessionStorage.getItem(TOKEN_STORAGE_KEY)
    const storedEmail = sessionStorage.getItem(EMAIL_STORAGE_KEY)
    if (stored) {
      setToken(stored)
    }
    if (storedEmail) {
      setEmail(storedEmail)
    }
  }, [adminMode])

  useEffect(() => {
    if (adminMode) return
    if (token) {
      sessionStorage.setItem(TOKEN_STORAGE_KEY, token)
    } else {
      sessionStorage.removeItem(TOKEN_STORAGE_KEY)
    }
  }, [token, adminMode])

  useEffect(() => {
    if (adminMode) return
    if (email) {
      sessionStorage.setItem(EMAIL_STORAGE_KEY, email)
    } else {
      sessionStorage.removeItem(EMAIL_STORAGE_KEY)
    }
  }, [email, adminMode])

  useEffect(() => {
    draftSavingRef.current = draftSaving
  }, [draftSaving])

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

  function findDuplicateByNctId(nctId, excludeId) {
    const normalized = normalizeNctId(nctId)
    if (!normalized) return null
    return (
      trials.find(
        (trial) => normalizeNctId(trial?.nctId) === normalized && trial?._id !== excludeId
      ) || null
    )
  }

  function showDuplicate(match) {
    if (!match) return
    setDuplicateMatch(match)
    setError('A study with this NCT ID already exists. Use the existing record instead.')
    setSuccess('')
    if (match.nctId) {
      setSearch(match.nctId)
    }
  }

  const loadData = useCallback(async () => {
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
      setCanBypassApprovals(Boolean(data.access?.canBypassApprovals))
      return data
    } catch (err) {
      setError(err.message || 'Failed to load studies')
      return null
    } finally {
      setLoading(false)
    }
  }, [token, handleSignOut])

  const loadDraft = useCallback(async () => {
    if (!token) return
    setDraftLoading(true)
    setDraftError('')
    try {
      const res = await fetch('/api/trials/drafts', {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      })
      const data = await res.json()
      if (!res.ok || !data?.ok) {
        if (res.status === 401) {
          handleSignOut()
        }
        throw new Error(data?.error || `Request failed (${res.status})`)
      }
      setDraft(data.draft || null)
    } catch (err) {
      setDraftError(err.message || 'Failed to load draft')
    } finally {
      setDraftLoading(false)
    }
  }, [token, handleSignOut])

  useEffect(() => {
    if (token || DEV_PREVIEW_MODE) {
      loadData()
    }
    if (token) {
      setDraft(null)
      loadDraft()
    } else {
      setDraft(null)
    }
  }, [token, loadData, loadDraft])

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
        if (res.status === 401) {
          handleSignOut()
        }
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
        if (res.status === 401) {
          handleSignOut()
        }
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

  function handleSelectStudy(trial) {
    setError('')
    setSuccess('')
    setCommsError('')
    setCommsSuccess('')
    setPiError('')
    setDuplicateMatch(null)
    if (autosaveTimeoutRef.current) {
      clearTimeout(autosaveTimeoutRef.current)
      autosaveTimeoutRef.current = null
    }
    autosavePendingRef.current = false
    autosaveSuppressRef.current = true
    const nextForm = mapTrialToForm(trial)
    setBaselineSnapshot(serializeDraft(nextForm))
    setForm(nextForm)
  }

  function handleNewStudy() {
    setError('')
    setSuccess('')
    setCommsError('')
    setCommsSuccess('')
    setPiError('')
    setDuplicateMatch(null)
    if (autosaveTimeoutRef.current) {
      clearTimeout(autosaveTimeoutRef.current)
      autosaveTimeoutRef.current = null
    }
    autosavePendingRef.current = false
    autosaveSuppressRef.current = true
    setBaselineSnapshot(serializeDraft(EMPTY_FORM))
    setForm(EMPTY_FORM)
  }

  async function handleDuplicateSelect() {
    if (!duplicateMatch) return
    const matchId = duplicateMatch._id
    const matchNctId = normalizeNctId(duplicateMatch.nctId)
    const existing = trials.find(
      (trial) =>
        trial?._id === matchId ||
        (matchNctId && normalizeNctId(trial?.nctId) === matchNctId)
    )
    if (existing) {
      handleSelectStudy(existing)
      return
    }
    const data = await loadData()
    const refreshed = data?.trials?.find(
      (trial) =>
        trial?._id === matchId ||
        (matchNctId && normalizeNctId(trial?.nctId) === matchNctId)
    )
    if (refreshed) {
      handleSelectStudy(refreshed)
    }
  }

  function updateFormField(key, value) {
    if (key === 'nctId' && duplicateMatch) {
      setDuplicateMatch(null)
      setError('')
    }
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

  function buildCommunicationsPayload(source) {
    const ctGovData = source?.ctGovData || {}
    return {
      id: source?.id || undefined,
      nctId: normalizeNctId(source?.nctId),
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

  async function handleSync() {
    setError('')
    setSuccess('')
    setDuplicateMatch(null)
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

  async function deleteDraft({ silent } = {}) {
    if (!token) {
      setDraft(null)
      return
    }
    setDraftAction('delete')
    setDraftSaving(true)
    if (!silent) {
      setDraftError('')
    }
    try {
      const res = await fetch('/api/trials/drafts', {
        method: 'DELETE',
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      })
      const data = await res.json()
      if (!res.ok || !data?.ok) {
        if (res.status === 401) {
          handleSignOut()
        }
        throw new Error(data?.error || `Request failed (${res.status})`)
      }
      setDraft(null)
      setDraftError('')
    } catch (err) {
      if (!silent) {
        setDraftError(err.message || 'Failed to discard draft')
      }
    } finally {
      setDraftSaving(false)
      setDraftAction('')
    }
  }

  async function handleSave(event) {
    event.preventDefault()
    setError('')
    setSuccess('')
    setDuplicateMatch(null)
    if (!token) {
      setError('Sign in to submit studies.')
      return
    }
    if (!hasChanges) {
      return
    }
    const piName = form.principalInvestigatorName.trim()
    if (!form.principalInvestigatorId && !piName) {
      setPiError('Select a principal investigator or choose Other and enter a name.')
      return
    }
    const localDuplicate = findDuplicateByNctId(form.nctId, form.id)
    if (localDuplicate) {
      showDuplicate(localDuplicate)
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
        emailTitle: form.emailTitle,
        emailEligibilitySummary: form.emailEligibilitySummary,
        inclusionCriteria: splitList(form.inclusionCriteria),
        exclusionCriteria: splitList(form.exclusionCriteria),
        sponsorWebsite: form.sponsorWebsite,
        acceptsReferrals: form.acceptsReferrals,
        featured: form.featured,
        localContact: form.localContact,
        principalInvestigatorId: form.principalInvestigatorId || '',
        principalInvestigatorName: form.principalInvestigatorName || '',
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
        if (saveResult?.duplicate) {
          const duplicate =
            trials.find((trial) => trial?._id === saveResult.duplicate?._id) ||
            findDuplicateByNctId(saveResult.duplicate?.nctId, form.id) ||
            saveResult.duplicate
          showDuplicate(duplicate)
          return
        }
        if (res.status === 401) {
          handleSignOut()
        }
        throw new Error(saveResult?.error || `Submission failed (${res.status})`)
      }
      const directPublish = Boolean(saveResult?.directPublish) || canBypassApprovals
      setSuccess(
        directPublish
          ? form.id
            ? 'Update published.'
            : 'New study published.'
          : form.id
            ? 'Update submitted for approval.'
            : 'New study submitted for approval.'
      )
      setDuplicateMatch(null)
      if (saveResult?.studyId && saveResult.studyId !== form.id) {
        const nextForm = { ...form, id: saveResult.studyId }
        setForm(nextForm)
        setBaselineSnapshot(serializeDraft(nextForm))
      } else {
        setBaselineSnapshot(formSnapshot)
      }
      await loadData()
      await deleteDraft({ silent: true })
    } catch (err) {
      setError(err.message || 'Submission failed')
    } finally {
      setSaving(false)
    }
  }

  const scheduleAutosave = useCallback(({ data, snapshot } = {}) => {
    if (!token) return
    if (autosaveTimeoutRef.current) {
      clearTimeout(autosaveTimeoutRef.current)
    }
    autosavePendingRef.current = false
    const nextData = data || form
    const nextSnapshot = snapshot || serializeDraft(nextData)
    autosaveTimeoutRef.current = setTimeout(() => {
      if (!token) return
      if (draftSavingRef.current) {
        autosavePendingRef.current = true
        return
      }
      if (saveDraftRef.current) {
        saveDraftRef.current({ data: nextData, snapshot: nextSnapshot })
      }
    }, AUTOSAVE_DEBOUNCE_MS)
  }, [token, form])

  const saveDraft = useCallback(async ({ data, snapshot } = {}) => {
    if (!token) {
      return
    }
    const draftData = data || form
    const draftSnapshot = snapshot || serializeDraft(draftData)
    setDraftAction('autosave')
    setDraftSaving(true)
    setDraftError('')
    try {
      const res = await fetch('/api/trials/drafts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ data: draftData }),
      })
      const data = await res.json()
      if (!res.ok || !data?.ok) {
        if (res.status === 401) {
          handleSignOut()
        }
        throw new Error(data?.error || `Request failed (${res.status})`)
      }
      setDraft(data.draft || null)
      autosavePendingRef.current = false
      lastSavedSnapshotRef.current = draftSnapshot
      const currentSnapshot = serializeDraft(form)
      if (currentSnapshot !== draftSnapshot) {
        autosavePendingRef.current = false
        scheduleAutosave({ data: form, snapshot: currentSnapshot })
      }
    } catch (err) {
      setDraftError(err.message || 'Autosave failed')
    } finally {
      setDraftSaving(false)
      setDraftAction('')
    }
  }, [token, form, handleSignOut, scheduleAutosave])

  useEffect(() => {
    saveDraftRef.current = saveDraft
  }, [saveDraft])

  function handleRestoreDraft() {
    if (!draft?.data) return
    setDraftError('')
    const restored = mergeDraft(draft.data)
    if (autosaveTimeoutRef.current) {
      clearTimeout(autosaveTimeoutRef.current)
      autosaveTimeoutRef.current = null
    }
    autosavePendingRef.current = false
    autosaveSuppressRef.current = true
    lastSavedSnapshotRef.current = serializeDraft(restored)
    setForm(restored)
    criteriaFocusRef.current = null
  }

  function handleClearDraft() {
    deleteDraft()
  }

  useEffect(() => {
    if (!canSubmit) return undefined
    const snapshot = serializeDraft(form)
    if (autosaveSuppressRef.current) {
      autosaveSuppressRef.current = false
      return undefined
    }
    if (snapshot === lastSavedSnapshotRef.current) {
      return undefined
    }
    scheduleAutosave({ data: form, snapshot })
    return () => {
      if (autosaveTimeoutRef.current) {
        clearTimeout(autosaveTimeoutRef.current)
        autosaveTimeoutRef.current = null
      }
    }
  }, [form, canSubmit, scheduleAutosave])

  useEffect(() => {
    if (!draftSaving && autosavePendingRef.current) {
      autosavePendingRef.current = false
      const snapshot = serializeDraft(form)
      if (snapshot !== lastSavedSnapshotRef.current) {
        saveDraft({ data: form, snapshot })
      }
    }
  }, [draftSaving, form, saveDraft])

  const inclusionItems = Array.isArray(form.inclusionCriteria) ? form.inclusionCriteria : []
  const exclusionItems = Array.isArray(form.exclusionCriteria) ? form.exclusionCriteria : []
  const autosaveStatus = (() => {
    if (!canSubmit) return ''
    if (draftLoading) return 'Loading draft...'
    if (draftSaving) return draftAction === 'delete' ? 'Discarding draft...' : 'Autosaving...'
    if (draftError) return draftError
    if (draft?.savedAt) return `Draft saved ${formatDraftTimestamp(draft.savedAt)}.`
    return 'Drafts autosave every 10s.'
  })()
  const autosaveStatusClass = draftError ? 'text-xs text-red-600' : 'text-xs text-gray-500'
  const portalLabel = adminMode ? 'Admin Portal' : 'Coordinator Portal'
  const accessNote = adminMode
    ? 'Sign in through the Admin Hub to manage studies.'
    : 'Sign in with your lhsc.on.ca email to receive a passcode.'
  const showCoordinatorLogin = !token && !adminMode
  const showAdminSigninHint = !token && adminMode
  const workflowNote = canBypassApprovals
    ? 'Publish and edit studies. Changes go live immediately for approval admins.'
    : 'Submit or edit studies. Submissions are sent to an approval admin before changes go live.'
  const submitLabel = canBypassApprovals
    ? form.id
      ? 'Publish changes'
      : 'Publish new study'
    : form.id
      ? 'Submit changes'
      : 'Submit new study'
  const savingLabel = canBypassApprovals ? 'Publishing...' : 'Submitting...'

  return (
    <section
      className="max-w-[1400px] mx-auto px-6 md:px-12 py-10 space-y-8"
      aria-labelledby="study-manager-title"
    >
      <header className="space-y-3">
        <p className="text-sm font-semibold text-purple uppercase tracking-wide">{portalLabel}</p>
        <h1 id="study-manager-title" className="text-3xl md:text-4xl font-bold tracking-tight">
          Study Manager
        </h1>
        <p className="text-gray-600 max-w-2xl">
          {workflowNote} For studies registered with ClinicalTrials.gov (i.e., those that have an NCT number), use the
          sync tool to pull details from ClinicalTrials.gov first.
        </p>
      </header>

      <section className="bg-white border border-black/5 rounded-xl p-5 md:p-6 shadow-sm space-y-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-lg font-semibold">Access</h2>
            <p className="text-sm text-gray-500">
              {accessNote}
            </p>
            {token && (
              <p className="text-sm text-gray-500">
                Signed in as {email || 'coordinator'}
                {canBypassApprovals ? ' (approval admin).' : '.'}
              </p>
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

        {showCoordinatorLogin && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <form className="space-y-2" onSubmit={sendPasscode}>
              <label htmlFor="study-manager-email" className="text-sm font-medium">Work email</label>
              <input
                id="study-manager-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@lhsc.on.ca"
                className="w-full border border-black/10 px-3 py-2 rounded focus:outline-none focus:ring-2 focus:ring-purple"
              />
              <p className="text-xs text-gray-500">
                Use your LHSC email. We will send a one-time 6-digit code.
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
              <label htmlFor="study-manager-passcode" className="text-sm font-medium">Passcode</label>
              <input
                id="study-manager-passcode"
                type="text"
                value={passcode}
                onChange={(e) => setPasscode(e.target.value)}
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
        )}

        {showAdminSigninHint && (
          <div className="text-sm text-gray-600">
            <p className="mb-2">Sign in through the Admin Hub to access study management tools.</p>
            <Link href="/admin" className="text-purple font-medium hover:text-purple/80">
              Go to Admin Hub
            </Link>
          </div>
        )}

        {(error || success || duplicateMatch) && (
          <div className="text-sm">
            {error && <p className="text-red-600">{error}</p>}
            {success && <p className="text-emerald-700">{success}</p>}
            {duplicateMatch && (
              <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900">
                <p className="text-sm font-medium">Matching study found</p>
                <p className="text-sm">{duplicateMatch.title || 'Untitled study'}</p>
                <p className="text-xs text-amber-900/80">
                  {duplicateMatch.nctId || 'No NCT ID'} - {duplicateMatch.slug || 'no-slug'}
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={handleDuplicateSelect}
                    className="inline-flex items-center justify-center border border-amber-300 text-amber-900 px-3 py-1.5 rounded hover:bg-amber-100"
                  >
                    Open existing study
                  </button>
                </div>
              </div>
            )}
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
            <label htmlFor="study-manager-search" className="sr-only">
              Search studies
            </label>
            <input
              id="study-manager-search"
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
                  disabled={saving || !canSubmit || !hasChanges}
                  className="inline-flex items-center justify-center bg-purple text-white px-4 py-2 rounded shadow hover:bg-purple/90 disabled:opacity-60"
                >
                  {saving ? savingLabel : submitLabel}
                </button>
              </div>
              {canSubmit && (
                <div className={`flex flex-wrap items-center gap-2 ${autosaveStatusClass}`}>
                  <span>{autosaveStatus}</span>
                  {draft?.savedAt && (
                    <>
                      <button
                        type="button"
                        onClick={handleRestoreDraft}
                        disabled={draftSaving || draftLoading}
                        className="font-medium text-purple hover:text-purple/80 disabled:opacity-60"
                      >
                        Restore draft
                      </button>
                      <button
                        type="button"
                        onClick={handleClearDraft}
                        disabled={draftSaving || draftLoading}
                        className="text-gray-500 hover:text-gray-700 disabled:opacity-60"
                      >
                        Discard
                      </button>
                    </>
                  )}
                </div>
              )}

              <div className="space-y-1">
                <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_auto] gap-3 items-end">
                  <div className="space-y-1">
                    <label htmlFor="study-manager-nct-id" className="text-sm font-medium">NCT ID (start here)</label>
                    <input
                      id="study-manager-nct-id"
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
                  <label htmlFor="study-manager-title" className="text-sm font-medium">Display title</label>
                  <input
                    id="study-manager-title"
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
                  <label htmlFor="study-manager-slug" className="text-sm font-medium">URL slug</label>
                  <input
                    id="study-manager-slug"
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
                  <label htmlFor="study-manager-status" className="text-sm font-medium">Recruitment status</label>
                  <select
                    id="study-manager-status"
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
                  <label htmlFor="study-manager-type" className="text-sm font-medium">Study type</label>
                  <select
                    id="study-manager-type"
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
                  <label htmlFor="study-manager-phase" className="text-sm font-medium">Phase</label>
                  <select
                    id="study-manager-phase"
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
            </div>

          <div className="bg-white border border-black/5 rounded-xl p-5 md:p-6 shadow-sm space-y-4">
            <div>
              <h3 className="text-lg font-semibold">Therapeutic Areas</h3>
              <p className="text-sm text-gray-500">
                These tags help visitors filter studies and determine who receives study updates and recruitment reminders
                (for example, GN studies go to GN fellows, physicians, nurses, and pharmacists). Select all that apply.
              </p>
            </div>

            <div className="space-y-2">
                  <label id="therapeutic-areas-label" className="text-sm font-medium">Therapeutic areas</label>
                  <div role="group" aria-labelledby="therapeutic-areas-label" className="grid grid-cols-1 sm:grid-cols-2 gap-2">
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

          </div>

          <div className="bg-white border border-black/5 rounded-xl p-5 md:p-6 shadow-sm space-y-4">
            <div>
              <h3 className="text-lg font-semibold">Local Contact & PI</h3>
              <p className="text-sm text-gray-500">
                This is the main contact for participants. Only shown publicly if you enable it below.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1">
                <label htmlFor="study-manager-contact-name" className="text-sm font-medium">Contact name</label>
                <input
                  id="study-manager-contact-name"
                  type="text"
                  value={form.localContact.name}
                  onChange={(e) => updateContactField('name', e.target.value)}
                  placeholder="Jane Doe"
                  className="w-full border border-black/10 px-3 py-2 rounded focus:outline-none focus:ring-2 focus:ring-purple"
                />
              </div>
              <div className="space-y-1">
                <label htmlFor="study-manager-contact-role" className="text-sm font-medium">Contact role</label>
                <input
                  id="study-manager-contact-role"
                  type="text"
                  value={form.localContact.role}
                  onChange={(e) => updateContactField('role', e.target.value)}
                  placeholder="Study coordinator"
                  className="w-full border border-black/10 px-3 py-2 rounded focus:outline-none focus:ring-2 focus:ring-purple"
                />
              </div>
              <div className="space-y-1">
                <label htmlFor="study-manager-contact-email" className="text-sm font-medium">Contact email</label>
                <input
                  id="study-manager-contact-email"
                  type="email"
                  value={form.localContact.email}
                  onChange={(e) => updateContactField('email', e.target.value)}
                  placeholder="contact@lhsc.on.ca"
                  className="w-full border border-black/10 px-3 py-2 rounded focus:outline-none focus:ring-2 focus:ring-purple"
                />
              </div>
              <div className="space-y-1">
                <label htmlFor="study-manager-contact-phone" className="text-sm font-medium">Contact phone</label>
                <input
                  id="study-manager-contact-phone"
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
              <label htmlFor="study-manager-pi" className="text-sm font-medium">Principal investigator</label>
              <select
                id="study-manager-pi"
                value={piSelectionValue}
                onChange={(e) => updatePrincipalInvestigator(e.target.value)}
                className={`w-full border border-black/10 px-3 py-2 rounded bg-white focus:outline-none focus:ring-2 ${piError ? 'focus:ring-red-500 border-red-300' : 'focus:ring-purple'}`}
                aria-invalid={piError ? 'true' : 'false'}
                aria-describedby={piError ? 'study-manager-pi-error' : undefined}
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
                  <label htmlFor="study-manager-pi-name" className="text-sm font-medium">PI name</label>
                  <input
                    id="study-manager-pi-name"
                    type="text"
                    value={form.principalInvestigatorName}
                    onChange={(e) => updateFormField('principalInvestigatorName', e.target.value)}
                    placeholder="Enter PI name"
                    className={`w-full border border-black/10 px-3 py-2 rounded focus:outline-none focus:ring-2 ${piError ? 'focus:ring-red-500 border-red-300' : 'focus:ring-purple'}`}
                    aria-invalid={piError ? 'true' : 'false'}
                    aria-describedby={piError ? 'study-manager-pi-error' : undefined}
                    ref={piNameInputRef}
                  />
                  <p className="text-xs text-gray-500">
                    Use this when the PI is not in the researcher list.
                  </p>
                </div>
              )}
              {piError && (
                <p id="study-manager-pi-error" className="text-xs text-red-600">
                  {piError}
                </p>
              )}
            </div>
          </div>

          <div className="bg-white border border-black/5 rounded-xl p-5 md:p-6 shadow-sm space-y-4">
            <div>
              <h3 className="text-lg font-semibold">Summaries & Details</h3>
              <p className="text-sm text-gray-500">
                These appear on the public study page. If populated from ClinicalTrials.gov, the summary is
                generated by AI and should be reviewed for accuracy.
              </p>
            </div>

            <div className="space-y-1">
              <label htmlFor="study-manager-lay-summary" className="text-sm font-medium">Clinical summary</label>
              <textarea
                id="study-manager-lay-summary"
                aria-describedby="study-manager-lay-summary-help"
                value={form.laySummary}
                onChange={(e) => updateFormField('laySummary', e.target.value)}
                rows={4}
                className="w-full border border-black/10 px-3 py-2 rounded focus:outline-none focus:ring-2 focus:ring-purple"
              />
              <p id="study-manager-lay-summary-help" className="text-xs text-gray-500">
                3-5 sentences for clinicians. Summarize the study purpose, intervention, and key inclusion features.
              </p>
            </div>

            <div className="space-y-1">
              <label htmlFor="study-manager-sponsor-website" className="text-sm font-medium">Study website (if available)</label>
              <input
                id="study-manager-sponsor-website"
                aria-describedby="study-manager-sponsor-website-help"
                type="url"
                value={form.sponsorWebsite}
                onChange={(e) => updateFormField('sponsorWebsite', e.target.value)}
                placeholder="https://"
                className="w-full border border-black/10 px-3 py-2 rounded focus:outline-none focus:ring-2 focus:ring-purple"
              />
              <p id="study-manager-sponsor-website-help" className="text-xs text-gray-500">
                Public link to the sponsor or trial page. Leave blank if none.
              </p>
            </div>
          </div>

          <div className="bg-white border border-black/5 rounded-xl p-5 md:p-6 shadow-sm space-y-4">
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
              <label htmlFor="study-manager-email-title" className="text-sm font-medium">Short clinical title</label>
              <input
                id="study-manager-email-title"
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
              <label htmlFor="study-manager-email-eligibility" className="text-sm font-medium">
                Eligibility statement
              </label>
              <textarea
                id="study-manager-email-eligibility"
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
          </div>

          <div className="bg-white border border-black/5 rounded-xl p-5 md:p-6 shadow-sm space-y-4">
            <div>
              <h3 className="text-lg font-semibold">Eligibility Criteria</h3>
              <p className="text-sm text-gray-500">
                Add one requirement per item. Press Enter to add another, or paste a list.
              </p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label id="inclusion-criteria-label" className="text-sm font-medium">Inclusion criteria</label>
                <p id="inclusion-criteria-help" className="text-xs text-gray-500">Who can join the study.</p>
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
                          aria-label={`Inclusion criterion ${index + 1}`}
                          aria-describedby="inclusion-criteria-help"
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
                <label id="exclusion-criteria-label" className="text-sm font-medium">Exclusion criteria</label>
                <p id="exclusion-criteria-help" className="text-xs text-gray-500">Who cannot join the study.</p>
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
                          aria-label={`Exclusion criterion ${index + 1}`}
                          aria-describedby="exclusion-criteria-help"
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
          </div>

          <div className="flex items-center justify-end gap-3">
            <button
              type="submit"
              disabled={saving || !canSubmit || !hasChanges}
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
    </section>
  )
}
