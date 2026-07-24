import {
  buildDigestSelectionPoolQuery,
  getDigestPriorityScore,
  hasExcludedDigestPublicationType,
} from './researchDigest.js'
import {
  RESEARCH_DIGEST_MAX_CARRYOVER_DAYS,
  RESEARCH_DIGEST_MAX_PAPERS_CEILING,
  RESEARCH_DIGEST_PREF,
  RESEARCH_DIGEST_SELECTION_STATUS,
  RESEARCH_DIGEST_TRIAGE,
} from './researchDigestConfig.js'
import { isSubscriberDeliverable, resolveDeliveryStatus, resolveSubscriptionStatus } from './updateSubscriberStatus.js'

export const DIGEST_ADMIN_HISTORY_LIMIT = 30
export const DIGEST_ADMIN_SUBSCRIBER_LIMIT = 500

/**
 * The whole diagnostics payload in one round trip. Built here rather than inline in the route so
 * its GROQ can be parsed in tests — a syntax error in a query this size would otherwise only
 * surface as a 500 against the live dataset.
 *
 * Takes $issueDate and $carryoverFrom. The embedded selection-pool sub-query reads $issueDate,
 * so every section here uses that same name — a second parameter for the same date would leave
 * the pool filtering against an undefined value and silently drop the selected paper.
 */
export function buildResearchDigestAdminQuery({
  historyLimit = DIGEST_ADMIN_HISTORY_LIMIT,
  subscriberLimit = DIGEST_ADMIN_SUBSCRIBER_LIMIT,
} = {}) {
  return `{
    "issue": *[_type == "researchDigestIssue" && date == $issueDate][0]{
      _id,
      title,
      date,
      "slug": slug.current,
      status,
      intro,
      approvedAt,
      sentAt,
      retrievalWindowDays,
      selectionMode,
      selectedPaperCount,
      carriedOverPaperCount
    },
    "history": *[_type == "researchDigestIssue"] | order(date desc)[0...${historyLimit}]{
      _id,
      title,
      date,
      "slug": slug.current,
      status,
      approvedAt,
      sentAt,
      selectionMode,
      selectedPaperCount,
      carriedOverPaperCount,
      retrievalWindowDays,
      "pendingPapers": count(*[_type == "researchDigestPaper" && issueDate == ^.date && approvalStatus == "pending"]),
      "approvedPapers": count(*[_type == "researchDigestPaper" && issueDate == ^.date && approvalStatus == "approved"]),
      "importedPapers": count(*[_type == "researchDigestPaper" && coalesce(discoveredDate, issueDate) == ^.date])
    },
    "papers": *[_type == "researchDigestPaper" && issueDate == $issueDate] | order(approvalStatus asc, triageStatus asc, journal asc, title asc){
      _id,
      issueDate,
      discoveredDate,
      carriedOverFrom,
      pmid,
      doi,
      title,
      abstract,
      authors,
      publicationTypes,
      journal,
      pubDate,
      year,
      url,
      matchedJournalGroups,
      triageStatus,
      approvalStatus,
      tier,
      priorityScore,
      whyItMatters,
      summary,
      topics,
      triageError,
      autoSelected,
      autoSelectionStatus,
      autoSelectionExcluded,
      retrievedAt,
      approvedAt,
      rejectedAt
    },
    "pool": ${buildDigestSelectionPoolQuery({ includeAdminFields: true })} | order(priorityScore desc, title asc),
    "opportunities": *[_type == "researchOpportunity" && approvalStatus in ["pending", "approved"] && status in ["open", "upcoming"]] | order(approvalStatus asc, deadline asc, title asc)[0...80]{
      _id,
      type,
      status,
      approvalStatus,
      sourceName,
      sourceUrl,
      title,
      description,
      deadline,
      eligibility,
      url,
      topics,
      retrievedAt,
      approvedAt,
      rejectedAt
    },
    "subscribers": *[_type == "updateSubscriber" && "${RESEARCH_DIGEST_PREF}" in correspondencePreferences && defined(email)] | order(email asc)[0...${subscriberLimit}]{
      _id,
      name,
      email,
      subscriptionStatus,
      deliveryStatus,
      role,
      lastResearchDigestSentAt,
      createdAt
    },
    "stats": {
      "pendingPapers": count(*[_type == "researchDigestPaper" && approvalStatus == "pending"]),
      "approvedPapersToday": count(*[_type == "researchDigestPaper" && issueDate == $issueDate && approvalStatus == "approved"]),
      "pendingOpportunities": count(*[_type == "researchOpportunity" && approvalStatus == "pending"]),
      "approvedOpenOpportunities": count(*[_type == "researchOpportunity" && approvalStatus == "approved" && status in ["open", "upcoming"]]),
      "totalPapers": count(*[_type == "researchDigestPaper"]),
      "deferredPapers": count(*[_type == "researchDigestPaper" && autoSelectionStatus == "deferred"])
    }
  }`
}

