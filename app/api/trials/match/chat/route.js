import { NextResponse } from 'next/server'

import { mergePatientProfiles, sanitizePatientProfile } from '@/lib/patientProfileSchema'
import {
  isConversationAlreadyComplete,
  isOffTopicConversation,
  selectTrialMatchFollowUp,
  shouldRankTrialMatches,
} from '@/lib/trialMatchChat'
import { sanityFetch, queries } from '@/lib/sanity'
import {
  buildTrialEligibilityCatalogForPrompt,
  generateTrialMatchConversation,
  generateTrialMatchStudyRanking,
} from '@/lib/summaries'
import { isTrialMatchingAssistantEnabled, resolveTrialMatchingLlmOptions } from '@/lib/trialMatchingSettings'
import { buildTrialCatalogForPrompt, matchTrialToPatient, rankTrialMatches } from '@/lib/trialMatcher'
import { claimSecurityRateLimit, getRateLimitResponseDetails } from '@/lib/securityRateLimit'
import { getTrustedClientIp, sanitizeTrialMatchMessages } from '@/lib/trialMatchRequest'
import {
  isQuantitativeUrineProteinUnavailable,
  parseUrineProteinProfileFromText,
  parseUrineProteinSignalsFromText,
} from '@/lib/urineProtein'

const MAX_MESSAGES = 12
const MAX_MESSAGE_LENGTH = 600
const MAX_RESULTS = 6
const MAX_LLM_RANK_STUDIES = 12
const MAX_USER_TURNS_BEFORE_LLM_RANKING = 5
/**
 * Bounds on the study catalog sent with each conversation turn. Every recruiting study is listed,
 * but in abridged form: the ranking turn is where full criteria are read, and it only ever sees
 * the shortlist. Without these the assistant re-sends the entire catalog on every patient message.
 */
const MAX_CONVERSATION_CRITERIA_PER_STUDY = 6
const MAX_CONVERSATION_CRITERION_LENGTH = 240
/** Consecutive idle user turns tolerated before replying without an LLM call. */
const OFF_TOPIC_USER_TURNS_BEFORE_REDIRECT = 2
/** When at least one match/possible exists, limit how many insufficient_info rows appear in the top list. */
const MAX_INSUFFICIENT_WHEN_BETTER_EXISTS = 2
const RESULTS_READY_REPLY = 'See the potential studies below. A coordinator would confirm final eligibility.'
const RENAL_STATUS_FOLLOW_UP_REPLY =
  'If available, what is the most recent eGFR? If the patient is on dialysis, say that instead.'
const NO_RESULTS_REPLY =
  'I could not shortlist any studies from that information alone. Add age, sex, dialysis or transplant status, or any recent urine protein value if one matters for the likely studies.'
const URINE_PROTEIN_FOLLOW_UP_REPLY =
  'If available, do you have a recent ACR, PCR, or 24-hour urine protein value? If not, say that and I can still keep possible studies on the list.'
const OFF_TOPIC_REPLY =
  'I can only help match a patient to the kidney studies on file. Share the diagnosis and the eGFR, or say the patient is on dialysis.'
const CONVERSATION_COMPLETE_REPLY =
  'This conversation already produced its study matches. Start a new conversation to screen another patient.'
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000
const MAX_REQUESTS_PER_WINDOW = 20
const GLOBAL_RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000
const MAX_GLOBAL_REQUESTS_PER_WINDOW = 500
const MAX_REQUEST_BODY_BYTES = 32 * 1024

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

function extractDiagnosisHintFromText(text) {
  const t = sanitizeText(text).toLowerCase()
  if (!t) return null
  if (/\blupus\s+nephritis\b|\bactive\s+lupus\s+nephritis\b/.test(t)) return 'lupus nephritis'
  if (/\bdiabetic\s+nephropathy\b|\bdiabetic\s+kidney\s+disease\b|\bdkd\b/.test(t)) return 'diabetic nephropathy'
  if (/\biga\s+nephropathy\b|\bigan\b/.test(t)) return 'IgA nephropathy'
  if (/\bfsgs\b|\bfocal\s+segmental\s+glomerulosclerosis\b/.test(t)) return 'FSGS'
  if (/\bminimal\s+change\s+disease\b|\bmcd\b/.test(t)) return 'minimal change disease'
  if (/\bc3\s+glomerulopathy\b|\bc3g\b/.test(t)) return 'C3 glomerulopathy'
  if (/\badpkd\b|\bpolycystic\s+kidney\s+disease\b/.test(t)) return 'ADPKD'
  if (/\balport\b/.test(t)) return 'Alport syndrome'
  if (/\bantibody[-\s]?mediated\s+rejection\b|\bamr\b/.test(t)) return 'antibody-mediated rejection'
  return null
}

