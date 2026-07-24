import { createHash } from 'crypto'

import { sanityFetch, writeClient } from './sanity.js'
import { searchPubMedWithTotal, fetchPublicationsWithAbstracts } from './pubmed.js'
import { generateResearchDigestTriage } from './summaries.js'
import {
  DEFAULT_RESEARCH_DIGEST_SETTINGS,
  RESEARCH_DIGEST_APPROVAL,
  RESEARCH_DIGEST_ISSUE_STATUS,
  RESEARCH_DIGEST_SELECTION_STATUS,
  RESEARCH_DIGEST_TIMEZONE,
  RESEARCH_DIGEST_TRIAGE,
  RESEARCH_OPPORTUNITY_TYPES,
  getResearchDigestJournalGroups,
  getResearchDigestOpportunitySources,
  normalizeResearchDigestSettings,
} from './researchDigestConfig.js'
import { safeFetchText } from './outboundUrlSafety.js'

const MAX_PUBMED_RESULTS_PER_GROUP = Number(process.env.RESEARCH_DIGEST_MAX_PUBMED_PER_GROUP || 80)
const TRIAGE_CONCURRENCY = Math.max(Number(process.env.RESEARCH_DIGEST_TRIAGE_CONCURRENCY || 4), 1)
const SELECTION_PATCH_CHUNK_SIZE = 100
const FEED_FETCH_TIMEOUT_MS = Number(process.env.RESEARCH_DIGEST_FEED_TIMEOUT_MS || 12000)
const FEED_MAX_BYTES = Number(process.env.RESEARCH_DIGEST_FEED_MAX_BYTES || 2 * 1024 * 1024)
const EXCLUDED_DIGEST_PUBLICATION_TYPES = [
  /\bcase reports?\b/i,
  /\bcomment\b/i,
  /\beditorial\b/i,
  /\berratum\b/i,
  /\bletter\b/i,
  /\bnews\b/i,
  /\bpublished erratum\b/i,
  /\bretracted publication\b/i,
  /\bretraction of publication\b/i,
]
const TIER_FALLBACK_SCORES = Object.freeze({
  'Tier 1': 90,
  'Tier 2': 75,
  'Tier 3': 50,
})
const KIDNEY_NATIVE_JOURNAL_GROUP_KEYS = new Set([
  'kidney_nephrology',
  'dialysis_krt',
  'transplantation',
])
const KIDNEY_TOPIC_TERMS = [
  'kidney',
  'renal',
  'nephrology',
  'nephro',
  'dialysis',
  'hemodialysis',
  'peritoneal dialysis',
  'glomerul',
  'nephropathy',
  'nephritis',
  'proteinuria',
  'albuminuria',
  'chronic kidney disease',
  'acute kidney injury',
  'kidney transplant',
  'creatinine',
  'egfr',
  'uremia',
]

// Runs workers over `items` with a fixed pool, preserving input order in the result.
async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length)
  let cursor = 0
  const poolSize = Math.min(Math.max(limit, 1), items.length)
  await Promise.all(Array.from({ length: poolSize }, async () => {
    while (cursor < items.length) {
      const index = cursor
      cursor += 1
      results[index] = await worker(items[index], index)
    }
  }))
  return results
}

function cleanText(value) {
  return String(value || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

export function normalizeDigestKey(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/https?:\/\//g, '')
    .replace(/www\./g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

export function normalizeOpportunityUrl(value) {
  if (!value) return ''
  try {
    const url = new URL(String(value).trim())
    url.hash = ''
    for (const key of Array.from(url.searchParams.keys())) {
      if (/^utm_/i.test(key) || ['fbclid', 'gclid', 'mc_cid', 'mc_eid'].includes(key.toLowerCase())) {
        url.searchParams.delete(key)
      }
    }
    url.pathname = url.pathname.replace(/\/+$/, '') || '/'
    return url.toString()
  } catch {
    return String(value || '').trim().replace(/[?#].*$/, '').replace(/\/+$/, '')
  }
}

export function formatResearchDigestDate(date = new Date(), timeZone = RESEARCH_DIGEST_TIMEZONE) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const map = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]))
  return `${map.year}-${map.month}-${map.day}`
}

export function getResearchDigestWindow(date = new Date(), timeZone = RESEARCH_DIGEST_TIMEZONE) {
  const weekday = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'long' }).format(date).toLowerCase()
  const days = weekday === 'monday' ? 14 : 7
  const start = new Date(date.getTime() - days * 24 * 60 * 60 * 1000)
  return {
    days,
    from: formatPubMedDate(start, timeZone),
    to: formatPubMedDate(date, timeZone),
  }
}

