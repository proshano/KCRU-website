import { NextResponse } from 'next/server'
import { sanityFetch, queries } from '@/lib/sanity'
import { refreshPubmedCache, getCachedPublicationsDisplay } from '@/lib/publications'

const CRON_SECRET = process.env.CRON_SECRET || ''

// Max summaries per cron run (to fit Vercel timeout on free tier)
// Set higher if on Pro plan, or Infinity for no limit
const CRON_SUMMARIES_LIMIT = process.env.CRON_SUMMARIES_LIMIT
  ? Number(process.env.CRON_SUMMARIES_LIMIT)
  : 5

function isVercelCron(request) {
  const authHeader = request.headers.get('authorization')
  if (CRON_SECRET && authHeader === `Bearer ${CRON_SECRET}`) {
    return true
  }
  return request.headers.get('x-vercel-cron') === '1'
}

export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const forceRefresh = searchParams.get('refresh') === 'true'
  const isCron = isVercelCron(request)

  try {
    const settings = (await sanityFetch(queries.siteSettings)) || {}
    const researchersRaw = await sanityFetch(queries.allResearchers)
    const researchers = (researchersRaw || []).map((r) => ({
      _id: r._id,
      name: r.name,
      slug: r.slug,
      pubmedQuery: r.pubmedQuery,
    }))

    // If refresh requested (cron or manual), trigger pubmed cache refresh
    if (forceRefresh || isCron) {
      const summariesPerRun = isCron ? CRON_SUMMARIES_LIMIT : Infinity

      const result = await refreshPubmedCache({
        researchers,
        affiliation: settings?.pubmedAffiliation || '',
        maxPerResearcher: Number(process.env.PUBMED_MAX_PER_RESEARCHER || 120),
        maxAffiliation: Number(process.env.PUBMED_MAX_AFFILIATION || 80),
        summariesPerRun,
        force: forceRefresh,
        llmOptions: {
          provider: settings.llmProvider || 'openrouter',
          model: settings.llmModel,
          apiKey: settings.llmApiKey,
          systemPrompt: settings.llmSystemPrompt,
        },
      })

      return NextResponse.json({
        ok: true,
        refreshed: true,
        triggeredBy: isCron ? 'cron' : 'manual',
        meta: {
          generatedAt: result?.generatedAt,
          counts: result?.meta?.counts,
          summaries: result?.meta?.summaries,
        },
      })
    }

    // Otherwise just return cached publications display
    const bundle = await getCachedPublicationsDisplay({
      researchers,
      affiliation: settings?.pubmedAffiliation || '',
      summariesPerRun: 0, // Don't generate summaries on read
      llmOptions: {
        provider: settings.llmProvider || 'openrouter',
        model: settings.llmModel,
        apiKey: settings.llmApiKey,
      },
    })

    return NextResponse.json({
      ok: true,
      refreshed: false,
      publications: bundle.publications?.length || 0,
      years: bundle.years,
      meta: bundle.meta,
    })
  } catch (err) {
    console.error('[publications] API error', err)
    const message = err?.message || 'Publications API failed'
    const status = message.includes('in progress') ? 409 : 500
    return NextResponse.json({ ok: false, error: message }, { status })
  }
}

export const revalidate = 0
export const dynamic = 'force-dynamic'
