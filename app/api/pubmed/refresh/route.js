import { NextResponse } from 'next/server'
import { sanityFetch, queries } from '@/lib/sanity'
import { refreshPubmedCache } from '@/lib/publications'

const AUTH_TOKEN = process.env.PUBMED_REFRESH_TOKEN || ''

function extractToken(request) {
  const header = request.headers.get('authorization') || ''
  if (!header) return ''
  if (header.startsWith('Bearer ')) return header.slice(7)
  return header
}

export async function POST(request) {
  if (AUTH_TOKEN) {
    const token = extractToken(request)
    if (token !== AUTH_TOKEN) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
    }
  }

  try {
    const settings = (await sanityFetch(queries.siteSettings)) || {}
    const researchersRaw = await sanityFetch(queries.allResearchers)
    const researchers = (researchersRaw || []).map((r) => ({
      _id: r._id,
      name: r.name,
      slug: r.slug,
      pubmedQuery: r.pubmedQuery,
    }))

    const result = await refreshPubmedCache({
      researchers,
      affiliation: settings?.pubmedAffiliation || '',
      maxPerResearcher: Number(process.env.PUBMED_MAX_PER_RESEARCHER || 120),
      maxAffiliation: Number(process.env.PUBMED_MAX_AFFILIATION || 80),
      summariesPerRun: Infinity,
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
      },
    })
  } catch (err) {
    console.error('[pubmed] refresh endpoint failed', err)
    const message = err?.message || 'PubMed refresh failed'
    const status = message.includes('in progress') ? 409 : 500
    return NextResponse.json({ ok: false, error: message }, { status })
  }
}

export const revalidate = 0
export const dynamic = 'force-dynamic'
