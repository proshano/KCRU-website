import { NextResponse } from 'next/server'

import { sanitizePatientProfile, hasMeaningfulPatientProfile } from '@/lib/patientProfileSchema'
import { sanityFetch, queries } from '@/lib/sanity'
import {
  buildTrialEligibilityCatalogForPrompt,
  generateTrialMatchConversation,
  generateTrialMatchStudyRanking,
} from '@/lib/summaries'
import { isTrialMatchingAssistantEnabled } from '@/lib/trialMatchingSettings'
import { buildTrialCatalogForPrompt, rankTrialMatches } from '@/lib/trialMatcher'

const MAX_MESSAGES = 12
const MAX_MESSAGE_LENGTH = 600
const MAX_RESULTS = 6
/** When at least one match/possible exists, limit how many insufficient_info rows appear in the top list. */
const MAX_INSUFFICIENT_WHEN_BETTER_EXISTS = 2
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000
const MAX_REQUESTS_PER_WINDOW = 20
const rateLimitStore = new Map()

function sanitizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim()
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
        trialCatalog: buildTrialCatalogForPrompt(studies),
        trialEligibilityCatalog: buildTrialEligibilityCatalogForPrompt(studies),
      },
      buildLlmOptions(settings)
    )

    const updatedProfile = sanitizePatientProfile(llmTurn?.patientProfile || currentProfile)
    const shouldRankMatches = llmTurn?.readyForMatching || hasMeaningfulPatientProfile(updatedProfile)
    const llmOpts = buildLlmOptions(settings)
    let rankedResults = []
    if (shouldRankMatches) {
      try {
        rankedResults = await generateTrialMatchStudyRanking(
          { profile: updatedProfile, studies },
          { ...llmOpts, maxTokens: 1200, temperature: 0.35 }
        )
      } catch (rankError) {
        console.error('[trial-match-chat] LLM study ranking failed, using rule-based fallback', rankError)
        rankedResults = sliceRankedTrialMatches(rankTrialMatches(studies, updatedProfile), MAX_RESULTS)
      }
    }

    const privacyPrefix = hadRedaction
      ? 'I removed some obvious identifying details before continuing. Please avoid names, contact information, exact birth dates, or record numbers. '
      : ''

    return buildResponse({
      ok: true,
      reply: `${privacyPrefix}${llmTurn?.assistantReply || ''}`.trim(),
      profile: updatedProfile,
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
