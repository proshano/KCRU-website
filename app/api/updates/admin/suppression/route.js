import { NextResponse } from 'next/server'
import { writeClient } from '@/lib/sanity'
import { getScopedAdminSession } from '@/lib/adminSessions'
import { buildCorsHeaders, extractBearerToken } from '@/lib/httpUtils'
import { normalizeTestEmailList } from '@/lib/updateEmailTesting'

const CORS_HEADERS = buildCorsHeaders('POST, OPTIONS')

async function getSession(token) {
  return getScopedAdminSession(token, { scope: 'updates' })
}

function normalizeAction(value) {
  return String(value || '').trim().toLowerCase()
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

  if (!writeClient.config().token) {
    return NextResponse.json(
      { ok: false, error: 'SANITY_API_TOKEN missing; cannot update subscribers.' },
      { status: 500, headers: CORS_HEADERS }
    )
  }

  let body = {}
  try {
    body = await request.json()
  } catch (err) {
    body = {}
  }

  const action = normalizeAction(body?.action)
  const now = new Date().toISOString()

  try {
    if (action === 'suppress_all') {
      await writeClient.mutate([
        {
          patch: {
            query: '*[_type == "updateSubscriber"]',
            set: { suppressEmails: true, updatedAt: now },
          },
        },
      ])
      return NextResponse.json({ ok: true, action }, { headers: CORS_HEADERS })
    }

    if (action === 'unsuppress_all') {
      await writeClient.mutate([
        {
          patch: {
            query: '*[_type == "updateSubscriber"]',
            set: { suppressEmails: false, updatedAt: now },
          },
        },
      ])
      return NextResponse.json({ ok: true, action }, { headers: CORS_HEADERS })
    }

    if (action === 'unsuppress_emails') {
      const emails = normalizeTestEmailList(body?.emails)
      if (!emails.length) {
        return NextResponse.json(
          { ok: false, error: 'Provide at least one valid email.' },
          { status: 400, headers: CORS_HEADERS }
        )
      }
      await writeClient.mutate([
        {
          patch: {
            query: '*[_type == "updateSubscriber" && lower(email) in $emails]',
            params: { emails },
            set: { suppressEmails: false, updatedAt: now },
          },
        },
      ])
      return NextResponse.json(
        { ok: true, action, emails, count: emails.length },
        { headers: CORS_HEADERS }
      )
    }

    return NextResponse.json(
      { ok: false, error: 'Unsupported action.' },
      { status: 400, headers: CORS_HEADERS }
    )
  } catch (err) {
    console.error('[updates-admin-suppression] failed', err)
    return NextResponse.json(
      { ok: false, error: err?.message || 'Failed to update subscribers.' },
      { status: 500, headers: CORS_HEADERS }
    )
  }
}

export const dynamic = 'force-dynamic'
