import { NextResponse } from 'next/server'
import { sanityFetch, queries } from '@/lib/sanity'
import { generateMissingSummaries } from '@/lib/publications'

const AUTH_TOKEN = process.env.PUBMED_REFRESH_TOKEN || ''
const CRON_SECRET = process.env.CRON_SECRET || ''

// Max summaries to generate per cron run (default: 5 to stay within timeout)
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
  const authHeader = request.headers.get('authorization')
  if (CRON_SECRET && authHeader === `Bearer ${CRON_SECRET}`) {
    return true
  }
  if (request.headers.get('x-vercel-cron') === '1') {
    return true
  }
  if (!CRON_SECRET) {
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

// GET handler for Vercel cron - generates summaries for publications missing them
export async function GET(request) {
  const now = new Date()

  console.info('[pubmed-summarize] Cron GET request received', {
    timestamp: now.toISOString(),
    hasXVercelCron: request.headers.get('x-vercel-cron'),
    hasAuthHeader: !!request.headers.get('authorization'),
    hasCronSecret: !!CRON_SECRET,
  })

  // Only allow cron requests
  if (!isVercelCron(request)) {
    console.warn('[pubmed-summarize] Cron request rejected: unauthorized')
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401, headers: CORS_HEADERS })
  }

  return runSummarize({ isCron: true, maxSummaries: CRON_SUMMARIES_LIMIT })
}

// POST handler for manual triggers
export async function POST(request) {
  if (AUTH_TOKEN) {
    const token = extractToken(request)
    if (token !== AUTH_TOKEN) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401, headers: CORS_HEADERS })
    }
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
