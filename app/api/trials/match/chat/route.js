import { NextResponse } from 'next/server'

import { sanitizePatientProfile, hasMeaningfulPatientProfile } from '@/lib/patientProfileSchema'
import { sanityFetch, queries } from '@/lib/sanity'
import {
  buildTrialEligibilityCatalogForPrompt,
  generateTrialMatchConversation,
  generateTrialMatchStudyRanking,
} from '@/lib/summaries'
import { isTrialMatchingAssistantEnabled } from '@/lib/trialMatchingSettings'
import { buildTrialCatalogForPrompt, matchTrialToPatient, rankTrialMatches } from '@/lib/trialMatcher'

const MAX_MESSAGES = 12
const MAX_MESSAGE_LENGTH = 600
const MAX_RESULTS = 6
const MAX_LLM_RANK_STUDIES = 12
const MIN_USER_TURNS_BEFORE_LLM_RANKING = 2
/** When at least one match/possible exists, limit how many insufficient_info rows appear in the top list. */
const MAX_INSUFFICIENT_WHEN_BETTER_EXISTS = 2
const RESULTS_READY_REPLY = 'See the potential studies below. A coordinator would confirm final eligibility.'
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000
const MAX_REQUESTS_PER_WINDOW = 20
const rateLimitStore = new Map()

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
  const prescreenSummary = study?.prescreen?.screeningSummary || ''
  const inc = Array.isArray(study?.inclusionCriteria) ? study.inclusionCriteria.join(' ') : ''
  return sanitizeText([study?.title, study?.laySummary, prescreenSummary, inc].filter(Boolean).join(' '))
}