export function isWeekdayInTimeZone(date = new Date(), timeZone = RESEARCH_DIGEST_TIMEZONE) {
  const weekday = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' }).format(date).toLowerCase()
  return !['sat', 'sun'].includes(weekday)
}

function formatPubMedDate(date, timeZone) {
  return formatResearchDigestDate(date, timeZone).replaceAll('-', '/')
}

function safeDocumentId(prefix, value) {
  const raw = String(value || '').trim()
  const cleaned = raw.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '')
  if (cleaned && cleaned.length <= 120) return `${prefix}.${cleaned}`
  return `${prefix}.${createHash('sha1').update(raw || `${prefix}-${Date.now()}`).digest('hex')}`
}

function escapePubMedTerm(value) {
  return String(value || '').replaceAll('"', '\\"')
}

export function buildKidneyTopicPubMedFilter() {
  const terms = KIDNEY_TOPIC_TERMS
    .map((term) => `"${escapePubMedTerm(term)}"[Title/Abstract]`)
    .join(' OR ')
  return `(${terms})`
}

export function buildJournalGroupPubMedQuery(group, window) {
  const journalTerms = (group?.journals || [])
    .map((journal) => `"${escapePubMedTerm(journal)}"[Journal]`)
    .join(' OR ')
  const groupKey = String(group?.key || '').toLowerCase()
  const kidneyFilter = KIDNEY_NATIVE_JOURNAL_GROUP_KEYS.has(groupKey)
    ? ''
    : ` AND ${buildKidneyTopicPubMedFilter()}`
  return `(${journalTerms}) AND ("${window.from}"[EDAT] : "${window.to}"[EDAT])${kidneyFilter}`
}

async function fetchExistingPaperState(publications) {
  const pmids = publications.map((pub) => String(pub.pmid || '')).filter(Boolean)
  const dois = publications.map((pub) => String(pub.doi || '').toLowerCase()).filter(Boolean)
  if (!pmids.length && !dois.length) {
    return { existingKeys: new Set(), retryDocumentIds: new Set() }
  }

  const rows = await writeClient.fetch(
    `*[_type == "researchDigestPaper" && (pmid in $pmids || lower(doi) in $dois)]{
      _id,
      pmid,
      doi,
      triageError
    }`,
    { pmids, dois }
  )
  const existingKeys = new Set()
  const retryDocumentIds = new Set()
  for (const row of rows || []) {
    if (row?.triageError) {
      if (row?._id) retryDocumentIds.add(row._id)
      continue
    }
    if (row?.pmid) existingKeys.add(`pmid:${row.pmid}`)
    if (row?.doi) existingKeys.add(`doi:${String(row.doi).toLowerCase()}`)
  }
  return { existingKeys, retryDocumentIds }
}

function hasExistingPaper(existingKeys, pub) {
  return Boolean(
    (pub?.pmid && existingKeys.has(`pmid:${pub.pmid}`)) ||
    (pub?.doi && existingKeys.has(`doi:${String(pub.doi).toLowerCase()}`))
  )
}

function inferPaperApprovalStatus(triageStatus) {
  return triageStatus === RESEARCH_DIGEST_TRIAGE.exclude
    ? RESEARCH_DIGEST_APPROVAL.rejected
    : RESEARCH_DIGEST_APPROVAL.pending
}

export function hasExcludedDigestPublicationType(publicationTypes = []) {
  const types = Array.isArray(publicationTypes) ? publicationTypes : []
  return types.some((type) => (
    EXCLUDED_DIGEST_PUBLICATION_TYPES.some((pattern) => pattern.test(String(type || '')))
  ))
}

export function getDigestPriorityScore(paper) {
  const rawScore = paper?.priorityScore
  if (rawScore !== null && rawScore !== undefined && rawScore !== '') {
    const explicitScore = Number(rawScore)
    if (Number.isFinite(explicitScore)) {
      return Math.min(Math.max(Math.round(explicitScore), 0), 100)
    }
  }
  return TIER_FALLBACK_SCORES[paper?.tier] || 0
}

