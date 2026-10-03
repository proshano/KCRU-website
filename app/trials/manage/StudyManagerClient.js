'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSession } from 'next-auth/react'
import AuthButtons from '@/app/components/AuthButtons'
import StudyTeamsFieldset from '@/app/trials/components/StudyTeamsFieldset'
import {
  PHASE_OPTIONS,
  STATUS_OPTIONS,
  STUDY_TYPE_OPTIONS,
  createEmptyForm,
  formFromRecord,
  normalizeNctId,
  serializeForm as serializeDraft,
  slugify,
  splitList,
} from '@/app/trials/components/studyFormModel'
import { getTherapeuticAreaLabel } from '@/lib/communicationOptions'
import {
  coordinatingSites,
  createTeamKey,
  describePayloadTeam,
  formatTeamError,
  isContactEmpty,
  resolvePayloadTeams,
  siteShortLabel,
  validateSiteTeams,
} from '@/lib/studyTeams'

const EMPTY_FORM = createEmptyForm()

const TOKEN_STORAGE_KEY = 'kcru-study-session'
const ADMIN_TOKEN_STORAGE_KEY = 'kcru-admin-token'
const DEV_PREVIEW_MODE = process.env.NODE_ENV !== 'production'
const AUTOSAVE_DEBOUNCE_MS = 10000

function mapTrialToForm(trial) {
  return formFromRecord(trial, { id: trial?._id || '' })
}

function mergeDraft(data) {
  return formFromRecord(data)
}

