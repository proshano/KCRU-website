import { NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { sanityFetch, queries } from '@/lib/sanity'
import { refreshPubmedCache } from '@/lib/publications'
import { readCache } from '@/lib/pubmedCache'
import { buildCorsHeaders, extractBearerToken } from '@/lib/httpUtils'
import { getZonedParts, isCronAuthorized, isVercelCronRequest, sameLocalDate } from '@/lib/cronUtils'
import { getSiteBaseUrl } from '@/lib/seo'

const AUTH_TOKEN = process.env.PUBMED_REFRESH_TOKEN
const CRON_SECRET = process.env.CRON_SECRET || ''

const CRON_TIMEZONE = process.env.CRON_TIMEZONE || 'America/New_York'

// Cron refresh can generate a small number of summaries to avoid needing a second cron job.
// Set CRON_SUMMARIES_LIMIT=0 to disable summary generation during cron runs.
const CRON_SUMMARIES_LIMIT = Number(process.env.CRON_SUMMARIES_LIMIT || 5)
const SEO_REFRESH_ON_PUBMED_CRON = process.env.SEO_REFRESH_ON_PUBMED_CRON === 'true'

const CORS_HEADERS = buildCorsHeaders('GET, POST, OPTIONS')

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS })
}

// GET handler for Vercel cron
export async function GET(request) {
  const now = new Date()
  const nowParts = getZonedParts(now, CRON_TIMEZONE)
  const isVercelCron = isVercelCronRequest(request)
  
  console.info('[pubmed] Cron GET request received', {
    timestamp: now.toISOString(),
    localTime: nowParts,
    timezone: CRON_TIMEZONE,
    hasXVercelCron: request.headers.get('x-vercel-cron'),
    hasAuthHeader: !!request.headers.get('authorization'),
    hasCronSecret: !!CRON_SECRET,
  })

  if (!CRON_SECRET && !isVercelCron) {
    return NextResponse.json({ ok: false, error: 'CRON_SECRET not configured' }, { status: 500, headers: CORS_HEADERS })
  }

  // Only allow cron requests
  if (!isCronAuthorized(request, CRON_SECRET)) {
    console.warn('[pubmed] Cron request rejected: unauthorized', {
      xVercelCron: request.headers.get('x-vercel-cron'),
      authHeaderPresent: !!request.headers.get('authorization'),
      cronSecretConfigured: !!CRON_SECRET,
    })
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401, headers: CORS_HEADERS })
  }

  // Accept delayed cron invocations and only skip once we've already refreshed
  // on the current local day. The lock inside refreshPubmedCache handles overlap.
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
      publicationAuthorName: r.publicationAuthorName,
      publicationExclusions: r.publicationExclusions,
      orcid: r.orcid,
    }))

    // Cron runs with limited summaries to fit timeout; manual runs do all
    const summariesPerRun = isCron ? CRON_SUMMARIES_LIMIT : Infinity

    const result = await refreshPubmedCache({
      researchers,
      maxPerResearcher: Number(process.env.PUBMED_MAX_PER_RESEARCHER || 1000),
      summariesPerRun,
      force: true,
      enableDoiAbstractBackfill: isCron ? true : undefined,
      attributionReviewEnabled: settings.publicationAttributionReview?.enabled === true,
      llmOptions: {
        provider: settings.llmProvider || 'openrouter',
        model: settings.llmModel,
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

    let seoRefresh = null
    if (isCron && SEO_REFRESH_ON_PUBMED_CRON) {
      try {
        const baseUrl = getSiteBaseUrl()
        const response = await fetch(`${baseUrl}/api/seo/refresh`, {
          headers: {
            Authorization: `Bearer ${CRON_SECRET}`
          }
        })
        seoRefresh = { ok: response.ok, status: response.status }
        if (!response.ok) {
          const body = await response.text()
          seoRefresh.error = body.slice(0, 500)
        }
      } catch (err) {
        seoRefresh = { ok: false, error: err?.message || 'SEO refresh failed' }
      }
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
      seoRefresh,
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