export function isAutomatedDigestCandidate(paper, minPriorityScore) {
  return (
    paper?.triageStatus === RESEARCH_DIGEST_TRIAGE.include &&
    !paper?.triageError &&
    Boolean(String(paper?.summary || '').trim()) &&
    Boolean(String(paper?.whyItMatters || '').trim()) &&
    !paper?.autoSelectionExcluded &&
    !hasExcludedDigestPublicationType(paper?.publicationTypes) &&
    getDigestPriorityScore(paper) >= minPriorityScore
  )
}

export function selectAutomatedDigestPapers(papers = [], settings = {}) {
  const normalizedSettings = normalizeResearchDigestSettings(settings)
  return papers
    .filter((paper) => isAutomatedDigestCandidate(paper, normalizedSettings.minPriorityScore))
    .sort((a, b) => (
      getDigestPriorityScore(b) - getDigestPriorityScore(a) ||
      String(a.tier || '').localeCompare(String(b.tier || '')) ||
      String(b.pubDate || '').localeCompare(String(a.pubDate || '')) ||
      String(a.pmid || a._id || '').localeCompare(String(b.pmid || b._id || ''))
    ))
    .slice(0, normalizedSettings.maxPapers)
}

function shiftIsoDate(isoDate, days) {
  const parsed = new Date(`${isoDate}T12:00:00Z`)
  if (Number.isNaN(parsed.getTime())) return isoDate
  parsed.setUTCDate(parsed.getUTCDate() - days)
  return parsed.toISOString().slice(0, 10)
}

export function getCarryoverStartDate(issueDate, carryoverDays) {
  const days = Number(carryoverDays)
  return shiftIsoDate(issueDate, Number.isFinite(days) ? Math.max(Math.round(days), 0) : 0)
}

function getPaperDiscoveredDate(paper) {
  return paper?.discoveredDate || paper?.issueDate || ''
}

// A paper that qualifies today but loses its slot stays "deferred" so a later issue can
// still pick it up. Without this, everything below the daily cap was discarded forever.
function getDesiredSelectionStatus(paper, minPriorityScore) {
  return isAutomatedDigestCandidate(paper, minPriorityScore)
    ? RESEARCH_DIGEST_SELECTION_STATUS.deferred
    : RESEARCH_DIGEST_SELECTION_STATUS.notSelected
}

// Everything selection actually reads. The admin pool view adds display-only fields on top so
// the diagnostics page can name a paper without running a second query against a different filter.
const DIGEST_POOL_SELECTION_FIELDS = `_id,
    pmid,
    pubDate,
    issueDate,
    discoveredDate,
    publicationTypes,
    triageStatus,
    tier,
    priorityScore,
    whyItMatters,
    summary,
    triageError,
    approvalStatus,
    autoSelected,
    autoSelectionExcluded,
    autoSelectionStatus`

const DIGEST_POOL_ADMIN_FIELDS = `,
    title,
    journal,
    url,
    doi,
    topics,
    carriedOverFrom,
    matchedJournalGroups`

// The pool is everything imported today plus anything that qualified on an earlier day but
// lost its slot and has not gone stale yet. Today's papers are included regardless of status
// so that re-running selection for the same day is idempotent.
export function buildDigestSelectionPoolQuery({ includeAdminFields = false } = {}) {
  return `*[_type == "researchDigestPaper"
    && coalesce(discoveredDate, issueDate) >= $carryoverFrom
    && (issueDate == $issueDate || (autoSelectionStatus != "selected" && approvalStatus != "approved"))
  ]{
    ${DIGEST_POOL_SELECTION_FIELDS}${includeAdminFields ? DIGEST_POOL_ADMIN_FIELDS : ''}
  }`
}

export function summarizeDigestPoolScores(papers = []) {
  const scores = papers.map(getDigestPriorityScore).sort((a, b) => b - a)
  if (!scores.length) return { count: 0 }
  return {
    count: scores.length,
    max: scores[0],
    median: scores[Math.floor((scores.length - 1) / 2)],
    min: scores[scores.length - 1],
    atLeast90: scores.filter((score) => score >= 90).length,
    atLeast75: scores.filter((score) => score >= 75).length,
    atLeast60: scores.filter((score) => score >= 60).length,
  }
}

