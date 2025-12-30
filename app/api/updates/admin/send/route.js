import { NextResponse } from 'next/server'
import { sanityFetch } from '@/lib/sanity'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

const SITE_BASE_URL = (process.env.SITE_URL || process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000').replace(
  /\/$/,
  ''
)
const DISPATCH_URL = `${SITE_BASE_URL}/api/updates/study-email/dispatch`

function extractToken(request) {
  const header = request.headers.get('authorization') || ''
  if (!header) return ''
  if (header.startsWith('Bearer ')) return header.slice(7)
  return header
}

async function getSession(token) {
  if (!token) return null
  const session = await sanityFetch(
    `*[_type == "studyUpdateAdminSession" && token == $token][0]{ _id, email, expiresAt, revoked }`,
    { token }
  )
  if (!session || session.revoked) return null
  if (session.expiresAt && Date.parse(session.expiresAt) < Date.now()) return null
  return session
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS })
}

export async function POST(request) {
  const token = extractToken(request)
  const session = await getSession(token)
  if (!session) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401, headers: CORS_HEADERS })
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
