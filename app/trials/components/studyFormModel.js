/**
 * The study form as the Study Manager and the approval editor hold it in state,
 * built from a study record, a submission payload or an autosaved draft (all
 * payload shape, see lib/studyTeams.js). Shared so the two editors cannot drift.
 */

import { createEmptyTeam, resolvePayloadTeams } from '@/lib/studyTeams'

export const STATUS_OPTIONS = [
  { value: 'recruiting', label: 'Recruiting' },
  { value: 'coming_soon', label: 'Coming Soon' },
  { value: 'active_not_recruiting', label: 'Active, Not Recruiting' },
  { value: 'completed', label: 'Completed' },
]

export const STUDY_TYPE_OPTIONS = [
  { value: '', label: 'Select study type' },
  { value: 'interventional', label: 'Interventional' },
  { value: 'observational', label: 'Observational' },
]

export const PHASE_OPTIONS = [
  { value: '', label: 'Select phase' },
  { value: 'phase1', label: 'Phase 1' },
  { value: 'phase1_2', label: 'Phase 1/2' },
  { value: 'phase2', label: 'Phase 2' },
  { value: 'phase2_3', label: 'Phase 2/3' },
  { value: 'phase3', label: 'Phase 3' },
  { value: 'phase4', label: 'Phase 4' },
  { value: 'na', label: 'N/A' },
]

export function slugify(value) {
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

export function splitList(value) {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeCriteriaText(item).trim()).filter(Boolean)
  }
  if (!value) return []
  return String(value)
    .split(/[\n,]+/)
    .map((item) => normalizeCriteriaText(item).trim())
    .filter(Boolean)
}

export function normalizeNctId(value) {
  return String(value || '').trim().toUpperCase()
}

export function serializeForm(data) {
  try {
    return JSON.stringify(data)
  } catch (err) {
    return ''
  }
}

// A record without teams (a brand-new study, or an old draft with nothing in
// the legacy fields) opens with one empty team panel.
export function teamsFromRecord(record) {
  const teams = resolvePayloadTeams(record)
  return teams.length ? teams : [createEmptyTeam('team-1')]
}

export function formFromRecord(record, { id } = {}) {
  const source = record && typeof record === 'object' ? record : {}
  return {
    id: id !== undefined ? id : source.id || source._id || '',
    title: source.title || '',
    slug: typeof source.slug === 'string' ? source.slug : source.slug?.current || '',
    nctId: normalizeNctId(source.nctId),
    status: source.status || 'recruiting',
    studyType: source.studyType || '',
    phase: source.phase || '',
    therapeuticAreaIds: splitList(source.therapeuticAreaIds),
    laySummary: source.laySummary || '',
    emailTitle: source.emailTitle || '',
    emailEligibilitySummary: source.emailEligibilitySummary || '',
    inclusionCriteria: splitList(source.inclusionCriteria),
    exclusionCriteria: splitList(source.exclusionCriteria),
    sponsorWebsite: source.sponsorWebsite || '',
    featured: Boolean(source.featured),
    siteTeams: teamsFromRecord(source),
    recruitmentSiteIds: splitList(source.recruitmentSiteIds),
    ctGovData: source.ctGovData || null,
  }
}

export function createEmptyForm() {
  return formFromRecord({}, { id: '' })
}
