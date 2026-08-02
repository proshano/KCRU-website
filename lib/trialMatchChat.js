import { hasMeaningfulPatientProfile, sanitizePatientProfile } from './patientProfileSchema.js'
import { hasQuantitativeUrineProteinData } from './urineProtein.js'

const EGFR_MISSING_REASON_PATTERNS = [/\begfr criterion\b/i]
const DIALYSIS_MISSING_REASON_PATTERNS = [/\bdialysis status is not yet known\b/i]
const URINE_PROTEIN_MISSING_REASON_PATTERNS = [
  /\bquantitative urine protein value\b/i,
  /\burine protein criterion\b/i,
]

/**
 * Vocabulary that marks a turn as part of a prescreen. Deliberately broad: the cost of letting an
 * off-topic message through is one LLM turn, while the cost of a false positive is stonewalling a
 * clinician mid-conversation, so anything that plausibly belongs in a kidney history counts.
 */
const PRESCREEN_SIGNAL_PATTERN =
  /\b(?:kidney|renal|nephr\w*|glomer\w*|dialysis|h[ae]modialysis|peritoneal|transplant|graft|donor|rejection|egfr|gfr|creatinine|crcl|ckd|aki|eskd|esrd|uremi\w*|protein\w*|albumin\w*|acr|pcr|uacr|upcr|iga|igan|fsgs|mcd|c3g|adpkd|pkd|alport|lupus|sle|amyloid|myeloma|vasculitis|anca|membranous|minimal change|diabet\w*|hypertens\w*|blood pressure|potassium|sodium|h[ae]moglobin|biopsy|nephrotic|nephritic|urine|urinary|patient|male|female|man|woman|year|age|stage|mg|mmol|ml\/min|sglt2|ace|arb|mra|statin)\b/i

/** Terse replies to a focused follow-up. These carry no vocabulary of their own but are on topic. */
const SHORT_ANSWER_PATTERN =
  /^(?:yes|no|yeah|yep|nope|none|n\/a|na|unknown|not sure|unsure|no idea|don'?t know|i don'?t know|not available|unavailable|not known|nothing|maybe|ok|okay)\b/i

function sanitizeMessageText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

/** True when a user turn plausibly carries prescreening content rather than idle conversation. */
export function hasTrialPrescreenSignal(value) {
  const text = sanitizeMessageText(value)
  if (!text) return false
  if (/\d/.test(text)) return true
  if (SHORT_ANSWER_PATTERN.test(text)) return true
  return PRESCREEN_SIGNAL_PATTERN.test(text)
}

/**
 * True when the most recent consecutive user turns all look like idle conversation, which is the
 * point at which answering costs a full catalog prompt for nothing. Looks at the trailing run
 * rather than the whole transcript so a conversation that starts clinical and then wanders is
 * still caught, and recovers on its own as soon as a turn carries prescreening content again.
 */
export function isOffTopicConversation({ messages = [], minUserTurns = 2 } = {}) {
  const userTurns = (Array.isArray(messages) ? messages : [])
    .filter((message) => message?.role === 'user' && sanitizeMessageText(message.content))
  if (userTurns.length < minUserTurns) return false

  return userTurns.slice(-minUserTurns).every((message) => !hasTrialPrescreenSignal(message.content))
}

/**
 * True when this transcript already ended in a set of study matches. The widget locks its input at
 * that point, so this only bites callers that keep posting anyway.
 */
export function isConversationAlreadyComplete({ messages = [], completionReply = '' } = {}) {
  const reply = sanitizeMessageText(completionReply)
  if (!reply) return false

  const lastAssistantMessage = (Array.isArray(messages) ? [...messages] : [])
    .reverse()
    .find((message) => message?.role === 'assistant' && sanitizeMessageText(message.content))
  if (!lastAssistantMessage) return false

  return sanitizeMessageText(lastAssistantMessage.content).includes(reply)
}

function matchesMissingReason(reason, patterns) {
  const text = String(reason || '').trim()
  if (!text) return false
  return patterns.some((pattern) => pattern.test(text))
}