export const DIGEST_DISPOSITION = Object.freeze({
  selected: 'selected',
  deferred: 'deferred',
  triageFailed: 'triage_failed',
  triageExcluded: 'triage_excluded',
  missingCopy: 'missing_copy',
  manuallyExcluded: 'manually_excluded',
  excludedType: 'excluded_type',
  belowThreshold: 'below_threshold',
})

const DISPOSITION_LABELS = Object.freeze({
  [DIGEST_DISPOSITION.selected]: 'Selected',
  [DIGEST_DISPOSITION.deferred]: 'Deferred',
  [DIGEST_DISPOSITION.triageFailed]: 'Triage failed',
  [DIGEST_DISPOSITION.triageExcluded]: 'Triage excluded',
  [DIGEST_DISPOSITION.missingCopy]: 'Missing copy',
  [DIGEST_DISPOSITION.manuallyExcluded]: 'Manually excluded',
  [DIGEST_DISPOSITION.excludedType]: 'Excluded type',
  [DIGEST_DISPOSITION.belowThreshold]: 'Below threshold',
})

export function getDigestDispositionLabel(status) {
  return DISPOSITION_LABELS[status] || status || 'Unknown'
}

function hasText(value) {
  return Boolean(String(value || '').trim())
}

// Mirrors the order of the conditions inside isAutomatedDigestCandidate so the page reports
// the reason selection actually stopped at, rather than the first one a reader might guess.
function findBlockingReason(paper, minPriorityScore) {
  const score = getDigestPriorityScore(paper)

  if (paper?.triageError) {
    return { status: DIGEST_DISPOSITION.triageFailed, reason: `LLM triage failed: ${paper.triageError}` }
  }
  if (paper?.triageStatus !== RESEARCH_DIGEST_TRIAGE.include) {
    return {
      status: DIGEST_DISPOSITION.triageExcluded,
      reason: `Triage returned "${paper?.triageStatus || 'no verdict'}" rather than "include".`,
    }
  }
  if (!hasText(paper?.summary) || !hasText(paper?.whyItMatters)) {
    const missing = [!hasText(paper?.summary) ? 'summary' : '', !hasText(paper?.whyItMatters) ? 'why it matters' : '']
      .filter(Boolean)
      .join(' and ')
    return { status: DIGEST_DISPOSITION.missingCopy, reason: `Cannot ship without ${missing}.` }
  }
  if (paper?.autoSelectionExcluded) {
    return { status: DIGEST_DISPOSITION.manuallyExcluded, reason: 'Excluded by hand from automated selection.' }
  }
  if (hasExcludedDigestPublicationType(paper?.publicationTypes)) {
    const types = (Array.isArray(paper?.publicationTypes) ? paper.publicationTypes : []).join(', ')
    return { status: DIGEST_DISPOSITION.excludedType, reason: `Publication type not eligible${types ? `: ${types}` : '.'}` }
  }
  if (score < minPriorityScore) {
    return {
      status: DIGEST_DISPOSITION.belowThreshold,
      reason: `Scored ${score}, below the ${minPriorityScore} threshold.`,
    }
  }
  return null
}

/**
 * Explains where one pooled paper stands, and why. `issueDate` is the issue being inspected,
 * which is what makes a carried-over paper distinguishable from one found the same morning.
 */