async function ensureDigestIssue(issueDate, nowIso) {
  const issueId = `researchDigestIssue.${issueDate}`
  await writeClient.createIfNotExists({
    _id: issueId,
    _type: 'researchDigestIssue',
    date: issueDate,
    title: `KCRU kidney research digest - ${issueDate}`,
    slug: { _type: 'slug', current: issueDate },
    status: RESEARCH_DIGEST_ISSUE_STATUS.draft,
    createdAt: nowIso,
    updatedAt: nowIso,
  })
  return issueId
}

function getLlmOptions(settings = {}) {
  return {
    provider: settings.llmProvider || settings.llmClassificationProvider || settings.llmProviderFallback,
    model: settings.llmModel || settings.llmClassificationModel || settings.llmModelFallback,
  }
}

async function triagePublication(pub, settings) {
  if (hasExcludedDigestPublicationType(pub?.publicationTypes)) {
    return {
      triageStatus: RESEARCH_DIGEST_TRIAGE.exclude,
      tier: 'Tier 3',
      priorityScore: 0,
      whyItMatters: 'Excluded because its publication type is not suitable for the daily research digest.',
      summary: '',
      topics: [],
      triageError: null,
    }
  }

  try {
    const triage = await generateResearchDigestTriage(pub, getLlmOptions(settings))
    return {
      triageStatus: triage.relevance,
      tier: triage.tier,
      priorityScore: triage.priorityScore,
      whyItMatters: triage.whyItMatters,
      summary: triage.summary,
      topics: triage.topics,
      triageError: null,
    }
  } catch (error) {
    return {
      triageStatus: RESEARCH_DIGEST_TRIAGE.maybe,
      tier: 'Tier 3',
      priorityScore: 0,
      whyItMatters: 'Needs curator review before publication.',
      summary: '',
      topics: [],
      triageError: error?.message || 'LLM triage failed',
    }
  }
}

export async function fetchResearchDigestPubMedCandidates({ settings = {}, now = new Date() } = {}) {
  const groups = getResearchDigestJournalGroups(settings)
  const window = getResearchDigestWindow(now)
  const pmidGroups = new Map()
  const errors = []
  const truncatedGroups = []

  for (const group of groups) {
    try {
      const query = buildJournalGroupPubMedQuery(group, window)
      const { pmids, total } = await searchPubMedWithTotal(query, MAX_PUBMED_RESULTS_PER_GROUP)
      if (total > pmids.length) {
        // Silent truncation used to hide whole journals on busy weeks.
        truncatedGroups.push({ source: group.title, retrieved: pmids.length, total })
      }
      for (const pmid of pmids) {
        const matches = pmidGroups.get(pmid) || []
        matches.push({ key: group.key, title: group.title })
        pmidGroups.set(pmid, matches)
      }
    } catch (error) {
      errors.push({
        source: group.title,
        message: error?.message || 'PubMed search failed',
      })
    }
  }

  const publications = await fetchPublicationsWithAbstracts(Array.from(pmidGroups.keys()))
  return {
    configuredGroups: groups.length,
    window,
    truncatedGroups,
    publications: publications.map((pub) => {
      const groupsForPmid = pmidGroups.get(pub.pmid) || []
      return {
        ...pub,
        matchedJournalGroups: groupsForPmid.map((group) => group.title),
        matchedJournalGroupKeys: groupsForPmid.map((group) => group.key),
      }
    }),
    errors,
  }
}

export async function reselectAutomatedDigestIssue({
  settings = {},
  now = new Date(),
  issueDate,
} = {}) {
  if (!writeClient.config().token) {
    throw new Error('SANITY_API_TOKEN missing; cannot reselect research digest papers.')
  }

  const normalizedSettings = normalizeResearchDigestSettings(settings)
  const resolvedIssueDate = issueDate || formatResearchDigestDate(now)
  const issueId = `researchDigestIssue.${resolvedIssueDate}`
  const issue = await writeClient.fetch(`*[_id == $issueId][0]{ _id }`, { issueId })
  if (!issue?._id) {
    throw new Error(`No research digest issue found for ${resolvedIssueDate}.`)
  }

  return {
    issueDate: resolvedIssueDate,
    ...await finalizeAutomatedDigestIssue({
      issueId,
      issueDate: resolvedIssueDate,
      settings: normalizedSettings,
      nowIso: now.toISOString(),
      dryRun: false,
    }),
  }
}