function isEgfrMissingReason(reason) {
  return matchesMissingReason(reason, EGFR_MISSING_REASON_PATTERNS)
}

function isDialysisMissingReason(reason) {
  return matchesMissingReason(reason, DIALYSIS_MISSING_REASON_PATTERNS)
}

function isUrineProteinMissingReason(reason) {
  return matchesMissingReason(reason, URINE_PROTEIN_MISSING_REASON_PATTERNS)
}

function getTopCandidateResults(rankedResults, maxTopStudies) {
  return (Array.isArray(rankedResults) ? rankedResults : [])
    .filter((result) => result?.decision === 'match' || result?.decision === 'possible')
    .slice(0, maxTopStudies)
}

export function hasSingleTurnMatchReadyProfile(profile = {}) {
  const current = sanitizePatientProfile(profile)
  const hasStudyContext =
    Boolean(current.diagnosis) ||
    current.populationTags.length > 0 ||
    Boolean(current.dialysisStatus) ||
    Boolean(current.transplantStatus)
  const hasRenalStatus =
    current.egfr !== null ||
    Boolean(current.ckdStage) ||
    Boolean(current.dialysisStatus) ||
    Boolean(current.transplantStatus)

  return hasStudyContext && hasRenalStatus
}

export function shouldRankTrialMatches({
  readyForMatching = false,
  profile = {},
  userTurns = 0,
  maxUserTurns = 5,
  wantsImmediateRanking = false,
} = {}) {
  const current = sanitizePatientProfile(profile)

  if (wantsImmediateRanking) return true

  if (hasSingleTurnMatchReadyProfile(current)) return true

  if (userTurns >= maxUserTurns) return hasMeaningfulPatientProfile(current)

  if (userTurns < 1) return false

  return Boolean(readyForMatching)
}

export function shouldAskUrineProteinFollowUp({ profile = {}, rankedResults = [], maxTopStudies = 3 } = {}) {
  const current = sanitizePatientProfile(profile)

  if (hasQuantitativeUrineProteinData(current.urineProtein)) return false

  const topCandidates = getTopCandidateResults(rankedResults, maxTopStudies)
  if (!topCandidates.length) return false

  return topCandidates.some((result) => {
    const missingReasons = Array.isArray(result?.missingReasons) ? result.missingReasons : []
    const urineProteinMissingReasons = missingReasons.filter(isUrineProteinMissingReason)
    if (!urineProteinMissingReasons.length) return false

    if (current.hasAlbuminuria === true || current.hasProteinuria === true) return true

    const nonUrineProteinMissingCount = missingReasons.length - urineProteinMissingReasons.length
    return nonUrineProteinMissingCount <= 1
  })
}

export function selectTrialMatchFollowUp({
  profile = {},
  rankedResults = [],
  exhaustedFollowUps = new Set(),
  maxTopStudies = 3,
} = {}) {
  const current = sanitizePatientProfile(profile)
  const exhausted = exhaustedFollowUps instanceof Set ? exhaustedFollowUps : new Set(exhaustedFollowUps || [])
  const topCandidates = getTopCandidateResults(rankedResults, maxTopStudies)

  if (!topCandidates.length) return null

  const needsEgfrFollowUp =
    current.egfr === null &&
    topCandidates.some((result) => (Array.isArray(result?.missingReasons) ? result.missingReasons : []).some(isEgfrMissingReason))
  const needsDialysisFollowUp =
    current.dialysisStatus === null &&
    topCandidates.some((result) =>
      (Array.isArray(result?.missingReasons) ? result.missingReasons : []).some(isDialysisMissingReason)
    )

  if ((needsEgfrFollowUp || needsDialysisFollowUp) && !exhausted.has('renal_status')) {
    return 'renal_status'
  }

  if (
    shouldAskUrineProteinFollowUp({
      profile: current,
      rankedResults: topCandidates,
      maxTopStudies,
    }) &&
    !exhausted.has('urine_protein')
  ) {
    return 'urine_protein'
  }

  return null
}
