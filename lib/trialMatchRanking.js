import { getAnsweredProfileFieldCount, sanitizePatientProfile } from './patientProfileSchema.js'
import { generateTrialMatchStudyRanking } from './summaries.js'
import { matchTrialToPatient, rankTrialMatches } from './trialMatcher.js'
import {
  TRIAL_PRESCREEN_CKD_STAGE_LABELS,
  TRIAL_PRESCREEN_DIALYSIS_STATUS_LABELS,
  TRIAL_PRESCREEN_POPULATION_LABELS,
  TRIAL_PRESCREEN_TRANSPLANT_STATUS_LABELS,
} from './trialPrescreen.js'

/**
 * Study ranking for the trial matching assistant: the shortlist the LLM reads, the LLM call with
 * its rule-based fallback, and the fixed replies that frame the results.
 *
 * The ranking runs in its own request (`/api/trials/match/rank`) rather than inside the chat turn.
 * It is the slow half of a results turn (a second LLM call, with more reasoning than the chat
 * turn), so the chat route answers `rankingPending` as soon as the profile is ready and the widget
 * shows that reply while it posts the same transcript and profile here.
 */

export const MAX_RESULTS = 6
export const MAX_LLM_RANK_STUDIES = 12
/** When at least one match/possible exists, limit how many insufficient_info rows appear in the top list. */
export const MAX_INSUFFICIENT_WHEN_BETTER_EXISTS = 2
export const RANKING_MAX_TOKENS = 1200
export const RANKING_TEMPERATURE = 0.35

export const RESULTS_READY_REPLY = 'See the potential studies below. A coordinator would confirm final eligibility.'
export const NO_RESULTS_REPLY =
  'I could not shortlist any studies from that information alone. Add age, sex, dialysis or transplant status, or any recent urine protein value if one matters for the likely studies.'
export const RANKING_PENDING_FALLBACK_REPLY = 'Checking the recruiting studies now.'

function sanitizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

function tokenizeQuery(text) {
  return sanitizeText(text)
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .map((t) => t.trim())
    .filter(Boolean)
    .filter((t) => t.length >= 4)
}

function buildStudyHaystack(study) {
  const inc = Array.isArray(study?.inclusionCriteria) ? study.inclusionCriteria.join(' ') : ''
  return sanitizeText([study?.title, study?.laySummary, inc].filter(Boolean).join(' '))
}

export function getLastUserMessage(messages) {
  if (!Array.isArray(messages) || !messages.length) return null
  return [...messages].reverse().find((message) => message?.role === 'user')
}

function quickTextRankStudies(studies, queryText, profile = {}) {
  const tokens = tokenizeQuery(queryText)
  if (!tokens.length) return []

  // Keyword hits are used as a soft booster when building the LLM shortlist, not as a hard
  // gate. A study the deterministic matcher labeled "unlikely" may still surface if the user's
  // free-text mentions it directly; the LLM makes the final eligibility call.
  const rows = studies
    .map((study) => {
      const fallbackMatch = matchTrialToPatient(study, profile)
      const haystack = buildStudyHaystack(study).toLowerCase()
      if (!haystack) return null

      let hits = 0
      for (const token of tokens) {
        if (haystack.includes(token)) hits += 1
      }

      if (hits === 0) return null

      return {
        ...fallbackMatch,
        matchedReasons: fallbackMatch.matchedReasons.length
          ? fallbackMatch.matchedReasons
          : [`Mentions ${tokens.slice(0, 3).join(', ')}.`],
        score: fallbackMatch.score + hits * 10,
      }
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))

  return sliceRankedTrialMatches(rows, MAX_RESULTS)
}

function mergeRankedResults(primary = [], secondary = [], maxResults = MAX_RESULTS) {
  const out = []
  const seen = new Set()
  for (const row of [...(primary || []), ...(secondary || [])]) {
    const id = row?._id
    if (!id || seen.has(id)) continue
    seen.add(id)
    out.push(row)
    if (out.length >= maxResults) break
  }
  return out
}

export function sliceRankedTrialMatches(ranked, maxResults = MAX_RESULTS) {
  if (!Array.isArray(ranked) || !ranked.length) return []
  const hasMatchOrPossible = ranked.some((r) => r.decision === 'match' || r.decision === 'possible')
  let insufficientKept = 0
  const out = []
  for (const r of ranked) {
    if (out.length >= maxResults) break
    if (r.decision === 'insufficient_info') {
      if (hasMatchOrPossible && insufficientKept >= MAX_INSUFFICIENT_WHEN_BETTER_EXISTS) continue
      insufficientKept += 1
    }
    out.push(r)
  }
  return out
}

export function buildLlmRankingShortlist(studies, profile, messages) {
  if (!Array.isArray(studies) || !studies.length) return []

  // We only rank-order the shortlist here; we do not pre-exclude studies the deterministic
  // matcher labels "unlikely". Real eligibility criteria are often too complex for regex
  // (alternative cohorts, Unicode operators, nested clauses, etc.), and we've been burned by
  // brittle keyword rules that hide legitimate matches from the LLM. The deterministic score
  // still pushes weaker candidates toward the bottom of the shortlist, so if we are over the
  // MAX_LLM_RANK_STUDIES token budget the token-cheap candidates drop off naturally. The LLM
  // then makes the actual eligibility call, and downstream code filters out its "weak" and
  // missing entries.
  const byId = new Map(studies.map((study) => [study?._id, study]))
  const deterministic = rankTrialMatches(studies, profile).slice(0, MAX_LLM_RANK_STUDIES)
  const textRanked = quickTextRankStudies(studies, getLastUserMessage(messages)?.content || '', profile)
  const merged = mergeRankedResults(deterministic, textRanked, MAX_LLM_RANK_STUDIES)
  const shortlist = merged.map((row) => byId.get(row?._id)).filter(Boolean)

  if (shortlist.length) return shortlist
  return studies.slice(0, MAX_LLM_RANK_STUDIES)
}