export function describePoolPaperDisposition(paper, settings = {}, { issueDate = '' } = {}) {
  const minPriorityScore = Number.isFinite(Number(settings?.minPriorityScore))
    ? Number(settings.minPriorityScore)
    : 75
  const score = getDigestPriorityScore(paper)
  const discoveredDate = paper?.discoveredDate || paper?.issueDate || ''
  const carriedOver = Boolean(discoveredDate && issueDate && discoveredDate !== issueDate)
  const blocking = findBlockingReason(paper, minPriorityScore)

  if (!blocking) {
    const isSelected = paper?.autoSelectionStatus === RESEARCH_DIGEST_SELECTION_STATUS.selected ||
      paper?.autoSelected === true
    return {
      status: isSelected ? DIGEST_DISPOSITION.selected : DIGEST_DISPOSITION.deferred,
      label: getDigestDispositionLabel(isSelected ? DIGEST_DISPOSITION.selected : DIGEST_DISPOSITION.deferred),
      reason: isSelected
        ? 'Shipping in this issue.'
        : 'Qualifies but lost its slot; still eligible until the carryover window closes.',
      qualifies: true,
      score,
      carriedOver,
      discoveredDate,
      daysWaiting: countDaysBetween(discoveredDate, issueDate),
    }
  }

  return {
    status: blocking.status,
    label: getDigestDispositionLabel(blocking.status),
    reason: blocking.reason,
    qualifies: false,
    score,
    carriedOver,
    discoveredDate,
    daysWaiting: countDaysBetween(discoveredDate, issueDate),
  }
}

export function countDaysBetween(fromDate, toDate) {
  if (!fromDate || !toDate) return 0
  const from = new Date(`${fromDate}T12:00:00Z`)
  const to = new Date(`${toDate}T12:00:00Z`)
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return 0
  return Math.max(Math.round((to.getTime() - from.getTime()) / 86400000), 0)
}

export function summarizeDigestPoolDispositions(dispositions = []) {
  const counts = {}
  for (const item of dispositions) {
    const key = item?.status || 'unknown'
    counts[key] = (counts[key] || 0) + 1
  }
  return {
    total: dispositions.length,
    qualifying: dispositions.filter((item) => item?.qualifies).length,
    carriedOver: dispositions.filter((item) => item?.carriedOver).length,
    byStatus: counts,
  }
}

/**
 * Counts what the dispatch route will actually see. `deliverable` uses the same predicate the
 * send path uses, so a mismatch here would be a real bug rather than a display quirk.
 */
export function summarizeDigestSubscribers(subscribers = []) {
  const rows = Array.isArray(subscribers) ? subscribers : []
  const deliverable = rows.filter(isSubscriberDeliverable)
  return {
    optedIn: rows.length,
    deliverable: deliverable.length,
    unsubscribed: rows.filter((row) => resolveSubscriptionStatus(row) === 'unsubscribed').length,
    suppressed: rows.filter((row) => resolveDeliveryStatus(row) === 'suppressed').length,
    neverSent: deliverable.filter((row) => !row?.lastResearchDigestSentAt).length,
  }
}

function clampNumber(value, { min, max, fallback }) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(Math.max(Math.round(parsed), min), max)
}

function normalizeEmailList(values) {
  const raw = Array.isArray(values) ? values : String(values || '').split(/[,;\n]/)
  const emails = raw
    .map((value) => String(value || '').trim().toLowerCase())
    .filter((value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))
  return Array.from(new Set(emails)).slice(0, 50)
}

function normalizeCopy(value, maxLength) {
  return String(value ?? '').replace(/\r\n/g, '\n').trim().slice(0, maxLength)
}

// Fields the admin form owns. journalGroups and opportunitySources are deliberately absent:
// they stay Studio-managed, and merging over `current` keeps this write from dropping them.
export const EDITABLE_DIGEST_SETTING_KEYS = Object.freeze([
  'publicEnabled',
  'automaticSelection',
  'maxPapers',
  'minPriorityScore',
  'carryoverDays',
  'maxOpportunities',
  'sendEmpty',
  'pilotMode',
  'pilotRecipients',
  'subjectTemplate',
  'introText',
  'emptyIntroText',
  'outroText',
  'signature',
  'llmProvider',
  'llmModel',
])

