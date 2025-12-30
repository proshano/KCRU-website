import { NextResponse } from 'next/server'
import { readCache } from '@/lib/pubmedCache'
import { buildCorsHeaders, extractBearerToken } from '@/lib/httpUtils'

const AUTH_TOKEN = process.env.PUBMED_REFRESH_TOKEN || ''

const CORS_HEADERS = buildCorsHeaders('GET, OPTIONS')

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS })
}

export async function GET(request) {
  if (AUTH_TOKEN) {
    const token = extractBearerToken(request)
    if (token !== AUTH_TOKEN) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401, headers: CORS_HEADERS })
    }
  }

  try {
    const cache = await readCache()
    if (!cache) {
      return NextResponse.json(
        { ok: false, error: 'No cache found in Sanity' },
        { status: 404, headers: CORS_HEADERS }
      )
    }

    const payload = {
      key: cache.key || null,
      generatedAt: cache.generatedAt || null,
      publications: cache.publications || [],
      provenance: cache.provenance || {},
      meta: cache.meta || {},
    }

    const body = JSON.stringify(payload, null, 2)

    return new NextResponse(body, {
      status: 200,
      headers: {
        ...CORS_HEADERS,
        'Content-Type': 'application/json',
        'Content-Disposition': 'attachment; filename="pubmed-cache.json"',
      },
    })
  } catch (err) {
    console.error('[pubmed] download endpoint failed', err)
    return NextResponse.json(
      { ok: false, error: err?.message || 'Download failed' },
      { status: 500, headers: CORS_HEADERS }
    )
  }
}

export const revalidate = 0
export const dynamic = 'force-dynamic'
