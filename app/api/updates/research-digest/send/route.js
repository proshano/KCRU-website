import { NextResponse } from 'next/server'
import { getScopedAdminSession } from '@/lib/adminSessions'
import { getSessionAccess, hasRequiredAccess } from '@/lib/authAccess'
import { buildCorsHeaders, extractBearerToken } from '@/lib/httpUtils'

const CORS_HEADERS = buildCorsHeaders('POST, OPTIONS')
const SITE_BASE_URL = (process.env.SITE_URL || process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000').replace(
  /\/$/,
  ''
)
const DISPATCH_URL = `${SITE_BASE_URL}/api/updates/research-digest/dispatch`

async function getSession(request) {
  const sessionAccess = await getSessionAccess()
  if (sessionAccess) {
    if (hasRequiredAccess(sessionAccess.access, { updates: true })) {
      return { session: { email: sessionAccess.email }, status: 200 }
    }
    return { session: null, error: 'Not authorized for research digest updates.', status: 403 }
  }

  const token = extractBearerToken(request)
  return getScopedAdminSession(token, { scope: 'updates' })
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS })
}

export async function POST(request) {
  const { session, error, status } = await getSession(request)
  if (!session) {
    return NextResponse.json({ ok: false, error }, { status, headers: CORS_HEADERS })
  }

  if (!process.env.RESEARCH_DIGEST_SEND_TOKEN) {
    return NextResponse.json(
      { ok: false, error: 'RESEARCH_DIGEST_SEND_TOKEN missing; cannot send research digest.' },
      { status: 500, headers: CORS_HEADERS }
    )
  }

  const body = await request.json().catch(() => ({}))

  try {
    const res = await fetch(DISPATCH_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.RESEARCH_DIGEST_SEND_TOKEN}`,
      },
      body: JSON.stringify({
        force: Boolean(body?.force),
        issueDate: body?.issueDate,
      }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      return NextResponse.json(
        { ok: false, error: data?.error || `Dispatch failed (${res.status})` },
        { status: res.status, headers: CORS_HEADERS }
      )
    }
    return NextResponse.json({ ok: true, ...data }, { headers: CORS_HEADERS })
  } catch (err) {
    console.error('[research-digest-send] failed', err)
    return NextResponse.json(
      { ok: false, error: err?.message || 'Failed to send research digest.' },
      { status: 500, headers: CORS_HEADERS }
    )
  }
}

export const dynamic = 'force-dynamic'
