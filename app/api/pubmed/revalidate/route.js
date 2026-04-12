import { NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { buildCorsHeaders, extractBearerToken } from '@/lib/httpUtils'
import { isCronAuthorized } from '@/lib/cronUtils'

const AUTH_TOKEN = process.env.PUBMED_REFRESH_TOKEN
const CRON_SECRET = process.env.CRON_SECRET || ''
const CORS_HEADERS = buildCorsHeaders('POST, OPTIONS')

const REVALIDATE_TARGETS = [
  { path: '/', type: 'page' },
  { path: '/publications', type: 'page' },
  { path: '/publications.md', type: 'page' },
  { path: '/team', type: 'layout' },
]

function isAuthorized(request) {
  if (CRON_SECRET && isCronAuthorized(request, CRON_SECRET)) {
    return true
  }
  if (!AUTH_TOKEN) return false
  return extractBearerToken(request) === AUTH_TOKEN
}

function getAuthConfigError() {
  if (!CRON_SECRET && !AUTH_TOKEN) {
    return 'CRON_SECRET or PUBMED_REFRESH_TOKEN not configured'
  }
  return null
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS })
}

export async function POST(request) {
  const authConfigError = getAuthConfigError()
  if (authConfigError) {
    return NextResponse.json({ ok: false, error: authConfigError }, { status: 500, headers: CORS_HEADERS })
  }

  if (!isAuthorized(request)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401, headers: CORS_HEADERS })
  }

  try {
    for (const target of REVALIDATE_TARGETS) {
      revalidatePath(target.path, target.type)
    }

    return NextResponse.json({
      ok: true,
      revalidated: REVALIDATE_TARGETS.map(({ path, type }) => ({ path, type })),
    }, { headers: CORS_HEADERS })
  } catch (error) {
    console.error('[pubmed] revalidate endpoint failed', error)
    return NextResponse.json(
      { ok: false, error: error?.message || 'Revalidation failed' },
      { status: 500, headers: CORS_HEADERS }
    )
  }
}

export const revalidate = 0
export const dynamic = 'force-dynamic'
