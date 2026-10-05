import { sanitizePatientProfile } from '@/lib/patientProfileSchema'
import {
  MAX_MESSAGES,
  MAX_MESSAGE_LENGTH,
  NO_STUDIES_REPLY,
  buildTrialMatchResponse,
  prepareTrialMatchRequest,
} from '@/lib/trialMatchApi'
import { describeRankingOutcome, hasRankableProfile, rankStudiesForProfile } from '@/lib/trialMatchRanking'
import { sanitizeTrialMatchMessages } from '@/lib/trialMatchRequest'

/**
 * Second half of a results turn. The chat route answers `rankingPending: true` once the profile
 * is ready for matching; the widget shows that reply and posts the same transcript and profile
 * here for the ranked studies. Keeping the ranking in its own request means the person sees the
 * conversation turn's reply as soon as it is ready instead of waiting silently for both LLM calls.
 */
export async function POST(request) {
  const prepared = await prepareTrialMatchRequest(request, { label: 'trial-match-rank' })
  if (prepared.response) return prepared.response
  const { body, context } = prepared

  const profile = sanitizePatientProfile(body?.profile)
  if (!hasRankableProfile(profile)) {
    return buildTrialMatchResponse({ ok: false, error: 'Provide a patient profile before ranking studies.' }, 400)
  }
  const messages = sanitizeTrialMatchMessages(body?.messages, {
    maxMessages: MAX_MESSAGES,
    maxMessageLength: MAX_MESSAGE_LENGTH,
  })

  try {
    if (!context.studies.length) {
      return buildTrialMatchResponse({
        ok: true,
        reply: NO_STUDIES_REPLY,
        profile,
        conversationComplete: false,
        results: [],
      })
    }

    const results = await rankStudiesForProfile({
      studies: context.studies,
      profile,
      messages,
      llmOptions: context.llmOptions,
    })

    return buildTrialMatchResponse({
      ok: true,
      ...describeRankingOutcome(results),
      profile,
    })
  } catch (error) {
    console.error('[trial-match-rank] POST failed', error)
    return buildTrialMatchResponse(
      { ok: false, error: error?.message || 'Unable to rank the studies right now.' },
      500
    )
  }
}

export const dynamic = 'force-dynamic'