/**
 * Builds the `siteSettings.researchDigest` object to persist. Clamps every bound the selector
 * relies on, so a hand-edited request cannot raise the daily paper ceiling past the hard cap.
 * Only keys present in `input` are touched; everything else keeps its stored value.
 */
export function buildDigestSettingsPatch(input = {}, current = {}) {
  const next = { ...current }

  if ('publicEnabled' in input) next.publicEnabled = input.publicEnabled === true
  if ('automaticSelection' in input) next.automaticSelection = input.automaticSelection !== false
  if ('sendEmpty' in input) next.sendEmpty = input.sendEmpty === true
  if ('pilotMode' in input) next.pilotMode = input.pilotMode === true

  if ('maxPapers' in input) {
    next.maxPapers = clampNumber(input.maxPapers, {
      min: 1,
      max: RESEARCH_DIGEST_MAX_PAPERS_CEILING,
      fallback: current?.maxPapers ?? 1,
    })
  }
  if ('minPriorityScore' in input) {
    next.minPriorityScore = clampNumber(input.minPriorityScore, {
      min: 0,
      max: 100,
      fallback: current?.minPriorityScore ?? 75,
    })
  }
  if ('carryoverDays' in input) {
    next.carryoverDays = clampNumber(input.carryoverDays, {
      min: 0,
      max: RESEARCH_DIGEST_MAX_CARRYOVER_DAYS,
      fallback: current?.carryoverDays ?? 7,
    })
  }
  if ('maxOpportunities' in input) {
    next.maxOpportunities = clampNumber(input.maxOpportunities, {
      min: 1,
      max: 30,
      fallback: current?.maxOpportunities ?? 8,
    })
  }

  // Written from the submitted list only. Running the value through the full settings
  // normalizer here would fold RESEARCH_DIGEST_PILOT_EMAILS into the stored document and
  // make an env-only recipient permanent.
  if ('pilotRecipients' in input) next.pilotRecipients = normalizeEmailList(input.pilotRecipients)

  if ('subjectTemplate' in input) next.subjectTemplate = normalizeCopy(input.subjectTemplate, 300)
  if ('introText' in input) next.introText = normalizeCopy(input.introText, 1000)
  if ('emptyIntroText' in input) next.emptyIntroText = normalizeCopy(input.emptyIntroText, 1000)
  if ('outroText' in input) next.outroText = normalizeCopy(input.outroText, 1000)
  if ('signature' in input) next.signature = normalizeCopy(input.signature, 200)
  if ('llmProvider' in input) next.llmProvider = normalizeCopy(input.llmProvider, 100)
  if ('llmModel' in input) next.llmModel = normalizeCopy(input.llmModel, 100)

  return next
}

/**
 * Flags settings combinations that silently stop delivery, so the page can say so instead of
 * leaving someone to infer it from an empty run history.
 */
export function findDigestSettingsWarnings(settings = {}, { subscriberCounts, testing } = {}) {
  const warnings = []

  if (settings?.pilotMode && !(settings?.pilotRecipients || []).length) {
    warnings.push('Pilot mode is on with no pilot recipients. Every send will fail with a 409.')
  }
  if (!settings?.publicEnabled && !settings?.pilotMode && !testing?.enabled) {
    warnings.push('Public launch is off and no pilot or test recipients are configured. Scheduled sends skip entirely.')
  }
  if (testing?.enabled && !(testing?.recipients || []).length && !settings?.pilotMode) {
    warnings.push('Update email test mode is on with no test recipients. Sending is locked.')
  }
  if (settings?.automaticSelection === false) {
    warnings.push('Automatic selection is off. Nothing ships until an issue is approved by hand.')
  }
  if (subscriberCounts && subscriberCounts.deliverable === 0 && !settings?.pilotMode) {
    warnings.push('No deliverable subscribers have opted into the research digest.')
  }
  if (Number(settings?.minPriorityScore) >= 95) {
    warnings.push(`A ${settings.minPriorityScore} threshold will reject almost every paper.`)
  }

  return warnings
}
