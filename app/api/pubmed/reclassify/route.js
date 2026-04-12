import { NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { runPubmedReclassification } from '@/lib/pubmedReclassification'
import { buildCorsHeaders, extractBearerToken } from '@/lib/httpUtils'

const AUTH_TOKEN = process.env.PUBMED_PREVIEW_TOKEN || process.env.PUBMED_REFRESH_TOKEN

const CORS_HEADERS = buildCorsHeaders('POST, OPTIONS')

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS })
}

export async function POST(request) {
  if (!AUTH_TOKEN) {
    return NextResponse.json(
      { ok: false, error: 'PUBMED_PREVIEW_TOKEN or PUBMED_REFRESH_TOKEN not configured' },
      { status: 500, headers: CORS_HEADERS }
    )
  }

  const token = extractBearerToken(request)
  if (token !== AUTH_TOKEN) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401, headers: CORS_HEADERS })
  }

  try {
    const body = await request.json()
    const result = await runPubmedReclassification(body || {})

    try {
      if (!result?.dryRun && Number(result?.count || 0) > 0) {
        revalidatePath('/publications')
        revalidatePath('/publications.md')
        revalidatePath('/team', 'layout')
      }
    } catch (revalErr) {
      console.warn('[pubmed] reclassify revalidation warning', revalErr)
    }

    return NextResponse.json({ ok: true, ...result }, { headers: CORS_HEADERS })
  } catch (err) {
    console.error('[pubmed] reclassify failed', err)
    return NextResponse.json({ ok: false, error: err?.message || 'Reclassify failed' }, { status: 500, headers: CORS_HEADERS })
  }
}

export const revalidate = 0
export const dynamic = 'force-dynamic'
