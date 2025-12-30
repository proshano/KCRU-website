import { NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { sanityFetch, queries } from '@/lib/sanity'
import { refreshPubmedCache } from '@/lib/publications'
import { readCache } from '@/lib/pubmedCache'

const AUTH_TOKEN = process.env.PUBMED_REFRESH_TOKEN || ''
const CRON_SECRET = process.env.CRON_SECRET || ''

// Vercel cron schedules are UTC-only. To run at 3am Eastern year-round (DST-aware),
// we schedule both 07:00 and 08:00 UTC and only execute when it's 03:00 in America/New_York.
const CRON_TIMEZONE = process.env.CRON_TIMEZONE || 'America/New_York'
const CRON_TARGET_HOUR = Number(process.env.CRON_TARGET_HOUR || 3)
// Allow a small window in case of minor scheduling drift.
const CRON_ALLOWED_MINUTES = Number(process.env.CRON_ALLOWED_MINUTES || 10)

// Cron refresh can generate a small number of summaries to avoid needing a second cron job.
// Set CRON_SUMMARIES_LIMIT=0 to disable summary generation during cron runs.
const CRON_SUMMARIES_LIMIT = Number(process.env.CRON_SUMMARIES_LIMIT || 5)

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

function extractToken(request) {
  const header = request.headers.get('authorization') || ''
  if (!header) return ''
  if (header.startsWith('Bearer ')) return header.slice(7)
  return header
}

function isVercelCron(request) {
  // Method 1: Check CRON_SECRET (recommended by Vercel)
  // When CRON_SECRET is set in Vercel env vars, Vercel sends it as Bearer token
  const authHeader = request.headers.get('authorization')
  if (CRON_SECRET && authHeader === `Bearer ${CRON_SECRET}`) {
    return true
  }
  
  // Method 2: Check Vercel's internal cron header (set automatically by Vercel)
  if (request.headers.get('x-vercel-cron') === '1') {
    return true
  }
  
  // Method 3: If no CRON_SECRET is configured, allow unauthenticated cron requests
  // This is less secure but allows crons to work without extra configuration
  // Remove this if you want stricter security
  if (!CRON_SECRET) {
    // Check if this looks like a Vercel cron request (User-Agent, etc.)
    const userAgent = request.headers.get('user-agent') || ''
    if (userAgent.includes('vercel-cron')) {
      return true
    }
  }
  
  return false
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS })
}

function getZonedParts(date, timeZone) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
  const parts = fmt.formatToParts(date)
  const map = {}
  for (const p of parts) {
    if (p.type !== 'literal') map[p.type] = p.value
  }
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
  }
}

function sameLocalDate(a, b, timeZone) {
  if (!a || !b) return false
  const pa = getZonedParts(a, timeZone)
  const pb = getZonedParts(b, timeZone)
  return pa.year === pb.year && pa.month === pb.month && pa.day === pb.day
}

function shouldRunNow({ timeZone, targetHour, allowedMinutes }) {
  const now = new Date()
  const p = getZonedParts(now, timeZone)
  const fallbackHour = (targetHour + 23) % 24
  const hourMatches = p.hour === targetHour || p.hour === fallbackHour
  return hourMatches && p.minute >= 0 && p.minute < allowedMinutes
}

