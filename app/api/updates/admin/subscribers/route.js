import { NextResponse } from 'next/server'
import { sanityFetch, writeClient } from '@/lib/sanity'
import { getScopedAdminSession } from '@/lib/adminSessions'
import { getSessionAccess, hasRequiredAccess } from '@/lib/authAccess'
import { buildCorsHeaders, extractBearerToken } from '@/lib/httpUtils'

const CORS_HEADERS = buildCorsHeaders('GET, OPTIONS')

async function getSession(request) {
  const sessionAccess = await getSessionAccess()
  if (sessionAccess) {
    if (hasRequiredAccess(sessionAccess.access, { updates: true })) {
      return { session: { email: sessionAccess.email }, status: 200 }
    }
    return { session: null, error: 'Not authorized for study updates.', status: 403 }
  }

  const token = extractBearerToken(request)
  return getScopedAdminSession(token, { scope: 'updates' })
}

function clampNumber(value, fallback, min, max) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(Math.max(parsed, min), max)
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS })
}

export async function GET(request) {
  const { session, error, status } = await getSession(request)
  if (!session) {
    return NextResponse.json({ ok: false, error }, { status, headers: CORS_HEADERS })
  }

  const { searchParams } = new URL(request.url)
  const limit = clampNumber(searchParams.get('limit'), 200, 25, 1000)
  const offset = clampNumber(searchParams.get('offset'), 0, 0, 100000)

  try {
    const fetcher = writeClient.config().token
      ? (query, params) => writeClient.fetch(query, params)
      : sanityFetch

    const data = await fetcher(
      `{
        "total": count(*[_type == "updateSubscriber"]),
        "items": *[_type == "updateSubscriber"]
          | order(updatedAt desc, createdAt desc)
          [$offset...$end]{
            _id,
            name,
            email,
            role,
            specialty,
            correspondencePreferences,
            subscriptionStatus,
            deliveryStatus,
            allTherapeuticAreas,
            interestAreas[]->{ _id, name, shortLabel },
            createdAt,
            updatedAt,
            lastStudyUpdateSentAt,
            lastPublicationNewsletterSentAt,
            lastNewsletterSentAt
          }
      }`,
      { offset, end: offset + limit }
    )

    return NextResponse.json(
      {
        ok: true,
        total: data?.total || 0,
        offset,
        limit,
        items: data?.items || [],
      },
      { headers: CORS_HEADERS }
    )
  } catch (err) {
    console.error('[updates-admin-subscribers] GET failed', err)
    return NextResponse.json(
      { ok: false, error: err?.message || 'Failed to load subscribers.' },
      { status: 500, headers: CORS_HEADERS }
    )
  }
}

export const dynamic = 'force-dynamic'
