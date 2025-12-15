import { NextResponse } from 'next/server'
import { sanityFetch, queries, client as sanityClient, writeClient as sanityWriteClient } from '@/lib/sanity'
import { readCache } from '@/lib/pubmedCache'
import { classifyPublication } from '@/lib/summaries'
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

async function fetchExistingClassificationMap(pmids = []) {
  if (!pmids.length) return new Map()
  const docs = await sanityClient.fetch(
    `*[_type == "pubmedClassification" && pmid in $pmids]{pmid, _id}`,
    { pmids }
  )
  const map = new Map()
  for (const d of docs || []) {
    if (d?.pmid) map.set(d.pmid, d._id)
  }
  return map
}

async function upsertClassifications(entries = [], meta = {}) {
  const tx = sanityWriteClient.transaction()
  const existingMap = await fetchExistingClassificationMap(entries.map(e => e.pmid).filter(Boolean))

  for (const entry of entries) {
    if (!entry.pmid) continue
    const doc = {
      _type: 'pubmedClassification',
      pmid: entry.pmid,
      title: entry.title || null,
      topics: entry.topics || [],
      studyDesign: entry.studyDesign || [],
      methodologicalFocus: entry.methodologicalFocus || [],
      exclude: Boolean(entry.exclude),
      summary: entry.summary || null,
      promptText: meta.promptText || null,
      promptVersion: meta.promptVersion || null,
      provider: meta.provider || null,
      model: meta.model || null,
      runAt: new Date().toISOString(),
      status: entry.error ? 'error' : 'ok',
      error: entry.error || null,
    }
    const existingId = existingMap.get(entry.pmid)
    if (existingId) {
      tx.patch(existingId).set(doc)
    } else {
      tx.create(doc)
    }
  }

  return tx.commit()
}

async function deleteClassifications(pmids = []) {
  if (!pmids.length) return
  await sanityWriteClient.delete({
    query: `*[_type == "pubmedClassification" && pmid in $pmids]._id`,
    params: { pmids },
  })
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
    const all = body?.all === true
    const requestedCount = clamp(Number(body?.count || 10), 1, 5000)
    const overridePrompt = typeof body?.prompt === 'string' ? body.prompt.trim() : ''
    const pmidsFilter = Array.isArray(body?.pmids) ? body.pmids.map(String).filter(Boolean) : []
    const clearExisting = body?.clear === true
    const batchSize = clamp(Number(body?.batchSize || 50), 1, 200)
    const delayMs = clamp(Number(body?.delayMs || 0), 0, 60000)

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

    // Allow classification even if abstract is missing (prompt rules handle this)
    let candidates = (cache.publications || []).filter(p => p?.pmid && p?.title)
    if (pmidsFilter.length) {
      candidates = candidates.filter(p => pmidsFilter.includes(p.pmid))
    } else if (all) {
      candidates = candidates.sort((a, b) => (parseInt(b.year, 10) || 0) - (parseInt(a.year, 10) || 0))
    } else {
      candidates = candidates
        .sort((a, b) => (parseInt(b.year, 10) || 0) - (parseInt(a.year, 10) || 0))
        .slice(0, requestedCount)
    }

    if (!candidates.length) {
      return NextResponse.json({ ok: false, error: 'No publications selected/found.' }, { status: 400, headers: CORS_HEADERS })
    }

    if (clearExisting) {
      await deleteClassifications(candidates.map(c => c.pmid))
    }

    const meta = { promptText: classificationPrompt, promptVersion: null, provider, model }
    let processed = 0

    for (let i = 0; i < candidates.length; i += batchSize) {
      const batch = candidates.slice(i, i + batchSize)
      const entries = []

      // sequential per-record classification to be robust and avoid provider throttling
      for (const pub of batch) {
        try {
          const c = await classifyPublication(
            {
              title: pub.title,
              abstract: pub.abstract || '',
              laySummary: pub.laySummary || ''
            },
            {
              provider,
              model,
              apiKey,
              systemPrompt,
              classificationPrompt,
              debug: false
            }
          )
          entries.push({
            pmid: pub.pmid,
            title: pub.title || null,
            summary: pub.laySummary || null,
            topics: c.topics || [],
            studyDesign: c.studyDesign || [],
            methodologicalFocus: c.methodologicalFocus || [],
            exclude: Boolean(c.exclude),
            error: null
          })
        } catch (err) {
          entries.push({
            pmid: pub.pmid,
            title: pub.title || null,
            summary: pub.laySummary || null,
            topics: [],
            studyDesign: [],
            methodologicalFocus: [],
            exclude: false,
            error: err?.message || 'Classification failed'
          })
        }
      }

      await upsertClassifications(entries, meta)
      processed += entries.length

      if (delayMs > 0 && i + batchSize < candidates.length) {
        await new Promise(res => setTimeout(res, delayMs))
      }
    }

    return NextResponse.json({
      ok: true,
      count: processed,
      usedPrompt: classificationPrompt,
      provider,
      model,
    }, { headers: CORS_HEADERS })
  } catch (err) {
    console.error('[pubmed] reclassify failed', err)
    return NextResponse.json({ ok: false, error: err?.message || 'Reclassify failed' }, { status: 500, headers: CORS_HEADERS })
  }
}

export const revalidate = 0
export const dynamic = 'force-dynamic'