async function finalizeAutomatedDigestIssue({
  issueId,
  issueDate,
  settings,
  nowIso,
  dryRun,
  dryRunPapers = [],
}) {
  if (!settings.automaticSelection) {
    return { mode: 'manual', eligible: 0, selected: 0 }
  }

  const carryoverFrom = getCarryoverStartDate(issueDate, settings.carryoverDays)
  const poolQuery = buildDigestSelectionPoolQuery()

  let issue = null
  let papers = dryRunPapers
  if (dryRun) {
    // Read-only, so a dry run can still show what carryover would contribute.
    const carried = writeClient.config().token
      ? await writeClient.fetch(poolQuery, { carryoverFrom, issueDate }).catch(() => [])
      : []
    const createdIds = new Set(dryRunPapers.map((paper) => paper._id))
    papers = [...dryRunPapers, ...(carried || []).filter((paper) => !createdIds.has(paper._id))]
  } else {
    const payload = await writeClient.fetch(
      `{ "issue": *[_id == $issueId][0]{ _id, status }, "papers": ${poolQuery} }`,
      { issueId, issueDate, carryoverFrom }
    )
    issue = payload?.issue || null
    papers = payload?.papers || []
  }

  if (
    issue?.status === RESEARCH_DIGEST_ISSUE_STATUS.approved ||
    issue?.status === RESEARCH_DIGEST_ISSUE_STATUS.sent
  ) {
    const selected = papers.filter((paper) => (
      paper.issueDate === issueDate && paper.approvalStatus === RESEARCH_DIGEST_APPROVAL.approved
    ))
    return {
      mode: 'automated',
      frozen: true,
      pool: papers.length,
      eligible: selected.length,
      selected: selected.length,
      carriedOver: 0,
      scores: summarizeDigestPoolScores(papers),
    }
  }

  const eligible = papers.filter((paper) => isAutomatedDigestCandidate(paper, settings.minPriorityScore))
  const selectedPapers = selectAutomatedDigestPapers(papers, settings)
  const carriedOver = selectedPapers.filter((paper) => getPaperDiscoveredDate(paper) !== issueDate).length

  if (!dryRun && issueId) {
    const selectedIds = new Set(selectedPapers.map((paper) => paper._id))
    const patches = []

    for (const paper of papers) {
      if (selectedIds.has(paper._id)) {
        const discoveredDate = getPaperDiscoveredDate(paper)
        patches.push([paper._id, {
          approvalStatus: RESEARCH_DIGEST_APPROVAL.approved,
          approvedAt: nowIso,
          rejectedAt: null,
          autoSelected: true,
          autoSelectionStatus: RESEARCH_DIGEST_SELECTION_STATUS.selected,
          // Carried-over papers move into the issue that actually ships them, so the
          // dispatch and archive queries keep working off a single issueDate.
          issueDate,
          issue: { _type: 'reference', _ref: issueId },
          discoveredDate: discoveredDate || issueDate,
          carriedOverFrom: discoveredDate && discoveredDate !== issueDate ? discoveredDate : null,
          updatedAt: nowIso,
        }])
        continue
      }

      // Skip no-op writes so a multi-day pool does not rewrite every unchanged paper daily.
      const desiredStatus = getDesiredSelectionStatus(paper, settings.minPriorityScore)
      const wasPromoted = paper.autoSelected || paper.approvalStatus === RESEARCH_DIGEST_APPROVAL.approved
      if (!wasPromoted && paper.autoSelectionStatus === desiredStatus) continue

      patches.push([paper._id, {
        approvalStatus: RESEARCH_DIGEST_APPROVAL.rejected,
        approvedAt: null,
        rejectedAt: nowIso,
        autoSelected: false,
        autoSelectionStatus: desiredStatus,
        updatedAt: nowIso,
      }])
    }

    // The pool spans several days, so commit in chunks rather than one oversized transaction.
    for (let start = 0; start < patches.length; start += SELECTION_PATCH_CHUNK_SIZE) {
      const chunk = patches.slice(start, start + SELECTION_PATCH_CHUNK_SIZE)
      let transaction = writeClient.transaction()
      for (const [id, set] of chunk) {
        transaction = transaction.patch(id, { set })
      }
      await transaction.commit({ returnDocuments: false })
    }

    // Committed last so the issue is only marked approved once its papers are in place.
    await writeClient
      .patch(issueId)
      .set({
        status: selectedPapers.length
          ? RESEARCH_DIGEST_ISSUE_STATUS.approved
          : RESEARCH_DIGEST_ISSUE_STATUS.draft,
        approvedAt: selectedPapers.length ? nowIso : null,
        selectionMode: 'automated',
        selectedPaperCount: selectedPapers.length,
        carriedOverPaperCount: carriedOver,
        updatedAt: nowIso,
      })
      .commit({ returnDocuments: false })
  }

  return {
    mode: 'automated',
    frozen: false,
    pool: papers.length,
    eligible: eligible.length,
    selected: selectedPapers.length,
    carriedOver,
    deferred: Math.max(eligible.length - selectedPapers.length, 0),
    scores: summarizeDigestPoolScores(papers),
  }
}

