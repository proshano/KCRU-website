import { NextResponse } from 'next/server'
import { sanityFetch, queries } from '@/lib/sanity'
import { refreshPubmedCache } from '@/lib/publications'

const AUTH_TOKEN = process.env.PUBMED_REFRESH_TOKEN || ''
const CRON_SECRET = process.env.CRON_SECRET || ''

// Max summaries to generate per cron run
// Default: Infinity (generate all). Set CRON_SUMMARIES_LIMIT env var to limit if hitting timeouts
const CRON_SUMMARIES_LIMIT = process.env.CRON_SUMMARIES_LIMIT 
  ? Number(process.env.CRON_SUMMARIES_LIMIT) 
  : Infinity

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
  // Vercel cron jobs set this header
  const authHeader = request.headers.get('authorization')
  if (CRON_SECRET && authHeader === `Bearer ${CRON_SECRET}`) {
    return true
  }
  // Also check for Vercel's internal cron header (older method)
  return request.headers.get('x-vercel-cron') === '1'
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS })
}

// GET handler for Vercel cron
export async function GET(request) {
  // Only allow cron requests
  if (!isVercelCron(request)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401, headers: CORS_HEADERS })
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
      affiliation: settings?.pubmedAffiliation || '',
      maxPerResearcher: Number(process.env.PUBMED_MAX_PER_RESEARCHER || 120),
      maxAffiliation: Number(process.env.PUBMED_MAX_AFFILIATION || 80),
      summariesPerRun,
      force: true,
      llmOptions: {
        provider: settings.llmProvider || 'openrouter',
        model: settings.llmModel,
        apiKey: settings.llmApiKey,
        systemPrompt: settings.llmSystemPrompt,
      },
    })

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
