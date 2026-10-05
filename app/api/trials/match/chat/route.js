import { mergePatientProfiles, sanitizePatientProfile } from '@/lib/patientProfileSchema'
import {
  isConversationAlreadyComplete,
  isOffTopicConversation,
  selectTrialMatchFollowUp,
  shouldRankTrialMatches,
} from '@/lib/trialMatchChat'
import { buildTrialEligibilityCatalogForPrompt, generateTrialMatchConversation } from '@/lib/summaries'
import {
  MAX_MESSAGES,
  MAX_MESSAGE_LENGTH,
  NO_STUDIES_REPLY,
  buildTrialMatchResponse,
  prepareTrialMatchRequest,
} from '@/lib/trialMatchApi'
import {
  NO_RESULTS_REPLY,
  RESULTS_READY_REPLY,
  buildLlmRankingShortlist,
  buildRankingPendingReply,
  getLastUserMessage,
  hasRankableProfile,
} from '@/lib/trialMatchRanking'
import { sanitizeTrialMatchMessages } from '@/lib/trialMatchRequest'
import { buildTrialCatalogForPrompt, rankTrialMatches } from '@/lib/trialMatcher'
import {
  isQuantitativeUrineProteinUnavailable,
  parseUrineProteinProfileFromText,
  parseUrineProteinSignalsFromText,
} from '@/lib/urineProtein'

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
const RENAL_STATUS_FOLLOW_UP_REPLY =
  'If available, what is the most recent eGFR? If the patient is on dialysis, say that instead.'
const URINE_PROTEIN_FOLLOW_UP_REPLY =
  'If available, do you have a recent ACR, PCR, or 24-hour urine protein value? If not, say that and I can still keep possible studies on the list.'
const OFF_TOPIC_REPLY =
  'I can only help match a patient to the kidney studies on file. Share the diagnosis and the eGFR, or say the patient is on dialysis.'
const CONVERSATION_COMPLETE_REPLY =
  'This conversation already produced its study matches. Start a new conversation to screen another patient.'

function sanitizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim()
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
  const lastUser = getLastUserMessage(messages)
  return extractDiagnosisHintFromText(lastUser?.content || '')
}

function countUserMessages(messages) {
  if (!Array.isArray(messages)) return 0
  return messages.filter((message) => message?.role === 'user').length
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

function buildReply({ reply, profile, conversationComplete = false, rankingPending = false }) {
  return buildTrialMatchResponse({
    ok: true,
    conversationComplete,
    rankingPending,
    reply: sanitizeText(reply),
    profile,
    results: [],
  })
}

export async function POST(request) {
  const prepared = await prepareTrialMatchRequest(request, { label: 'trial-match-chat' })
  if (prepared.response) return prepared.response
  const { body, context } = prepared
  const { studies, llmOptions } = context

  const messages = sanitizeTrialMatchMessages(body?.messages, {
    maxMessages: MAX_MESSAGES,
    maxMessageLength: MAX_MESSAGE_LENGTH,
  })
  if (!messages.some((message) => message.role === 'user')) {
    return buildTrialMatchResponse({ ok: false, error: 'Provide at least one user message.' }, 400)
  }

  const currentProfile = sanitizePatientProfile(body?.profile)
  const latestUserLabProfile = buildLatestUserLabProfile(messages)
  const preLlmProfile = mergePatientProfiles(currentProfile, latestUserLabProfile)

  try {
    if (!studies.length) {
      return buildReply({ reply: NO_STUDIES_REPLY, profile: preLlmProfile })
    }

    // Both guards answer without an LLM call. A conversation turn carries the study catalog, so a
    // turn that cannot advance a prescreen is the most expensive way to say nothing.
    if (isConversationAlreadyComplete({ messages, completionReply: RESULTS_READY_REPLY })) {
      return buildReply({ reply: CONVERSATION_COMPLETE_REPLY, profile: preLlmProfile, conversationComplete: true })
    }

    if (isOffTopicConversation({ messages, minUserTurns: OFF_TOPIC_USER_TURNS_BEFORE_REDIRECT })) {
      return buildReply({ reply: OFF_TOPIC_REPLY, profile: preLlmProfile })
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
      llmOptions
    )

    const updatedProfile = mergePatientProfiles(preLlmProfile, llmTurn?.patientProfile, latestUserLabProfile)
    const diagnosisHint = extractDiagnosisHintFromMessages(messages)
    const enrichedProfile =
      updatedProfile.diagnosis || !diagnosisHint ? updatedProfile : { ...updatedProfile, diagnosis: diagnosisHint }

    const userTurns = countUserMessages(messages)
    const wantsImmediateRanking = body?.requestMatches === true
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

    if (shouldRankMatches && !shouldPromptFocusedFollowUp) {
      // The ranking is the slow half of a results turn (a second LLM call at higher reasoning
      // effort), so it does not run here. The widget shows this reply, then posts the transcript
      // and profile to /api/trials/match/rank and shows the studies when they arrive.
      // Only `requestMatches: true` can get here with an empty profile; there is nothing to rank.
      if (!hasRankableProfile(enrichedProfile)) {
        return buildReply({ reply: NO_RESULTS_REPLY, profile: enrichedProfile })
      }
      return buildReply({
        reply: buildRankingPendingReply(enrichedProfile),
        profile: enrichedProfile,
        rankingPending: true,
      })
    }

    return buildReply({
      reply: shouldPromptFocusedFollowUp ? followUpReply : llmTurn?.assistantReply || '',
      profile: enrichedProfile,
    })
  } catch (error) {
    console.error('[trial-match-chat] POST failed', error)
    return buildTrialMatchResponse(
      { ok: false, error: error?.message || 'Unable to process the trial matching chat right now.' },
      500
    )
  }
}

export const dynamic = 'force-dynamic'