export async function importResearchDigestPapers({ settings = {}, now = new Date(), dryRun = false } = {}) {
  if (!writeClient.config().token) {
    throw new Error('SANITY_API_TOKEN missing; cannot import research digest papers.')
  }

  const normalizedSettings = normalizeResearchDigestSettings(settings)
  const nowIso = now.toISOString()
  const issueDate = formatResearchDigestDate(now)
  const issueId = dryRun ? null : await ensureDigestIssue(issueDate, nowIso)
  const { publications, configuredGroups, window, errors, truncatedGroups } = await fetchResearchDigestPubMedCandidates({
    settings: normalizedSettings,
    now,
  })
  const { existingKeys, retryDocumentIds } = await fetchExistingPaperState(publications)
  const newPublications = publications.filter((pub) => !hasExistingPaper(existingKeys, pub))
  const created = []

  // LLM triage dominates import wall-clock, so run a bounded pool rather than one at a time.
  const triageResults = await mapWithConcurrency(
    newPublications,
    TRIAGE_CONCURRENCY,
    (pub) => triagePublication(pub, normalizedSettings)
  )

  for (const [index, pub] of newPublications.entries()) {
    const triage = triageResults[index]
    const isAutomatic = normalizedSettings.automaticSelection
    const approvalStatus = isAutomatic
      ? RESEARCH_DIGEST_APPROVAL.rejected
      : inferPaperApprovalStatus(triage.triageStatus)
    const doc = {
      _id: safeDocumentId('researchDigestPaper', pub.pmid || pub.doi || pub.title),
      _type: 'researchDigestPaper',
      issueDate,
      discoveredDate: issueDate,
      issue: issueId ? { _type: 'reference', _ref: issueId } : undefined,
      pmid: pub.pmid || null,
      doi: pub.doi || null,
      title: pub.title || 'Untitled publication',
      abstract: pub.abstract || '',
      authors: Array.isArray(pub.authors) ? pub.authors.slice(0, 20) : [],
      publicationTypes: Array.isArray(pub.publicationTypes) ? pub.publicationTypes.slice(0, 20) : [],
      journal: pub.journal || '',
      pubDate: pub.pubDate || pub.publishedAt || '',
      year: pub.year ? Number(pub.year) : null,
      url: pub.url || (pub.pmid ? `https://pubmed.ncbi.nlm.nih.gov/${pub.pmid}/` : null),
      matchedJournalGroups: pub.matchedJournalGroups || [],
      matchedJournalGroupKeys: pub.matchedJournalGroupKeys || [],
      triageStatus: triage.triageStatus,
      approvalStatus,
      tier: triage.tier,
      priorityScore: triage.priorityScore,
      whyItMatters: triage.whyItMatters,
      summary: triage.summary,
      topics: triage.topics,
      triageError: triage.triageError,
      autoSelected: false,
      autoSelectionStatus: isAutomatic ? RESEARCH_DIGEST_SELECTION_STATUS.notSelected : null,
      retrievalWindowDays: window.days,
      retrievedAt: nowIso,
      createdAt: nowIso,
      updatedAt: nowIso,
      rejectedAt: approvalStatus === RESEARCH_DIGEST_APPROVAL.rejected ? nowIso : null,
    }
    created.push(doc)
    if (!dryRun) {
      if (retryDocumentIds.has(doc._id)) {
        const retryFields = { ...doc }
        delete retryFields._id
        delete retryFields._type
        await writeClient
          .patch(doc._id)
          .set(retryFields)
          .commit({ returnDocuments: false })
      } else {
        await writeClient.createIfNotExists(doc)
      }
    }
  }

  if (!dryRun && issueId) {
    await writeClient
      .patch(issueId)
      .set({ updatedAt: nowIso, retrievalWindowDays: window.days })
      .commit({ returnDocuments: false })
  }

  const selection = await finalizeAutomatedDigestIssue({
    issueId,
    issueDate,
    settings: normalizedSettings,
    nowIso,
    dryRun,
    dryRunPapers: created,
  })

  return {
    issueDate,
    configuredGroups,
    window,
    fetched: publications.length,
    existing: publications.length - newPublications.length,
    created: created.length,
    llmTriageAttempts: created.filter((paper) => !hasExcludedDigestPublicationType(paper.publicationTypes)).length,
    triageErrors: created.filter((paper) => paper.triageError).length,
    selection,
    truncatedGroups,
    errors,
  }
}