function extractDiagnosisHintFromMessages(messages) {
  if (!Array.isArray(messages) || !messages.length) return null
  const lastUser = [...messages].reverse().find((m) => m?.role === 'user' && m?.content)
  return extractDiagnosisHintFromText(lastUser?.content || '')
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

function countUserMessages(messages) {
  if (!Array.isArray(messages)) return 0
  return messages.filter((message) => message?.role === 'user').length
}

function getLastUserMessage(messages) {
  if (!Array.isArray(messages) || !messages.length) return null
  return [...messages].reverse().find((message) => message?.role === 'user')
}

function buildLatestUserLabProfile(messages) {
  const lastUserMessage = getLastUserMessage(messages)
  if (!lastUserMessage?.content) return null
  const urineProteinSignals = parseUrineProteinSignalsFromText(lastUserMessage.content)
  return {
    urineProtein: parseUrineProteinProfileFromText(lastUserMessage.content, {
      defaultUnit: 'mg_per_mmol',
    }),
    hasAlbuminuria: urineProteinSignals.hasAlbuminuria,
    hasProteinuria: urineProteinSignals.hasProteinuria,
  }
}

function hasAnsweredFocusedFollowUp(messages, followUpReply) {
  if (!followUpReply) return false
  if (!Array.isArray(messages) || !messages.length) return false

  let lastFollowUpIndex = -1
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message?.role !== 'assistant') continue
    if (sanitizeText(message.content).includes(followUpReply)) {
      lastFollowUpIndex = index
      break
    }
  }

  if (lastFollowUpIndex < 0) return false
  return messages.slice(lastFollowUpIndex + 1).some((message) => message?.role === 'user' && sanitizeText(message.content))
}

function buildLlmRankingShortlist(studies, profile, messages) {
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

function buildResponse(body, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      'Cache-Control': 'no-store',
    },
  })
}