const URINE_PROTEIN_UNIT_LABELS = {
  mg_per_mmol: 'mg/mmol',
  mg_per_g: 'mg/g',
  g_per_g: 'g/g',
  mg_per_day: 'mg/day',
  g_per_day: 'g/day',
}

function formatNumber(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return null
  return String(Math.round(n * 10) / 10)
}

/** The urine protein values the user actually reported, without the estimated cross-format ones. */
function listReportedUrineProtein(urineProtein) {
  const items = []
  const measures = [
    ['ACR', urineProtein?.acr],
    ['PCR', urineProtein?.pcr],
    ['24-hour protein', urineProtein?.protein24h],
  ]
  for (const [label, measure] of measures) {
    if (!measure || measure.source !== 'reported') continue
    const value = formatNumber(measure.reportedValue)
    if (value === null) continue
    const unit = URINE_PROTEIN_UNIT_LABELS[measure.reportedUnit]
    items.push(unit ? `${label} ${value} ${unit}` : `${label} ${value}`)
  }
  return items
}

/**
 * Whether a profile carries anything to rank on. Deliberately looser than
 * `hasMeaningfulPatientProfile` (two answered fields): dialysis status on its own is enough for
 * a first-turn ranking (see `hasSingleTurnMatchReadyProfile`), so the only profile refused here
 * is one that says nothing at all, which the widget never sends but a bare API caller could.
 */
export function hasRankableProfile(profile) {
  return getAnsweredProfileFieldCount(profile) > 0
}

/**
 * The assistant's reply for the turn that hands over to the ranking request. It lists what the
 * profile holds, so the person sees what was understood while the ranking runs, and a misread
 * detail shows up before the results do rather than after. It is deliberately briefer than
 * `getPatientProfileSummary`: reported values only, no estimated conversions or provenance.
 */
export function buildRankingPendingReply(profile) {
  const current = sanitizePatientProfile(profile)
  const candidates = []

  if (current.ageYears !== null) candidates.push(`Age ${current.ageYears}`)
  if (current.sex) candidates.push(current.sex === 'female' ? 'Female' : 'Male')
  if (current.diagnosis) candidates.push(current.diagnosis)
  for (const tag of current.populationTags) {
    candidates.push(TRIAL_PRESCREEN_POPULATION_LABELS[tag] || tag)
  }
  if (current.ckdStage) candidates.push(TRIAL_PRESCREEN_CKD_STAGE_LABELS[current.ckdStage] || current.ckdStage)
  if (current.dialysisStatus) {
    candidates.push(TRIAL_PRESCREEN_DIALYSIS_STATUS_LABELS[current.dialysisStatus] || current.dialysisStatus)
  }
  if (current.transplantStatus) {
    candidates.push(TRIAL_PRESCREEN_TRANSPLANT_STATUS_LABELS[current.transplantStatus] || current.transplantStatus)
  }
  if (current.hasDiabetes !== null) candidates.push(`Diabetes: ${current.hasDiabetes ? 'Yes' : 'No'}`)
  if (current.egfr !== null) candidates.push(`eGFR ${formatNumber(current.egfr)}`)
  const urineProteinItems = listReportedUrineProtein(current.urineProtein)
  if (urineProteinItems.length) {
    candidates.push(...urineProteinItems)
  } else {
    if (current.hasAlbuminuria !== null) candidates.push(`Albuminuria: ${current.hasAlbuminuria ? 'Yes' : 'No'}`)
    if (current.hasProteinuria !== null) candidates.push(`Proteinuria: ${current.hasProteinuria ? 'Yes' : 'No'}`)
  }

  const seen = new Set()
  const items = []
  for (const rawItem of candidates) {
    const item = sanitizeText(rawItem)
    const key = item.toLowerCase()
    if (!key || seen.has(key)) continue
    seen.add(key)
    items.push(item)
  }
  if (!items.length) return RANKING_PENDING_FALLBACK_REPLY
  return `Checking the recruiting studies for: ${items.join(', ')}.`
}

/**
 * Ranks the recruiting studies for a profile: LLM ranking over the shortlist, with the
 * rule-based ranking as the fallback when the LLM call fails or returns nothing.
 */
export async function rankStudiesForProfile({ studies = [], profile = {}, messages = [], llmOptions = {} } = {}) {
  const current = sanitizePatientProfile(profile)
  const shortlist = buildLlmRankingShortlist(studies, current, messages)
  if (!shortlist.length) return []
  const ruleBasedRanking = rankTrialMatches(shortlist, current)

  try {
    const ranked = await generateTrialMatchStudyRanking(
      { profile: current, studies: shortlist },
      { ...llmOptions, maxTokens: RANKING_MAX_TOKENS, temperature: RANKING_TEMPERATURE }
    )
    if (ranked.length) return ranked
  } catch (error) {
    console.error('[trial-match-rank] LLM study ranking failed, using rule-based fallback', error)
  }

  return sliceRankedTrialMatches(ruleBasedRanking, MAX_RESULTS)
}

/** The reply and completion flag that go with a set of ranked results. */
export function describeRankingOutcome(results) {
  const list = Array.isArray(results) ? results : []
  return {
    results: list,
    reply: list.length ? RESULTS_READY_REPLY : NO_RESULTS_REPLY,
    conversationComplete: list.length > 0,
  }
}
