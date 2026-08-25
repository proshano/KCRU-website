import { NextResponse } from 'next/server'
import fs from 'fs/promises'
import { writeClient } from '@/lib/sanity'
import { getPublicationKey, toSanityPublicationKey, withPublicationKey } from '@/lib/publicationIdentity'
import { buildCorsHeaders, extractBearerToken } from '@/lib/httpUtils'
import { CACHE_PATH } from '@/lib/pubmedCache'

const AUTH_TOKEN = process.env.PUBMED_REFRESH_TOKEN
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
    const publications = (localCache.publications || []).map((pub, idx) => {
      const normalized = withPublicationKey(pub)
      return {
        _key: toSanityPublicationKey(normalized, `pub-${idx}`),
        publicationKey: normalized.publicationKey,
        pmid: normalized.pmid || null,
        title: normalized.title,
        publishedAt: normalized.publishedAt || null,
        authors: normalized.authors || [],
        attributionAuthors: (normalized.attributionAuthors || []).map((author, authorIndex) => ({
          _key: `author-${authorIndex}`,
          ...author,
          affiliations: Array.from(new Set(author?.affiliations || [])),
        })),
        attributionQueryPaths: normalized.attributionQueryPaths || [],
        journal: normalized.journal,
        year: normalized.year,
        month: normalized.month,
        abstract: normalized.abstract,
        abstractContentType: normalized.abstractContentType || null,
        abstractSource: normalized.abstractSource || null,
        doi: normalized.doi,
        source: normalized.source || null,
        sources: normalized.sources || [],
        openAlexId: normalized.openAlexId || null,
        europePmcId: normalized.europePmcId || null,
        url: normalized.url || normalized.pubmedUrl || null,
        pubmedUrl: normalized.pubmedUrl || (normalized.source === 'pubmed' && normalized.pmid ? normalized.url : null) || null,
        laySummary: normalized.laySummary || null,
      }
    })

    const publicationsByKey = new Map((localCache.publications || []).map((pub) => [getPublicationKey(pub), pub]))
    const provenanceArray = Object.entries(localCache.provenance || {}).map(([publicationKey, ids]) => ({
      _key: toSanityPublicationKey({ publicationKey }),
      publicationKey,
      pmid: publicationsByKey.get(publicationKey)?.pmid || null,
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
