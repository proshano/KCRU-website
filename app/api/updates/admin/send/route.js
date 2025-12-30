import { NextResponse } from 'next/server'
import { getScopedAdminSession } from '@/lib/adminSessions'
import { buildCorsHeaders, extractBearerToken } from '@/lib/httpUtils'

const CORS_HEADERS = buildCorsHeaders('POST, OPTIONS')

const SITE_BASE_URL = (process.env.SITE_URL || process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000').replace(
  /\/$/,
  ''
)
const DISPATCH_URL = `${SITE_BASE_URL}/api/updates/study-email/dispatch`

async function getSession(token) {
  return getScopedAdminSession(token, { scope: 'updates' })
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS })
}

export async function POST(request) {
  const token = extractBearerToken(request)
  const { session, error, status } = await getSession(token)
  if (!session) {
    return NextResponse.json({ ok: false, error }, { status, headers: CORS_HEADERS })
  }

  if (!process.env.STUDY_UPDATE_SEND_TOKEN) {
    return NextResponse.json(
      { ok: false, error: 'STUDY_UPDATE_SEND_TOKEN missing; cannot send updates.' },
      { status: 500, headers: CORS_HEADERS }
    )
  }

  let body = {}
  try {
    body = await request.json()
  } catch (error) {
    body = {}
  }

  const force = Boolean(body?.force)

  try {
    const res = await fetch(DISPATCH_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.STUDY_UPDATE_SEND_TOKEN}`,
      },
      body: JSON.stringify({ force, trigger: 'admin' }),
    })

    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      return NextResponse.json(
        { ok: false, error: data?.error || `Dispatch failed (${res.status})` },
        { status: res.status, headers: CORS_HEADERS }
      )
    }

    return NextResponse.json({ ok: true, ...data }, { headers: CORS_HEADERS })
  } catch (error) {
    console.error('[updates-admin-send] failed', error)
    return NextResponse.json(
      { ok: false, error: error?.message || 'Failed to send study updates.' },
      { status: 500, headers: CORS_HEADERS }
    )
  }
}

export const dynamic = 'force-dynamic'