function extractTag(block, tagName) {
  const pattern = new RegExp(`<${tagName}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tagName}>`, 'i')
  return cleanText(pattern.exec(block)?.[1] || '')
}

function extractFeedLink(block) {
  const atomLink = /<link[^>]+href=["']([^"']+)["'][^>]*>/i.exec(block)?.[1]
  if (atomLink) return cleanText(atomLink)
  return cleanText(/<link(?:\s[^>]*)?>([\s\S]*?)<\/link>/i.exec(block)?.[1] || '')
}

function extractDeadline(text) {
  const match = String(text || '').match(/\b(?:deadline|due|apply by|submission deadline)\s*:?\s*([A-Z][a-z]+\.?\s+\d{1,2},?\s+\d{4}|\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{2,4})/i)
  if (!match) return null
  const parsed = new Date(match[1])
  if (Number.isNaN(parsed.getTime())) return null
  return parsed.toISOString().slice(0, 10)
}

export function parseOpportunityFeed(xml, source = {}) {
  const text = String(xml || '')
  const blocks = text.match(/<item\b[\s\S]*?<\/item>/gi) || text.match(/<entry\b[\s\S]*?<\/entry>/gi) || []
  return blocks.map((block) => {
    const title = extractTag(block, 'title')
    const description = extractTag(block, 'description') || extractTag(block, 'summary') || extractTag(block, 'content')
    const url = normalizeOpportunityUrl(extractFeedLink(block))
    const sourceId = extractTag(block, 'guid') || extractTag(block, 'id') || url
    const deadline = extractDeadline(`${title} ${description}`)
    return {
      type: source.type || RESEARCH_OPPORTUNITY_TYPES.other,
      sourceName: source.name || '',
      sourceUrl: source.url || '',
      sourceId,
      title,
      description,
      url,
      deadline,
      eligibility: '',
      topics: source.topics || [],
    }
  }).filter((item) => item.title && item.url)
}

async function fetchFeedText(url) {
  const { text } = await safeFetchText(url, {
    timeoutMs: FEED_FETCH_TIMEOUT_MS,
    maxBytes: FEED_MAX_BYTES,
    headers: { 'User-Agent': 'KCRU Research Digest (https://www.kcru.ca)' },
    allowedContentTypes: ['application/rss+xml', 'application/atom+xml', 'application/xml', 'text/xml'],
  })
  return text
}

async function fetchExistingOpportunities(items) {
  const urls = items.map((item) => normalizeOpportunityUrl(item.url)).filter(Boolean)
  const sourceIds = items.map((item) => String(item.sourceId || '')).filter(Boolean)
  const sourceNames = Array.from(new Set(items.map((item) => item.sourceName).filter(Boolean)))
  const rows = await writeClient.fetch(
    `*[_type == "researchOpportunity" && (url in $urls || sourceId in $sourceIds || sourceName in $sourceNames)]{
      title,
      deadline,
      url,
      sourceId,
      sourceName
    }`,
    { urls, sourceIds, sourceNames }
  )
  return rows || []
}

function isDuplicateOpportunity(item, existingRows) {
  const itemUrl = normalizeOpportunityUrl(item.url)
  const itemTitle = normalizeDigestKey(item.title)
  const itemDeadline = item.deadline || ''
  return existingRows.some((row) => {
    if (itemUrl && normalizeOpportunityUrl(row.url) === itemUrl) return true
    if (item.sourceId && row.sourceId && item.sourceId === row.sourceId) return true
    return itemTitle && normalizeDigestKey(row.title) === itemTitle && (row.deadline || '') === itemDeadline
  })
}