function sliceRankedTrialMatches(ranked, maxResults = MAX_RESULTS) {
  if (!Array.isArray(ranked) || !ranked.length) return []
  const hasMatchOrPossible = ranked.some(
    (r) => r.decision === 'match' || r.decision === 'possible'
  )
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

export async function POST(request) {
  try {
    await claimSecurityRateLimit({
      namespace: 'trial-match-origin',
      key: getTrustedClientIp(request.headers),
      limit: MAX_REQUESTS_PER_WINDOW,
      windowMs: RATE_LIMIT_WINDOW_MS,
      minimumIntervalMs: 500,
    })
    await claimSecurityRateLimit({
      namespace: 'trial-match-global',
      key: 'all-public-callers',
      limit: MAX_GLOBAL_REQUESTS_PER_WINDOW,
      windowMs: GLOBAL_RATE_LIMIT_WINDOW_MS,
      minimumIntervalMs: 50,
    })
  } catch (error) {
    const rateLimit = getRateLimitResponseDetails(error)
    if (!rateLimit) {
      console.error('[trial-match-chat] rate-limit check failed', error)
      return buildResponse({ ok: false, error: 'The trial matching assistant is temporarily unavailable.' }, 503)
    }
    return NextResponse.json(
      { ok: false, error: 'Too many requests. Please wait a few minutes before trying again.' },
      {
        status: rateLimit.status,
        headers: {
          'Cache-Control': 'no-store',
          'Retry-After': String(rateLimit.retryAfter),
        },
      }
    )
  }

  let body
  try {
    const contentLength = Number(request.headers.get('content-length'))
    if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BODY_BYTES) {
      return buildResponse({ ok: false, error: 'Request payload is too large.' }, 413)
    }
    const rawBody = await request.text()
    if (new TextEncoder().encode(rawBody).byteLength > MAX_REQUEST_BODY_BYTES) {
      return buildResponse({ ok: false, error: 'Request payload is too large.' }, 413)
    }
    if (!rawBody.trim()) return buildResponse({ ok: false, error: 'Invalid JSON payload.' }, 400)
    body = JSON.parse(rawBody)
  } catch {
    return buildResponse({ ok: false, error: 'Invalid JSON payload.' }, 400)
  }

  const messages = sanitizeTrialMatchMessages(body?.messages, {
    maxMessages: MAX_MESSAGES,
    maxMessageLength: MAX_MESSAGE_LENGTH,
  })
  if (!messages.some((message) => message.role === 'user')) {
    return buildResponse({ ok: false, error: 'Provide at least one user message.' }, 400)
  }

  const currentProfile = sanitizePatientProfile(body?.profile)
  const latestUserLabProfile = buildLatestUserLabProfile(messages)
  const preLlmProfile = mergePatientProfiles(currentProfile, latestUserLabProfile)

  try {
    const [settingsRaw, studiesRaw] = await Promise.all([
      sanityFetch(queries.siteSettings),
      sanityFetch(queries.trialMatchingStudies),
    ])
    const settings = JSON.parse(JSON.stringify(settingsRaw || {}))

    if (!isTrialMatchingAssistantEnabled(settings)) {
      return buildResponse(
        { ok: false, error: 'The trial conversational assistant is currently unavailable.' },
        503
      )
    }

    const studies = JSON.parse(JSON.stringify(studiesRaw || []))
    if (!studies.length) {
      return buildResponse({
        ok: true,
        reply: 'No active studies are available for the matching assistant yet. Please browse the studies page or contact the research team.',
        profile: preLlmProfile,
        conversationComplete: false,
        results: [],
      })
    }

    // Both guards answer without an LLM call. A conversation turn carries the study catalog, so a
    // turn that cannot advance a prescreen is the most expensive way to say nothing.
    if (isConversationAlreadyComplete({ messages, completionReply: RESULTS_READY_REPLY })) {
      return buildResponse({
        ok: true,
        reply: CONVERSATION_COMPLETE_REPLY,
        profile: preLlmProfile,
        conversationComplete: true,
        results: [],
      })
    }

    if (isOffTopicConversation({ messages, minUserTurns: OFF_TOPIC_USER_TURNS_BEFORE_REDIRECT })) {
      return buildResponse({
        ok: true,
        reply: OFF_TOPIC_REPLY,
        profile: preLlmProfile,
        conversationComplete: false,
        results: [],
      })
    }

    const llmTurn = await generateTrialMatchConversation(
      {
        currentProfile: preLlmProfile,
        messages,
        trialCatalog: buildTrialCatalogForPrompt(studies, { includeDetail: false }),
        trialEligibilityCatalog: buildTrialEligibilityCatalogForPrompt(studies, {
          maxCriteriaPerStudy: MAX_CONVERSATION_CRITERIA_PER_STUDY,
          maxCriterionLength: MAX_CONVERSATION_CRITERION_LENGTH,
        }),
      },
      resolveTrialMatchingLlmOptions(settings)
    )

    const updatedProfile = mergePatientProfiles(preLlmProfile, llmTurn?.patientProfile, latestUserLabProfile)
    const diagnosisHint = extractDiagnosisHintFromMessages(messages)
    const enrichedProfile =
      updatedProfile.diagnosis || !diagnosisHint ? updatedProfile : { ...updatedProfile, diagnosis: diagnosisHint }

    const userTurns = countUserMessages(messages)
    const wantsImmediateRanking = body?.requestMatches === true
    const llmOpts = resolveTrialMatchingLlmOptions(settings)
    const rankingShortlist = buildLlmRankingShortlist(studies, enrichedProfile, messages)
    const ruleBasedRanking = rankTrialMatches(rankingShortlist, enrichedProfile)
    const lastUserMessage = getLastUserMessage(messages)?.content || ''
    const exhaustedFollowUps = new Set()
    if (hasAnsweredFocusedFollowUp(messages, RENAL_STATUS_FOLLOW_UP_REPLY)) {
      exhaustedFollowUps.add('renal_status')
    }
    if (
      hasAnsweredFocusedFollowUp(messages, URINE_PROTEIN_FOLLOW_UP_REPLY) ||
      isQuantitativeUrineProteinUnavailable(lastUserMessage)
    ) {
      exhaustedFollowUps.add('urine_protein')
    }
    const followUpType = selectTrialMatchFollowUp({
      profile: enrichedProfile,
      rankedResults: ruleBasedRanking,
      exhaustedFollowUps,
    })
    const followUpReply =
      followUpType === 'renal_status'
        ? RENAL_STATUS_FOLLOW_UP_REPLY
        : followUpType === 'urine_protein'
          ? URINE_PROTEIN_FOLLOW_UP_REPLY
          : ''
    const shouldRankMatches = shouldRankTrialMatches({
      readyForMatching: llmTurn?.readyForMatching,
      profile: enrichedProfile,
      userTurns,
      maxUserTurns: MAX_USER_TURNS_BEFORE_LLM_RANKING,
      wantsImmediateRanking,
    })
    const shouldPromptFocusedFollowUp = Boolean(followUpReply) && !wantsImmediateRanking
    let rankedResults = []
    if (shouldRankMatches && !shouldPromptFocusedFollowUp) {
      try {
        rankedResults = await generateTrialMatchStudyRanking(
          { profile: enrichedProfile, studies: rankingShortlist },
          { ...llmOpts, maxTokens: 1200, temperature: 0.35 }
        )
        if (!rankedResults.length) {
          rankedResults = sliceRankedTrialMatches(ruleBasedRanking, MAX_RESULTS)
        }
      } catch (rankError) {
        console.error('[trial-match-chat] LLM study ranking failed, using rule-based fallback', rankError)
        rankedResults = sliceRankedTrialMatches(ruleBasedRanking, MAX_RESULTS)
      }
    }

    const reply =
      shouldRankMatches && rankedResults.length
        ? RESULTS_READY_REPLY
        : shouldPromptFocusedFollowUp
          ? followUpReply
        : shouldRankMatches
          ? NO_RESULTS_REPLY
        : llmTurn?.assistantReply || ''
    const conversationComplete = Boolean(shouldRankMatches && rankedResults.length)

    return buildResponse({
      ok: true,
      conversationComplete,
      reply: sanitizeText(reply),
      profile: enrichedProfile,
      results: rankedResults,
    })
  } catch (error) {
    console.error('[trial-match-chat] POST failed', error)
    return buildResponse(
      { ok: false, error: error?.message || 'Unable to process the trial matching chat right now.' },
      500
    )
  }
}

export const dynamic = 'force-dynamic'
