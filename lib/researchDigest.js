import { createHash } from 'crypto'

import { sanityFetch, writeClient } from './sanity.js'
import { searchPubMed, fetchPublicationsWithAbstracts } from './pubmed.js'
import { generateResearchDigestTriage } from './summaries.js'
import {
  DEFAULT_RESEARCH_DIGEST_SETTINGS,
  RESEARCH_DIGEST_APPROVAL,
  RESEARCH_DIGEST_ISSUE_STATUS,
  RESEARCH_DIGEST_TIMEZONE,
  RESEARCH_DIGEST_TRIAGE,
  RESEARCH_OPPORTUNITY_TYPES,
  getResearchDigestJournalGroups,
  getResearchDigestOpportunitySources,
  normalizeResearchDigestSettings,
} from './researchDigestConfig.js'

const MAX_PUBMED_RESULTS_PER_GROUP = Number(process.env.RESEARCH_DIGEST_MAX_PUBMED_PER_GROUP || 80)
const FEED_FETCH_TIMEOUT_MS = Number(process.env.RESEARCH_DIGEST_FEED_TIMEOUT_MS || 12000)
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

function getDigestPriorityScore(paper) {
  const rawScore = paper?.priorityScore
  if (rawScore !== null && rawScore !== undefined && rawScore !== '') {
    const explicitScore = Number(rawScore)
    if (Number.isFinite(explicitScore)) {
      return Math.min(Math.max(Math.round(explicitScore), 0), 100)
    }
  }
  return TIER_FALLBACK_SCORES[paper?.tier] || 0
}

function isAutomatedDigestCandidate(paper, minPriorityScore) {
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
    apiKey: settings.llmApiKey || settings.llmClassificationApiKey || settings.llmApiKeyFallback,
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

  for (const group of groups) {
    try {
      const query = buildJournalGroupPubMedQuery(group, window)
      const pmids = await searchPubMed(query, MAX_PUBMED_RESULTS_PER_GROUP)
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

  let issue = null
  let papers = dryRunPapers
  if (!dryRun) {
    const payload = await writeClient.fetch(
      `{
        "issue": *[_id == $issueId][0]{ _id, status },
        "papers": *[_type == "researchDigestPaper" && issueDate == $issueDate]{
          _id,
          pmid,
          pubDate,
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
          autoSelectionStatus
        }
      }`,
      { issueId, issueDate }
    )
    issue = payload?.issue || null
    papers = payload?.papers || []
  }

  if (
    issue?.status === RESEARCH_DIGEST_ISSUE_STATUS.approved ||
    issue?.status === RESEARCH_DIGEST_ISSUE_STATUS.sent
  ) {
    const selected = papers.filter((paper) => paper.approvalStatus === RESEARCH_DIGEST_APPROVAL.approved)
    return {
      mode: 'automated',
      frozen: true,
      eligible: selected.length,
      selected: selected.length,
    }
  }

  const eligible = papers.filter((paper) => isAutomatedDigestCandidate(paper, settings.minPriorityScore))
  const selectedPapers = selectAutomatedDigestPapers(papers, settings)
  if (!dryRun && issueId) {
    const selectedIds = new Set(selectedPapers.map((paper) => paper._id))
    let transaction = writeClient.transaction()

    for (const paper of papers) {
      if (selectedIds.has(paper._id)) {
        transaction = transaction.patch(paper._id, {
          set: {
            approvalStatus: RESEARCH_DIGEST_APPROVAL.approved,
            approvedAt: nowIso,
            rejectedAt: null,
            autoSelected: true,
            autoSelectionStatus: 'selected',
            updatedAt: nowIso,
          },
        })
      } else if (paper.autoSelected || paper.approvalStatus === RESEARCH_DIGEST_APPROVAL.approved) {
        transaction = transaction.patch(paper._id, {
          set: {
            approvalStatus: RESEARCH_DIGEST_APPROVAL.rejected,
            approvedAt: null,
            rejectedAt: nowIso,
            autoSelected: false,
            autoSelectionStatus: 'not_selected',
            updatedAt: nowIso,
          },
        })
      }
    }

    transaction = transaction.patch(issueId, {
      set: {
        status: selectedPapers.length
          ? RESEARCH_DIGEST_ISSUE_STATUS.approved
          : RESEARCH_DIGEST_ISSUE_STATUS.draft,
        approvedAt: selectedPapers.length ? nowIso : null,
        selectionMode: 'automated',
        selectedPaperCount: selectedPapers.length,
        updatedAt: nowIso,
      },
    })
    await transaction.commit({ returnDocuments: false })
  }

  return {
    mode: 'automated',
    frozen: false,
    eligible: eligible.length,
    selected: selectedPapers.length,
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
  const { publications, configuredGroups, window, errors } = await fetchResearchDigestPubMedCandidates({
    settings: normalizedSettings,
    now,
  })
  const { existingKeys, retryDocumentIds } = await fetchExistingPaperState(publications)
  const newPublications = publications.filter((pub) => !hasExistingPaper(existingKeys, pub))
  const created = []

  for (const pub of newPublications) {
    const triage = await triagePublication(pub, normalizedSettings)
    const isAutomatic = normalizedSettings.automaticSelection
    const approvalStatus = isAutomatic
      ? RESEARCH_DIGEST_APPROVAL.rejected
      : inferPaperApprovalStatus(triage.triageStatus)
    const doc = {
      _id: safeDocumentId('researchDigestPaper', pub.pmid || pub.doi || pub.title),
      _type: 'researchDigestPaper',
      issueDate,
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
      autoSelectionStatus: isAutomatic ? 'not_selected' : null,
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
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), FEED_FETCH_TIMEOUT_MS)
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'KCRU Research Digest (https://www.kcru.ca)' },
      signal: controller.signal,
    })
    if (!response.ok) {
      throw new Error(`Feed request failed ${response.status}`)
    }
    return response.text()
  } finally {
    clearTimeout(timeout)
  }
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

export async function fetchResearchDigestSettings() {
  const fetcher = writeClient.config().token ? writeClient.fetch.bind(writeClient) : sanityFetch
  const result = await fetcher(
    `*[_type == "siteSettings"][0]{
      researchDigest,
      llmProvider,
      llmModel,
      llmApiKey,
      llmClassificationProvider,
      llmClassificationModel,
      llmClassificationApiKey,
      updateEmailTesting{ enabled, recipients }
    }`
  )
  return {
    settings: normalizeResearchDigestSettings({
      ...DEFAULT_RESEARCH_DIGEST_SETTINGS,
      ...(result?.researchDigest || {}),
      llmProviderFallback: result?.llmProvider,
      llmModelFallback: result?.llmModel,
      llmApiKeyFallback: result?.llmApiKey,
      llmClassificationProvider: result?.llmClassificationProvider,
      llmClassificationModel: result?.llmClassificationModel,
      llmClassificationApiKey: result?.llmClassificationApiKey,
    }),
    testing: result?.updateEmailTesting || {},
  }
}
