import { NextResponse } from 'next/server'
import { sanityFetch, queries } from '@/lib/sanity'
import { readCache } from '@/lib/pubmedCache'
import { generateSummariesBatch } from '@/lib/summaries'
import { DEFAULT_CLASSIFICATION_PROMPT } from '@/lib/classificationPrompt'

const AUTH_TOKEN = process.env.PUBMED_PREVIEW_TOKEN || process.env.PUBMED_REFRESH_TOKEN || ''

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS })
}

function extractToken(request) {
  const header = request.headers.get('authorization') || ''
  if (!header) return ''
  if (header.startsWith('Bearer ')) return header.slice(7)
  return header
}

function clamp(n, min, max) {
  if (Number.isNaN(n)) return min
  return Math.max(min, Math.min(max, n))
}

export async function POST(request) {
  if (AUTH_TOKEN) {
    const token = extractToken(request)
    if (token !== AUTH_TOKEN) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401, headers: CORS_HEADERS })
    }
  }

  try {
    const body = await request.json()
    const requestedCount = clamp(Number(body?.count || 10), 1, 50)
    const overridePrompt = typeof body?.prompt === 'string' ? body.prompt.trim() : ''

    const settings = (await sanityFetch(queries.siteSettings)) || {}
    const cache = await readCache()
    if (!cache?.publications?.length) {
      return NextResponse.json({ ok: false, error: 'No cached publications. Refresh cache first.' }, { status: 400, headers: CORS_HEADERS })
    }

    const classificationPrompt = overridePrompt || settings.llmClassificationPrompt || DEFAULT_CLASSIFICATION_PROMPT
    const provider = body?.provider || settings.llmClassificationProvider || settings.llmProvider || 'openrouter'
    const model = body?.model || settings.llmClassificationModel || settings.llmModel || undefined
    const apiKey = body?.apiKey || settings.llmClassificationApiKey || settings.llmApiKey || undefined
    const systemPrompt = settings.llmSystemPrompt || undefined
    const concurrency = clamp(Number(settings.llmConcurrency || 1), 1, 20)
    const delayMs = clamp(Number(settings.llmDelayMs || 0), 0, 60000)

    // Take most recent publications with abstracts
    const candidates = (cache.publications || [])
      .filter(p => p?.abstract && p.abstract.length >= 50)
      .sort((a, b) => (parseInt(b.year, 10) || 0) - (parseInt(a.year, 10) || 0))
      .slice(0, requestedCount)

    if (!candidates.length) {
      return NextResponse.json({ ok: false, error: 'No publications with abstracts available in cache.' }, { status: 400, headers: CORS_HEADERS })
    }

    const resultsMap = await generateSummariesBatch(candidates, {
      provider,
      model,
      apiKey,
      systemPrompt,
      classificationPrompt,
      classificationProvider: provider,
      classificationModel: model,
      classificationApiKey: apiKey,
      includeExistingLaySummary: true,
      maxItems: candidates.length,
      skipIfHasSummary: false,
      concurrency,
      delayMs,
      retryAttempts: 1,
      debug: false,
    })

    const results = candidates.map(pub => {
      const res = resultsMap.get(pub.pmid) || {}
      return {
        pmid: pub.pmid,
        title: pub.title,
        year: pub.year,
        abstractChars: pub.abstract?.length || 0,
        summary: res.summary || pub.laySummary || null,
        topics: res.topics || pub.topics || [],
        studyDesign: res.studyDesign || pub.studyDesign || [],
        methodologicalFocus: res.methodologicalFocus || pub.methodologicalFocus || [],
        exclude: typeof res.exclude === 'boolean' ? res.exclude : Boolean(pub.exclude),
      }
    })

    return NextResponse.json({
      ok: true,
      usedPrompt: classificationPrompt,
      count: results.length,
      provider,
      model,
      results,
    }, { headers: CORS_HEADERS })
  } catch (err) {
    console.error('[pubmed] classify-preview failed', err)
    return NextResponse.json({ ok: false, error: err?.message || 'Preview failed' }, { status: 500, headers: CORS_HEADERS })
  }
}

export const revalidate = 0
export const dynamic = 'force-dynamic'