function formatDraftTimestamp(value) {
  if (!value) return 'recently'
  const time = Date.parse(value)
  if (Number.isNaN(time)) return 'recently'
  return new Date(time).toLocaleString()
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
  const [canBypassApprovals, setCanBypassApprovals] = useState(false)
  const [canRemoveStudies, setCanRemoveStudies] = useState(false)
  const [loading, setLoading] = useState(false)
  const [syncLoading, setSyncLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [commsLoading, setCommsLoading] = useState(false)
  const [commsError, setCommsError] = useState('')
  const [commsSuccess, setCommsSuccess] = useState('')
  const [teamErrors, setTeamErrors] = useState([])
  const [pendingInfo, setPendingInfo] = useState(null)
  const [conflict, setConflict] = useState(null)
  const [duplicateMatch, setDuplicateMatch] = useState(null)
  const [trials, setTrials] = useState([])
  const [meta, setMeta] = useState({ areas: [], researchers: [], sites: [] })
  const [form, setForm] = useState(EMPTY_FORM)
  const [siteFilter, setSiteFilter] = useState('all')
  const [baselineSnapshot, setBaselineSnapshot] = useState(() => serializeDraft(EMPTY_FORM))
  const [search, setSearch] = useState('')
  const [draft, setDraft] = useState(null)
  const [draftLoading, setDraftLoading] = useState(false)
  const [draftSaving, setDraftSaving] = useState(false)
  const [draftError, setDraftError] = useState('')
  const [draftAction, setDraftAction] = useState('')
  const [formScrollRequest, setFormScrollRequest] = useState(0)
  const autosaveTimeoutRef = useRef(null)
  const autosavePendingRef = useRef(false)
  const autosaveSuppressRef = useRef(false)
  const lastSavedSnapshotRef = useRef('')
  const draftSavingRef = useRef(false)
  const saveDraftRef = useRef(null)
  const formRef = useRef(null)
  const studyListRef = useRef(null)
  const inclusionCriteriaRefs = useRef([])
  const exclusionCriteriaRefs = useRef([])
  const criteriaFocusRef = useRef(null)
  const { data: session, status: sessionStatus } = useSession()
  const hasSessionAccess = Boolean(
    adminMode ? session?.user?.access?.approvals : session?.user?.access?.coordinator
  )
  const hasAuth = Boolean(token) || hasSessionAccess
  const isSessionLoading = sessionStatus === 'loading'
  const canViewManager = hasAuth || DEV_PREVIEW_MODE
  const canSubmit = hasAuth
  const formSnapshot = useMemo(() => serializeDraft(form), [form])
  const hasChanges = formSnapshot !== baselineSnapshot
  const siteById = useMemo(() => new Map((meta.sites || []).map((site) => [site._id, site])), [meta.sites])
  const researcherById = useMemo(
    () => new Map((meta.researchers || []).map((researcher) => [researcher._id, researcher])),
    [meta.researchers]
  )
  const filterSites = useMemo(() => coordinatingSites(meta.sites), [meta.sites])
  const duplicateSites = useMemo(
    () =>
      resolvePayloadTeams(duplicateMatch).map(
        (team) => describePayloadTeam(team, meta).siteName || 'a team without a site'
      ),
    [duplicateMatch, meta]
  )

  // Site chips for a study row: one per team, amber when the team has no site yet.
  const trialTeamChips = useCallback(
    (trial) =>
      resolvePayloadTeams(trial).map((team) => {
        const site = siteById.get(team.siteId)
        return { key: team._key, label: site ? siteShortLabel(site) : 'No site', missing: !site }
      }),
    [siteById]
  )

  const handleSignOut = useCallback(() => {
    sessionStorage.removeItem(TOKEN_STORAGE_KEY)
    if (adminMode) {
      sessionStorage.removeItem(ADMIN_TOKEN_STORAGE_KEY)
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
    setCanRemoveStudies(false)
    setTrials([])
    setDraft(null)
    setDraftLoading(false)
    setDraftSaving(false)
    setDraftError('')
    setDraftAction('')
    setDeleting(false)
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
      if (storedAdminToken) {
        setToken(storedAdminToken)
      }
      return
    }

    const stored = sessionStorage.getItem(TOKEN_STORAGE_KEY)
    if (stored) {
      setToken(stored)
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

  useEffect(() => {
    // On narrow screens the study list is stacked above the form, so picking a study or starting a
    // new one changes a form that is off screen. Scroll to it once the change has rendered; the
    // form's scroll margin keeps it clear of the sticky site nav.
    if (!formScrollRequest) return
    const formElement = formRef.current
    const listElement = studyListRef.current
    if (!formElement || !listElement) return
    const isStacked = formElement.getBoundingClientRect().top >= listElement.getBoundingClientRect().bottom
    if (!isStacked) return
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    formElement.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' })
  }, [formScrollRequest])

  const filteredTrials = useMemo(() => {
    const query = search.trim().toLowerCase()
    return trials.filter((trial) => {
      const teams = resolvePayloadTeams(trial)
      if (siteFilter === 'none' && !teams.some((team) => !team.siteId)) return false
      if (siteFilter !== 'all' && siteFilter !== 'none' && !teams.some((team) => team.siteId === siteFilter)) return false
      if (!query) return true
      const haystack = [
        trial?.title,
        trial?.nctId,
        ...teams.flatMap((team) => {
          const site = siteById.get(team.siteId)
          const researcher = researcherById.get(team.principalInvestigatorId)
          return [site?.name, site?.shortName, researcher?.name, team.principalInvestigatorName]
        }),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      return haystack.includes(query)
    })
  }, [search, trials, siteFilter, siteById, researcherById])

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
    setError(
      `This NCT ID already belongs to "${match.title || 'an existing study'}". Open that study and add a team at your site instead of creating a second record.`
    )
    setSuccess('')
    if (match.nctId) {
      setSearch(match.nctId)
    }
  }

  const loadData = useCallback(async () => {
    setError('')
    setSuccess('')
    if (!hasAuth && !DEV_PREVIEW_MODE) {
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
        sites: data.meta?.sites || [],
      })
      setCanBypassApprovals(Boolean(data.access?.canBypassApprovals))
      setCanRemoveStudies(Boolean(data.access?.canRemoveStudies))
      return data
    } catch (err) {
      setError(err.message || 'Failed to load studies')
      return null
    } finally {
      setLoading(false)
    }
  }, [token, hasAuth, handleSignOut])

  const loadDraft = useCallback(async () => {
    if (!hasAuth) return
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
  }, [token, hasAuth, handleSignOut])

  useEffect(() => {
    if (hasAuth || DEV_PREVIEW_MODE) {
      loadData()
    }
    if (hasAuth) {
      setDraft(null)
      loadDraft()
    } else {
      setDraft(null)
    }
  }, [token, hasAuth, loadData, loadDraft])

  function handleSelectStudy(trial) {
    setError('')
    setSuccess('')
    setCommsError('')
    setCommsSuccess('')
    setTeamErrors([])
    setConflict(null)
    setDuplicateMatch(null)
    if (autosaveTimeoutRef.current) {
      clearTimeout(autosaveTimeoutRef.current)
      autosaveTimeoutRef.current = null
    }
    autosavePendingRef.current = false
    autosaveSuppressRef.current = true
    // A change by another coordinator may be awaiting approval. Start from it so
    // this edit builds on theirs instead of replacing it.
    const pending = trial?.pendingSubmission
    const nextForm = pending?.payload
      ? formFromRecord(pending.payload, { id: trial?._id || '' })
      : mapTrialToForm(trial)
    setPendingInfo(
      pending?._id
        ? { submissionId: pending._id, email: pending.submittedByEmail || '', submittedAt: pending.submittedAt || '' }
        : null
    )
    setBaselineSnapshot(serializeDraft(nextForm))
    setForm(nextForm)
    setFormScrollRequest((count) => count + 1)
  }

  function handleNewStudy() {
    setError('')
    setSuccess('')
    setCommsError('')
    setCommsSuccess('')
    setTeamErrors([])
    setPendingInfo(null)
    setConflict(null)
    setDuplicateMatch(null)
    if (autosaveTimeoutRef.current) {
      clearTimeout(autosaveTimeoutRef.current)
      autosaveTimeoutRef.current = null
    }
    autosavePendingRef.current = false
    autosaveSuppressRef.current = true
    setBaselineSnapshot(serializeDraft(EMPTY_FORM))
    setForm(EMPTY_FORM)
    setFormScrollRequest((count) => count + 1)
  }

  // The second site joins a registered study by opening the record the first
  // site created and adding its own team, so the team the coordinator was typing
  // travels across instead of being retyped.
  function openExistingStudyWithTeam(existing) {
    const typedTeam = form.siteTeams?.[0]
    handleSelectStudy(existing)
    const hasContent =
      typedTeam &&
      (typedTeam.siteId ||
        typedTeam.principalInvestigatorId ||
        typedTeam.principalInvestigatorName ||
        !isContactEmpty(typedTeam.contact))
    if (!hasContent) return
    setForm((prev) => {
      const usedSites = new Set(prev.siteTeams.map((team) => team.siteId).filter(Boolean))
      if (typedTeam.siteId && usedSites.has(typedTeam.siteId)) return prev
      return { ...prev, siteTeams: [...prev.siteTeams, { ...typedTeam, _key: createTeamKey() }] }
    })
    setSuccess('Opened the existing study. The team you were entering was added as a new team; review it and submit.')
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
      openExistingStudyWithTeam(existing)
      return
    }
    const data = await loadData()
    const refreshed = data?.trials?.find(
      (trial) =>
        trial?._id === matchId ||
        (matchNctId && normalizeNctId(trial?.nctId) === matchNctId)
    )
    if (refreshed) {
      openExistingStudyWithTeam(refreshed)
    }
  }

  // After a conflict, reopen the study so the form starts from the newest
  // pending change. The coordinator's own edits stay in their autosaved draft.
  async function handleReloadStudy() {
    const studyId = form.id
    const data = await loadData()
    const refreshed = data?.trials?.find((trial) => trial?._id === studyId)
    if (refreshed) {
      handleSelectStudy(refreshed)
    }
  }

  function updateFormField(key, value) {
    if (key === 'nctId' && duplicateMatch) {
      setDuplicateMatch(null)
      setError('')
    }
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  function updateTeams(nextTeams) {
    setTeamErrors([])
    setForm((prev) => ({ ...prev, siteTeams: nextTeams }))
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
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
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
    if (!hasAuth) {
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
    if (!hasAuth) {
      setError('Sign in to submit studies.')
      return
    }
    if (!hasChanges) {
      return
    }
    const errors = validateSiteTeams(form.siteTeams, { sites: meta.sites })
    if (errors.length) {
      setTeamErrors(errors)
      setError(formatTeamError(errors[0], form.siteTeams, meta.sites))
      return
    }
    setTeamErrors([])
    setConflict(null)
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
        featured: form.featured,
        siteTeams: form.siteTeams,
        recruitmentSiteIds: form.recruitmentSiteIds,
        ctGovData: form.ctGovData || undefined,
        ...(form.id ? { basedOnSubmissionId: pendingInfo?.submissionId || '' } : {}),
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
        if (saveResult?.conflict) {
          setConflict({ message: saveResult.error || 'This study changed since you opened it.' })
          return
        }
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
      // Further edits build on the submission just made (or on the published
      // study after a direct publish).
      setPendingInfo(
        !directPublish && saveResult?.submissionId
          ? { submissionId: saveResult.submissionId, email: session?.user?.email || '', submittedAt: new Date().toISOString() }
          : null
      )
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

  async function handleRemoveStudy() {
    if (!canRemoveStudies || !form.id || deleting) return

    const title = form.title || 'this study'
    const confirmed = window.confirm(
      `Remove "${title}" from the website?\n\nThis permanently deletes the study record. Existing submission and referral logs are preserved for audit history.`
    )
    if (!confirmed) return

    if (autosaveTimeoutRef.current) {
      clearTimeout(autosaveTimeoutRef.current)
      autosaveTimeoutRef.current = null
    }
    autosavePendingRef.current = false
    setDeleting(true)
    setError('')
    setSuccess('')
    setDuplicateMatch(null)

    try {
      const res = await fetch('/api/trials/manage', {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ id: form.id }),
      })
      const data = await res.json()
      if (!res.ok || !data?.ok) {
        if (res.status === 401) {
          handleSignOut()
        }
        throw new Error(data?.error || `Remove failed (${res.status})`)
      }

      autosaveSuppressRef.current = true
      lastSavedSnapshotRef.current = ''
      setForm(EMPTY_FORM)
      setBaselineSnapshot(serializeDraft(EMPTY_FORM))
      await loadData()
      await deleteDraft({ silent: true })
      setSuccess(`Removed "${data.title || title}".`)
    } catch (err) {
      setError(err.message || 'Failed to remove study')
    } finally {
      setDeleting(false)
    }
  }

  const scheduleAutosave = useCallback(({ data, snapshot } = {}) => {
    if (!hasAuth) return
    if (autosaveTimeoutRef.current) {
      clearTimeout(autosaveTimeoutRef.current)
    }
    autosavePendingRef.current = false
    const nextData = data || form
    const nextSnapshot = snapshot || serializeDraft(nextData)
    autosaveTimeoutRef.current = setTimeout(() => {
      if (!hasAuth) return
      if (draftSavingRef.current) {
        autosavePendingRef.current = true
        return
      }
      if (saveDraftRef.current) {
        saveDraftRef.current({ data: nextData, snapshot: nextSnapshot })
      }
    }, AUTOSAVE_DEBOUNCE_MS)
  }, [hasAuth, form])

  const saveDraft = useCallback(async ({ data, snapshot } = {}) => {
    if (!hasAuth) {
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
  }, [token, hasAuth, form, handleSignOut, scheduleAutosave])

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

  useEffect(() => {
    // Keep default values in sync so browsers like Safari don't flag saved forms as dirty.
    if (hasChanges) return
    const formElement = formRef.current
    if (!formElement) return
    const rafId = requestAnimationFrame(() => {
      const elements = Array.from(formElement.elements)
      elements.forEach((element) => {
        if (element instanceof HTMLInputElement) {
          if (element.type === 'checkbox' || element.type === 'radio') {
            element.defaultChecked = element.checked
            return
          }
          if (element.type === 'file') return
          element.defaultValue = element.value
          return
        }
        if (element instanceof HTMLTextAreaElement) {
          element.defaultValue = element.value
          return
        }
        if (element instanceof HTMLSelectElement) {
          Array.from(element.options).forEach((option) => {
            option.defaultSelected = option.selected
          })
        }
      })
    })
    return () => cancelAnimationFrame(rafId)
  }, [hasChanges, baselineSnapshot])

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
    ? "Sign in with your LHSC or St. Joseph's account to manage studies."
    : "Sign in with your LHSC or St. Joseph's account to submit or update studies."
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
            {hasAuth && (
              <p className="text-sm text-gray-500">
                Signed in as {session?.user?.email || 'authorized user'}
                {canBypassApprovals ? ' (approval admin).' : '.'}
              </p>
            )}
          </div>
          {hasAuth && (
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={loadData}
                disabled={loading}
                className="inline-flex items-center justify-center border border-purple text-purple px-4 py-2 rounded hover:bg-purple/10 disabled:opacity-60"
              >
                {loading ? 'Refreshing...' : 'Refresh'}
              </button>
              <AuthButtons
                signInCallbackUrl={adminMode ? '/admin/studies' : '/trials/manage'}
                signOutCallbackUrl="/login"
              />
            </div>
          )}
        </div>

        {isSessionLoading && (
          <div className="bg-white border border-black/5 rounded-xl p-5 md:p-6 shadow-sm animate-pulse h-24" />
        )}

        {!hasAuth && !isSessionLoading && (
          <div className="space-y-3">
            <p className="text-sm text-gray-500">Sign in to access the study manager.</p>
            <AuthButtons
              signInCallbackUrl={adminMode ? '/admin/studies' : '/trials/manage'}
              signOutCallbackUrl="/login"
            />
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
                  {duplicateSites.length ? ` - coordinated by ${duplicateSites.join(', ')}` : ''}
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={handleDuplicateSelect}
                    className="inline-flex items-center justify-center border border-amber-300 text-amber-900 px-3 py-1.5 rounded hover:bg-amber-100"
                  >
                    Open this study and add my team
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </section>

      {canViewManager ? (
        <section className="grid grid-cols-1 xl:grid-cols-[360px_1fr] gap-8">
          <div
            ref={studyListRef}
            className="bg-white border border-black/5 rounded-xl p-5 md:p-6 shadow-sm space-y-4 h-fit"
          >
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold">Existing Studies</h2>
              <button
                type="button"
                onClick={handleNewStudy}
                className="-my-2 py-2 text-sm font-medium text-purple hover:text-purple/80"
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
              placeholder="Search by title, NCT ID, site or PI"
              className="w-full border border-black/10 px-3 py-2 rounded focus:outline-none focus:ring-2 focus:ring-purple text-sm"
            />
            {filterSites.length > 0 && (
              <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by coordinating site">
                {[
                  { value: 'all', label: 'All sites' },
                  ...filterSites.map((site) => ({ value: site._id, label: siteShortLabel(site) })),
                  { value: 'none', label: 'No site set' },
                ].map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setSiteFilter(option.value)}
                    aria-pressed={siteFilter === option.value}
                    className={`px-2.5 py-1 rounded-full text-xs font-medium ${
                      siteFilter === option.value ? 'bg-purple text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            )}
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
                    <div className="flex flex-wrap gap-1">
                      <span className={`text-[10px] px-2 py-0.5 rounded-full whitespace-nowrap inline-flex ${statusBadge(trial.status)}`}>
                        {statusLabel(trial.status)}
                      </span>
                      {trialTeamChips(trial).map((chip) => (
                        <span
                          key={chip.key}
                          className={`text-[10px] px-2 py-0.5 rounded-full whitespace-nowrap inline-flex ${
                            chip.missing ? 'bg-amber-100 text-amber-800' : 'bg-gray-100 text-gray-700'
                          }`}
                        >
                          {chip.label}
                        </span>
                      ))}
                      {trial.pendingSubmission && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full whitespace-nowrap inline-flex bg-blue-50 text-blue-800">
                          Change pending
                        </span>
                      )}
                    </div>
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

          <form ref={formRef} onSubmit={handleSave} className="space-y-6 scroll-mt-40">
            <div className="bg-white border border-black/5 rounded-xl p-5 md:p-6 shadow-sm space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-lg font-semibold">Study Details</h2>
                <div className="flex flex-wrap items-center gap-2">
                  {canRemoveStudies && form.id && (
                    <button
                      type="button"
                      onClick={handleRemoveStudy}
                      disabled={deleting || saving || !canSubmit}
                      className="inline-flex items-center justify-center border border-red-200 text-red-700 px-4 py-2 rounded hover:bg-red-50 disabled:opacity-60"
                    >
                      {deleting ? 'Removing...' : 'Remove study'}
                    </button>
                  )}
                  <button
                    type="submit"
                    disabled={saving || deleting || !canSubmit || !hasChanges}
                    className="inline-flex items-center justify-center bg-purple text-white px-4 py-2 rounded shadow hover:bg-purple/90 disabled:opacity-60"
                  >
                    {saving ? savingLabel : submitLabel}
                  </button>
                </div>
              </div>
              {pendingInfo && form.id && (
                <p className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-900">
                  {canBypassApprovals
                    ? `Publishing will also close ${pendingInfo.email || 'another coordinator'}'s pending change from ${formatDraftTimestamp(
                        pendingInfo.submittedAt
                      )}, because your version includes it.`
                    : `Changes by ${pendingInfo.email || 'another coordinator'} submitted ${formatDraftTimestamp(
                        pendingInfo.submittedAt
                      )} are awaiting approval. Your edits build on them.`}
                </p>
              )}
              {conflict && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 flex flex-wrap items-center gap-3">
                  <span>{conflict.message}</span>
                  <button
                    type="button"
                    onClick={handleReloadStudy}
                    className="font-medium underline underline-offset-2 hover:text-red-900"
                  >
                    Reload study
                  </button>
                </div>
              )}
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
              </div>
              <p className="text-xs text-gray-500">
                Featured studies appear on the homepage. Each study team below decides whether it accepts referrals.
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

          <StudyTeamsFieldset
            idPrefix="study-manager"
            teams={form.siteTeams}
            onChange={updateTeams}
            sites={meta.sites}
            researchers={meta.researchers}
            errors={teamErrors}
            recruitmentSiteIds={form.recruitmentSiteIds}
            onRecruitmentChange={(ids) => updateFormField('recruitmentSiteIds', ids)}
          />

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
              disabled={saving || deleting || !canSubmit || !hasChanges}
              className="inline-flex items-center justify-center bg-purple text-white px-5 py-2 rounded shadow hover:bg-purple/90 disabled:opacity-60"
            >
              {saving ? savingLabel : submitLabel}
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
