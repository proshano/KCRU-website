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

function sortByYearDesc(a, b) {
  return (parseInt(b.year, 10) || 0) - (parseInt(a.year, 10) || 0)
}

async function fetchExistingClassifications(pmids = []) {
  if (!pmids.length) return new Map()
  const pmidsStr = pmids.map(String).filter(Boolean)
  const pmidsNum = pmidsStr.map((p) => Number(p)).filter(Number.isFinite)
  const docs = await sanityClient.fetch(
    `*[_type == "pubmedClassification" && (pmid in $pmids || pmid in $pmidsNum)]{pmid, _id, status, runAt}`,
    { pmids: pmidsStr, pmidsNum }
  )
  const map = new Map()
  for (const d of docs || []) {
    const key = d?.pmid ? String(d.pmid) : ''
    if (key) map.set(key, { id: d._id, status: d.status || null, runAt: d.runAt || null })
  }
  return map
}

async function fetchExistingClassificationMap(pmids = []) {
  const docs = await fetchExistingClassifications(pmids)
  const map = new Map()
  for (const [pmid, info] of docs.entries()) {
    if (info?.id) map.set(pmid, info.id)
  }
  return map
}

async function upsertClassifications(entries = [], meta = {}, existingIdMap = null) {
  const tx = sanityWriteClient.transaction()
  const existingMap = existingIdMap || await fetchExistingClassificationMap(entries.map(e => e.pmid).filter(Boolean))

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
      const patchDoc = { ...doc }
      delete patchDoc._type
      tx.patch(existingId, { set: patchDoc })
    } else {
      tx.create(doc)
    }
  }

  return tx.commit()
}

async function deleteClassifications(pmids = []) {
  if (!pmids.length) return
  const pmidsStr = pmids.map(String).filter(Boolean)
  const pmidsNum = pmidsStr.map((p) => Number(p)).filter(Number.isFinite)
  await sanityWriteClient.delete({
    query: `*[_type == "pubmedClassification" && (pmid in $pmids || pmid in $pmidsNum)]._id`,
    params: { pmids: pmidsStr, pmidsNum },
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
    const cacheGeneratedAtTs = cache?.generatedAt ? Date.parse(cache.generatedAt) : null

    // Allow classification even if abstract is missing (prompt rules handle this)
    const publications = (cache.publications || []).filter(p => p?.pmid && p?.title)
    const sortedPublications = [...publications].sort(sortByYearDesc)

    // Start with PMIDs filter (if provided), otherwise all sorted publications.
    let candidates = pmidsFilter.length
      ? sortedPublications.filter(p => pmidsFilter.includes(p.pmid))
      : sortedPublications

    if (!candidates.length) {
      return NextResponse.json({ ok: false, error: 'No publications selected/found.' }, { status: 400, headers: CORS_HEADERS })
    }

    const appliedMissingOnly = !pmidsFilter.length && !all && !clearExisting
    const initialCandidateCount = candidates.length
    let existingClassifications = null
    let skippedAlreadyClassified = 0
    let missingCount = 0
    let erroredCount = 0
    let staleCount = 0

    if (appliedMissingOnly) {
      existingClassifications = await fetchExistingClassifications(candidates.map(c => c.pmid))
      candidates = candidates.filter(pub => {
        const existing = existingClassifications.get(pub.pmid)
        if (existing) {
          if (existing.status === 'error') {
            erroredCount += 1
            return true
          }
          const runAtTs = existing.runAt ? Date.parse(existing.runAt) : null
          const isStale = cacheGeneratedAtTs && runAtTs && runAtTs < cacheGeneratedAtTs
          if (isStale || !runAtTs) {
            staleCount += 1
          }
          skippedAlreadyClassified += 1
          return false
        }
        missingCount += 1
        return true
      })
    }

    // Default (no pmids provided and not "all"): take the most recent unclassified items
    if (!pmidsFilter.length && !all) {
      candidates = candidates.slice(0, requestedCount)
    }

    const selection = {
      appliedMissingOnly,
      requestedCount,
      totalAvailable: publications.length,
      pmidsProvided: pmidsFilter.length,
      initialCandidateCount,
      skippedAlreadyClassified,
      missingCount,
      erroredCount,
      staleCount,
      selectedCount: candidates.length,
      cacheGeneratedAt: cache?.generatedAt || null,
      targetPmids: candidates.map(c => c.pmid),
      targetPreview: candidates.slice(0, 20).map(c => ({
        pmid: c.pmid,
        title: c.title,
        year: c.year || null,
      })),
    }

    if (!candidates.length) {
      return NextResponse.json({
        ok: true,
        count: 0,
        usedPrompt: classificationPrompt,
        provider,
        model,
        selection,
        message: appliedMissingOnly ? 'No unclassified publications found.' : 'No publications selected.',
      }, { headers: CORS_HEADERS })
    }

    if (clearExisting) {
      await deleteClassifications(candidates.map(c => c.pmid))
    }

    const existingIdMap = !clearExisting && existingClassifications
      ? new Map(
        [...existingClassifications.entries()]
          .filter(([, info]) => info?.id)
          .map(([pmid, info]) => [pmid, info.id])
      )
      : null

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

      await upsertClassifications(entries, meta, existingIdMap)
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
      selection,
    }, { headers: CORS_HEADERS })
  } catch (err) {
    console.error('[pubmed] reclassify failed', err)
    return NextResponse.json({ ok: false, error: err?.message || 'Reclassify failed' }, { status: 500, headers: CORS_HEADERS })
  }
}

export const revalidate = 0
export const dynamic = 'force-dynamic'
