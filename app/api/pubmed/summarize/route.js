import { NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { sanityFetch, queries } from '@/lib/sanity'
import { generateMissingSummaries } from '@/lib/publications'
import { buildCorsHeaders, extractBearerToken } from '@/lib/httpUtils'
import { isCronAuthorized } from '@/lib/cronUtils'

const AUTH_TOKEN = process.env.PUBMED_REFRESH_TOKEN
const CRON_SECRET = process.env.CRON_SECRET || ''

// Max summaries to generate per cron run (default: 5 to stay within timeout)
const CRON_SUMMARIES_LIMIT = Number(process.env.CRON_SUMMARIES_LIMIT || 5)

const CORS_HEADERS = buildCorsHeaders('GET, POST, OPTIONS')

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS })
}

// GET handler for Vercel cron - generates summaries for publications missing them
export async function GET(request) {
  const now = new Date()

  console.info('[pubmed-summarize] Cron GET request received', {
    timestamp: now.toISOString(),
    hasXVercelCron: request.headers.get('x-vercel-cron'),
    hasAuthHeader: !!request.headers.get('authorization'),
    hasCronSecret: !!CRON_SECRET,
  })

  if (!CRON_SECRET) {
    return NextResponse.json({ ok: false, error: 'CRON_SECRET not configured' }, { status: 500, headers: CORS_HEADERS })
  }

  // Only allow cron requests
  if (!isCronAuthorized(request, CRON_SECRET)) {
    console.warn('[pubmed-summarize] Cron request rejected: unauthorized')
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401, headers: CORS_HEADERS })
  }

  return runSummarize({ isCron: true, maxSummaries: CRON_SUMMARIES_LIMIT })
}

// POST handler for manual triggers
export async function POST(request) {
  if (!AUTH_TOKEN) {
    return NextResponse.json(
      { ok: false, error: 'PUBMED_REFRESH_TOKEN not configured' },
      { status: 500, headers: CORS_HEADERS }
    )
  }

  const token = extractBearerToken(request)
  if (token !== AUTH_TOKEN) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401, headers: CORS_HEADERS })
  }

  // Parse body for optional maxSummaries override
  let maxSummaries = Infinity
  try {
    const body = await request.json()
    if (typeof body.maxSummaries === 'number') {
      maxSummaries = body.maxSummaries
    }
  } catch {
    // No body or invalid JSON, use defaults
  }

  return runSummarize({ isCron: false, maxSummaries })
}

async function runSummarize({ isCron = false, maxSummaries = 5 } = {}) {
  try {
    const settings = (await sanityFetch(queries.siteSettings)) || {}
    console.info('[pubmed-summarize] Sanity settings loaded', {
      llmProvider: settings.llmProvider,
      llmModel: settings.llmModel,
      maxSummaries,
      isCron,
    })

    const result = await generateMissingSummaries({
      maxSummaries,
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
      console.warn('[pubmed-summarize] Revalidation warning:', revalErr.message)
    }

    return NextResponse.json({
      ok: true,
      meta: {
        ...result,
        triggeredBy: isCron ? 'cron' : 'manual',
      },
    }, { headers: CORS_HEADERS })
  } catch (err) {
    console.error('[pubmed-summarize] endpoint failed', err)
    const message = err?.message || 'Summary generation failed'
    return NextResponse.json({ ok: false, error: message }, { status: 500, headers: CORS_HEADERS })
  }
}

export const revalidate = 0
export const dynamic = 'force-dynamic'
// Allow up to 60 seconds for cron jobs (Vercel Hobby limit)
export const maxDuration = 60