export async function importResearchOpportunities({ settings = {}, now = new Date(), dryRun = false } = {}) {
  if (!writeClient.config().token) {
    throw new Error('SANITY_API_TOKEN missing; cannot import research opportunities.')
  }

  const sources = getResearchDigestOpportunitySources(settings)
  const errors = []
  const candidates = []

  for (const source of sources) {
    try {
      const xml = await fetchFeedText(source.url)
      candidates.push(...parseOpportunityFeed(xml, source))
    } catch (error) {
      errors.push({
        source: source.name,
        message: error?.message || 'Opportunity feed failed',
      })
    }
  }

  const existingRows = await fetchExistingOpportunities(candidates)
  const newItems = candidates.filter((item) => !isDuplicateOpportunity(item, existingRows))
  const nowIso = now.toISOString()

  for (const item of newItems) {
    const idSource = item.sourceId || item.url || item.title
    const doc = {
      _id: safeDocumentId('researchOpportunity', idSource),
      _type: 'researchOpportunity',
      ...item,
      status: 'open',
      approvalStatus: RESEARCH_DIGEST_APPROVAL.pending,
      retrievedAt: nowIso,
      createdAt: nowIso,
      updatedAt: nowIso,
    }
    if (!dryRun) {
      await writeClient.createIfNotExists(doc)
    }
  }

  return {
    configuredSources: sources.length,
    fetched: candidates.length,
    existing: candidates.length - newItems.length,
    created: newItems.length,
    errors,
  }
}

export async function importResearchDigestContent({ settings = {}, now = new Date(), dryRun = false } = {}) {
  const normalizedSettings = normalizeResearchDigestSettings(settings)
  const papers = await importResearchDigestPapers({ settings: normalizedSettings, now, dryRun })
  const opportunities = normalizedSettings.automaticSelection
    ? {
      configuredSources: 0,
      fetched: 0,
      existing: 0,
      created: 0,
      errors: [],
      skipped: true,
      reason: 'Opportunity imports are disabled while automated daily paper selection is enabled.',
    }
    : await importResearchOpportunities({ settings: normalizedSettings, now, dryRun })

  return { papers, opportunities }
}

// Shared by the dispatch route and the admin email preview. Keeping one query means the
// preview cannot quietly drift from the papers a real send would put in the email.
export async function fetchResearchDigestIssueBundle({
  issueDate,
  maxPapers,
  maxOpportunities,
  automaticSelection,
  now = new Date(),
} = {}) {
  const today = formatResearchDigestDate(now)
  const query = `{
    "issue": *[_type == "researchDigestIssue" && date == $issueDate][0]{
      _id,
      title,
      date,
      "slug": slug.current,
      status,
      intro,
      approvedAt,
      sentAt
    },
    "papers": *[_type == "researchDigestPaper" && issueDate == $issueDate && approvalStatus == "approved" && autoSelectionExcluded != true && ($automaticSelection == false || autoSelected == true)] | order(priorityScore desc, tier asc, journal asc, title asc)[0...$maxPapers]{
      _id,
      pmid,
      doi,
      title,
      authors,
      journal,
      pubDate,
      year,
      url,
      matchedJournalGroups,
      tier,
      priorityScore,
      whyItMatters,
      summary,
      topics
    },
    "opportunities": *[_type == "researchOpportunity" && $automaticSelection == false && approvalStatus == "approved" && status in ["open", "upcoming"] && (!defined(deadline) || deadline >= $today)] | order(deadline asc, title asc)[0...$maxOpportunities]{
      _id,
      type,
      status,
      sourceName,
      title,
      description,
      deadline,
      eligibility,
      url,
      topics
    }
  }`
  return writeClient.fetch(query, {
    issueDate,
    today,
    maxPapers,
    maxOpportunities,
    automaticSelection,
  })
}

export async function fetchResearchDigestSettings() {
  const fetcher = writeClient.config().token ? writeClient.fetch.bind(writeClient) : sanityFetch
  const result = await fetcher(
    `*[_type == "siteSettings"][0]{
      researchDigest,
      llmProvider,
      llmModel,
      llmClassificationProvider,
      llmClassificationModel,
      updateEmailTesting{ enabled, recipients }
    }`
  )
  return {
    settings: normalizeResearchDigestSettings({
      ...DEFAULT_RESEARCH_DIGEST_SETTINGS,
      ...(result?.researchDigest || {}),
      llmProviderFallback: result?.llmProvider,
      llmModelFallback: result?.llmModel,
      llmClassificationProvider: result?.llmClassificationProvider,
      llmClassificationModel: result?.llmClassificationModel,
    }),
    testing: result?.updateEmailTesting || {},
  }
}
