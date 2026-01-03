import { NextResponse } from 'next/server'
import fs from 'fs/promises'
import path from 'path'
import { writeClient } from '@/lib/sanity'
import { buildCorsHeaders, extractBearerToken } from '@/lib/httpUtils'

const AUTH_TOKEN = process.env.PUBMED_REFRESH_TOKEN
const CACHE_PATH = path.join(process.cwd(), 'runtime', 'pubmed-cache.json')
const CACHE_DOC_ID = 'pubmedCache'
const CACHE_DOC_TYPE = 'pubmedCache'

const CORS_HEADERS = buildCorsHeaders('POST, OPTIONS')

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS })
}

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

  try {
    let forceUpload = false
    try {
      const body = await request.json()
      forceUpload = body?.force === true || body?.force === 'true'
    } catch {
      forceUpload = false
    }

    // Read local cache file
    let localCache
    try {
      const raw = await fs.readFile(CACHE_PATH, 'utf8')
      localCache = JSON.parse(raw)
    } catch (err) {
      return NextResponse.json({ 
        ok: false, 
        error: 'No local cache found. Run "Refresh Cache" first to generate it.' 
      }, { status: 404, headers: CORS_HEADERS })
    }

    const localGeneratedAt = localCache.generatedAt || localCache.meta?.generatedAt || null
    let sanityLastRefreshedAt = null
    try {
      const sanityStatus = await writeClient.fetch(
        `*[_type == $type && _id == $id][0]{ lastRefreshedAt }`,
        { type: CACHE_DOC_TYPE, id: CACHE_DOC_ID }
      )
      sanityLastRefreshedAt = sanityStatus?.lastRefreshedAt || null
    } catch (err) {
      console.warn('[pubmed] upload precheck failed (sanity status)', err)
    }

    if (!forceUpload && localGeneratedAt && sanityLastRefreshedAt) {
      const localTs = Date.parse(localGeneratedAt)
      const sanityTs = Date.parse(sanityLastRefreshedAt)
      if (Number.isFinite(localTs) && Number.isFinite(sanityTs) && localTs < sanityTs) {
        return NextResponse.json({
          ok: false,
          error: 'Local cache is older than Sanity. Re-upload aborted.',
          code: 'LOCAL_CACHE_OLDER',
          details: {
            localGeneratedAt,
            sanityLastRefreshedAt,
          },
        }, { status: 409, headers: CORS_HEADERS })
      }
    }

    // Convert to Sanity format
    const publications = (localCache.publications || []).map((pub, idx) => ({
      _key: pub.pmid || `pub-${idx}`,
      pmid: pub.pmid,
      title: pub.title,
      publishedAt: pub.publishedAt || null,
      authors: pub.authors || [],
      journal: pub.journal,
      year: pub.year,
      month: pub.month,
      abstract: pub.abstract,
      doi: pub.doi,
      pubmedUrl: pub.pubmedUrl || pub.url || null,
      laySummary: pub.laySummary || null,
    }))

    const provenanceArray = Object.entries(localCache.provenance || {}).map(([pmid, ids]) => ({
      _key: pmid,
      pmid,
      researcherIds: Array.isArray(ids) ? ids : Array.from(ids || []),
    }))

    const totalWithSummary = publications.filter(p => p.laySummary).length

    const doc = {
      _id: CACHE_DOC_ID,
      _type: CACHE_DOC_TYPE,
      cacheKey: localCache.key,
      lastRefreshedAt: localCache.generatedAt || new Date().toISOString(),
      refreshInProgress: false,
      refreshStartedAt: null,
      publications,
      provenance: provenanceArray,
      stats: {
        totalPublications: publications.length,
        totalWithSummary,
        lastSummaryModel: localCache.meta?.summaries?.model || null,
      },
    }

    await writeClient.createOrReplace(doc)

    return NextResponse.json({
      ok: true,
      message: 'Cache uploaded to Sanity',
      stats: {
        publications: publications.length,
        withSummary: totalWithSummary,
      },
    }, { headers: CORS_HEADERS })
  } catch (err) {
    console.error('[pubmed] upload endpoint failed', err)
    return NextResponse.json({ ok: false, error: err?.message || 'Upload failed' }, { status: 500, headers: CORS_HEADERS })
  }
}

export const revalidate = 0
export const dynamic = 'force-dynamic'