function quickTextRankStudies(studies, queryText, profile = {}) {
  const tokens = tokenizeQuery(queryText)
  if (!tokens.length) return []

  const rows = studies
    .map((study) => {
      const fallbackMatch = matchTrialToPatient(study, profile)
      if (fallbackMatch?.decision === 'unlikely') return null

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

function buildLlmRankingShortlist(studies, profile, messages) {
  if (!Array.isArray(studies) || !studies.length) return []

  const byId = new Map(studies.map((study) => [study?._id, study]))
  const deterministic = rankTrialMatches(studies, profile)
    .filter((row) => row?.decision !== 'unlikely')
    .slice(0, MAX_LLM_RANK_STUDIES)
  const textRanked = quickTextRankStudies(studies, getLastUserMessage(messages)?.content || '', profile)
  const merged = mergeRankedResults(deterministic, textRanked, MAX_LLM_RANK_STUDIES)
  const shortlist = merged.map((row) => byId.get(row?._id)).filter(Boolean)

  if (shortlist.length) return shortlist
  return studies.slice(0, MAX_LLM_RANK_STUDIES)
}

function getClientIp(headers) {
  const forwarded = headers.get('x-forwarded-for')
  if (forwarded) {
    return sanitizeText(forwarded.split(',')[0])
  }

  return sanitizeText(headers.get('x-real-ip')) || 'unknown'
}

function checkRateLimit(ipAddress) {
  const now = Date.now()
  const existing = rateLimitStore.get(ipAddress)

  if (!existing || now > existing.resetAt) {
    rateLimitStore.set(ipAddress, {
      count: 1,
      resetAt: now + RATE_LIMIT_WINDOW_MS,
    })
    return null
  }

  existing.count += 1
  rateLimitStore.set(ipAddress, existing)

  if (existing.count > MAX_REQUESTS_PER_WINDOW) {
    return Math.max(1, Math.ceil((existing.resetAt - now) / 1000))
  }

  return null
}

function redactPotentialIdentifiers(value) {
  const original = sanitizeText(value)
  if (!original) {
    return { text: '', hadRedaction: false }
  }

  let redacted = original
  redacted = redacted.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted email]')
  redacted = redacted.replace(/\b(?:mrn|medical record number)\s*[:#]?\s*[A-Za-z0-9-]+\b/gi, '[redacted record number]')
  redacted = redacted.replace(/\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/g, '[redacted date]')
  redacted = redacted.replace(/\b\d{6,}\b/g, '[redacted number]')
  redacted = redacted.replace(
    /\b(?:dob|date of birth)\s*[:#]?\s*\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/gi,
    '[redacted date of birth]'
  )
  redacted = redacted.replace(/\+?\d[\d\s().-]{7,}\d/g, '[redacted phone]')

  return {
    text: redacted,
    hadRedaction: redacted !== original,
  }
}

function sanitizeMessages(value) {
  if (!Array.isArray(value)) {
    return { messages: [], hadRedaction: false }
  }

  let hadRedaction = false
  const messages = value
    .slice(-MAX_MESSAGES)
    .map((message) => {
      if (!message || typeof message !== 'object') return null
      const role = message.role === 'assistant' ? 'assistant' : 'user'
      const { text, hadRedaction: redacted } = redactPotentialIdentifiers(message.content)
      if (redacted) hadRedaction = true
      if (!text) return null
      return {
        role,
        content: text.slice(0, MAX_MESSAGE_LENGTH),
      }
    })
    .filter(Boolean)

  return { messages, hadRedaction }
}

function buildLlmOptions(settings) {
  const clean = (value) => {
    const text = sanitizeText(value)
    return text || undefined
  }

  return {
    provider: clean(settings?.trialSummaryLlmProvider) || clean(settings?.llmProvider),
    model: clean(settings?.trialSummaryLlmModel) || clean(settings?.llmModel),
    apiKey: clean(settings?.trialSummaryLlmApiKey) || clean(settings?.llmApiKey),
  }
}

function stripExclusionCriteriaForAssistant(studies = []) {
  if (!Array.isArray(studies)) return []
  return studies.map((study) => {
    if (!study || typeof study !== 'object') return study
    const { exclusionCriteria: _excluded, ...safeStudy } = study
    return safeStudy
  })
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
  const retryAfter = checkRateLimit(getClientIp(request.headers))
  if (retryAfter) {
    return NextResponse.json(
      { ok: false, error: 'Too many requests. Please wait a few minutes before trying again.' },
      {
        status: 429,
        headers: {
          'Cache-Control': 'no-store',
          'Retry-After': String(retryAfter),
        },
      }
    )
  }

  let body
  try {
    body = await request.json()
  } catch {
    return buildResponse({ ok: false, error: 'Invalid JSON payload.' }, 400)
  }

  const { messages, hadRedaction } = sanitizeMessages(body?.messages)
  if (!messages.some((message) => message.role === 'user')) {
    return buildResponse({ ok: false, error: 'Provide at least one user message.' }, 400)
  }

  const currentProfile = sanitizePatientProfile(body?.profile)

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
    const assistantStudies = stripExclusionCriteriaForAssistant(studies)
    if (!studies.length) {
      return buildResponse({
        ok: true,
        reply: 'No active studies are available for the matching assistant yet. Please browse the studies page or contact the research team.',
        profile: currentProfile,
        results: [],
      })
    }

    const llmTurn = await generateTrialMatchConversation(
      {
        currentProfile,
        messages,
        trialCatalog: buildTrialCatalogForPrompt(assistantStudies),
        trialEligibilityCatalog: buildTrialEligibilityCatalogForPrompt(assistantStudies),
      },
      buildLlmOptions(settings)
    )

    const updatedProfile = sanitizePatientProfile(llmTurn?.patientProfile || currentProfile)
    const diagnosisHint = extractDiagnosisHintFromMessages(messages)
    const enrichedProfile =
      updatedProfile.diagnosis || !diagnosisHint ? updatedProfile : { ...updatedProfile, diagnosis: diagnosisHint }

    const userTurns = countUserMessages(messages)
    const wantsImmediateRanking = body?.requestMatches === true
    const hasEnoughTurnsForRanking = wantsImmediateRanking || userTurns >= MIN_USER_TURNS_BEFORE_LLM_RANKING
    const shouldRankMatches =
      (llmTurn?.readyForMatching || hasMeaningfulPatientProfile(enrichedProfile)) && hasEnoughTurnsForRanking
    const llmOpts = buildLlmOptions(settings)
    let rankedResults = []
    if (shouldRankMatches) {
      const rankingShortlist = buildLlmRankingShortlist(assistantStudies, enrichedProfile, messages)
      try {
        rankedResults = await generateTrialMatchStudyRanking(
          { profile: enrichedProfile, studies: rankingShortlist },
          { ...llmOpts, maxTokens: 1200, temperature: 0.35 }
        )
      } catch (rankError) {
        console.error('[trial-match-chat] LLM study ranking failed, using rule-based fallback', rankError)
        rankedResults = sliceRankedTrialMatches(rankTrialMatches(rankingShortlist, enrichedProfile), MAX_RESULTS)
      }
    } else {
      rankedResults = quickTextRankStudies(
        assistantStudies,
        getLastUserMessage(messages)?.content || '',
        enrichedProfile
      )
    }

    const privacyPrefix = hadRedaction
      ? 'I removed some obvious identifying details before continuing. Please avoid names, contact information, exact birth dates, or record numbers. '
      : ''
    const reply =
      shouldRankMatches && rankedResults.length
        ? RESULTS_READY_REPLY
        : llmTurn?.assistantReply || ''

    return buildResponse({
      ok: true,
      reply: `${privacyPrefix}${reply}`.trim(),
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