// GET handler for Vercel cron
export async function GET(request) {
  const now = new Date()
  const nowParts = getZonedParts(now, CRON_TIMEZONE)
  
  console.info('[pubmed] Cron GET request received', {
    timestamp: now.toISOString(),
    localTime: nowParts,
    timezone: CRON_TIMEZONE,
    hasXVercelCron: request.headers.get('x-vercel-cron'),
    hasAuthHeader: !!request.headers.get('authorization'),
    hasCronSecret: !!CRON_SECRET,
  })

  // Only allow cron requests
  if (!isVercelCron(request)) {
    console.warn('[pubmed] Cron request rejected: unauthorized', {
      xVercelCron: request.headers.get('x-vercel-cron'),
      authHeaderPresent: !!request.headers.get('authorization'),
      cronSecretConfigured: !!CRON_SECRET,
    })
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401, headers: CORS_HEADERS })
  }

  // Run only at 3:00am America/New_York (DST-aware), otherwise skip.
  // Set CRON_SKIP_TIME_CHECK=true to bypass for debugging
  const skipTimeCheck = process.env.CRON_SKIP_TIME_CHECK === 'true'
  if (!skipTimeCheck && !shouldRunNow({ timeZone: CRON_TIMEZONE, targetHour: CRON_TARGET_HOUR, allowedMinutes: CRON_ALLOWED_MINUTES })) {
    console.info('[pubmed] Cron skipped: outside time window', {
      nowLocal: nowParts,
      targetHour: CRON_TARGET_HOUR,
      allowedMinutes: CRON_ALLOWED_MINUTES,
    })
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: 'Outside scheduled local-time window',
      timezone: CRON_TIMEZONE,
      nowLocal: nowParts,
      target: { hour: CRON_TARGET_HOUR, minuteWindow: [0, CRON_ALLOWED_MINUTES - 1] },
    }, { headers: CORS_HEADERS })
  }

  // Avoid accidental double-runs (retries / duplicate schedules) within the same local day.
  try {
    const existing = await readCache()
    const last = existing?.generatedAt ? new Date(existing.generatedAt) : null
    if (last && sameLocalDate(last, new Date(), CRON_TIMEZONE)) {
      return NextResponse.json({
        ok: true,
        skipped: true,
        reason: 'Already refreshed today (local timezone)',
        timezone: CRON_TIMEZONE,
        lastRefreshedAt: existing.generatedAt,
      }, { headers: CORS_HEADERS })
    }
  } catch (err) {
    // If cache read fails, proceed with refresh (better to refresh than silently skip).
    console.error('[pubmed] cron precheck failed (readCache)', err)
  }

  return runRefresh({ isCron: true })
}

// POST handler for Studio/manual triggers
export async function POST(request) {
  if (AUTH_TOKEN) {
    const token = extractToken(request)
    if (token !== AUTH_TOKEN) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401, headers: CORS_HEADERS })
    }
  }

  return runRefresh({ isCron: false })
}

async function runRefresh({ isCron = false } = {}) {
  try {
    const settings = (await sanityFetch(queries.siteSettings)) || {}
    console.info('[pubmed] Sanity settings loaded', {
      llmProvider: settings.llmProvider,
      llmModel: settings.llmModel,
    })
    const researchersRaw = await sanityFetch(queries.allResearchers)
    const researchers = (researchersRaw || []).map((r) => ({
      _id: r._id,
      name: r.name,
      slug: r.slug,
      pubmedQuery: r.pubmedQuery,
    }))

    // Cron runs with limited summaries to fit timeout; manual runs do all
    const summariesPerRun = isCron ? CRON_SUMMARIES_LIMIT : Infinity

    const result = await refreshPubmedCache({
      researchers,
      maxPerResearcher: Number(process.env.PUBMED_MAX_PER_RESEARCHER || 1000),
      summariesPerRun,
      force: true,
      llmOptions: {
        provider: settings.llmProvider || 'openrouter',
        model: settings.llmModel,
        apiKey: settings.llmApiKey,
        systemPrompt: settings.llmSystemPrompt,
        concurrency: settings.llmConcurrency || 1,
        delayMs: settings.llmDelayMs || 2000,
      },
    })

    // Revalidate the publications page so fresh data appears
    try {
      revalidatePath('/publications')
      revalidatePath('/team', 'layout') // Also revalidate team pages which show publications
    } catch (revalErr) {
      console.warn('[pubmed] Revalidation warning:', revalErr.message)
    }

    return NextResponse.json({
      ok: true,
      meta: {
        generatedAt: result?.generatedAt,
        counts: result?.meta?.counts,
        summaries: result?.meta?.summaries,
        cachePath: result?.meta?.cachePath,
        stale: false,
        triggeredBy: isCron ? 'cron' : 'manual',
      },
    }, { headers: CORS_HEADERS })
  } catch (err) {
    console.error('[pubmed] refresh endpoint failed', err)
    const message = err?.message || 'PubMed refresh failed'
    const status = message.includes('in progress') ? 409 : 500
    return NextResponse.json({ ok: false, error: message }, { status, headers: CORS_HEADERS })
  }
}

export const revalidate = 0
export const dynamic = 'force-dynamic'
// Allow up to 60 seconds for cron jobs (Vercel Hobby limit)
export const maxDuration = 60
