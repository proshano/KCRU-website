import { NextResponse } from 'next/server'

import { getScopedAdminSession } from '@/lib/adminSessions'
import { getSessionAccess } from '@/lib/authAccess'
import { buildCorsHeaders, extractBearerToken } from '@/lib/httpUtils'
import {
  canManagePublicationAttributionReviews,
  decidePublicationAttributionReview,
  fetchPublicationAttributionReviews,
} from '@/lib/publicationAttributionReview'
import { sanityFetch, writeClient } from '@/lib/sanity'
import { sanitizeString } from '@/lib/studySubmissions'

const CORS_HEADERS = buildCorsHeaders('GET, PATCH, OPTIONS')

async function getReviewSession(request) {
  const sessionAccess = await getSessionAccess()
  if (sessionAccess) {
    if (canManagePublicationAttributionReviews(sessionAccess.access)) {
      return { session: { email: sessionAccess.email }, status: 200 }
    }
    return { session: null, error: 'Not authorized for publication attribution review.', status: 403 }
  }

  const token = extractBearerToken(request)
  return getScopedAdminSession(token, { scope: 'approvals' })
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS })
}

export async function GET(request) {
  const { session, error, status } = await getReviewSession(request)
  if (!session) {
    return NextResponse.json({ ok: false, error }, { status, headers: CORS_HEADERS })
  }

  try {
    const fetchClient = writeClient.config().token ? writeClient : { fetch: sanityFetch }
    const reviews = await fetchPublicationAttributionReviews(fetchClient)
    const pending = reviews
      .filter((review) => review.status === 'pending')
      .sort((left, right) => String(right.firstSeenAt || '').localeCompare(String(left.firstSeenAt || '')))
    const decisions = reviews
      .filter((review) => review.status !== 'pending')
      .sort((left, right) => String(right.reviewedAt || '').localeCompare(String(left.reviewedAt || '')))

    return NextResponse.json({
      ok: true,
      adminEmail: session.email,
      pending,
      decisions,
      counts: {
        pending: pending.length,
        approved: decisions.filter((review) => review.status === 'approved').length,
        rejected: decisions.filter((review) => review.status === 'rejected').length,
      },
    }, { headers: CORS_HEADERS })
  } catch (requestError) {
    console.error('[publication-attribution-review] GET failed', requestError)
    return NextResponse.json(
      { ok: false, error: requestError?.message || 'Failed to load publication attribution reviews.' },
      { status: 500, headers: CORS_HEADERS }
    )
  }
}

export async function PATCH(request) {
  const { session, error, status } = await getReviewSession(request)
  if (!session) {
    return NextResponse.json({ ok: false, error }, { status, headers: CORS_HEADERS })
  }

  try {
    const body = await request.json()
    const reviewId = sanitizeString(body?.reviewId)
    const decision = sanitizeString(body?.decision).toLowerCase()
    if (!reviewId) {
      return NextResponse.json(
        { ok: false, error: 'Review candidate id is required.' },
        { status: 400, headers: CORS_HEADERS }
      )
    }

    const result = await decidePublicationAttributionReview({
      writeClient,
      reviewId,
      decision,
      reviewerEmail: session.email,
    })
    if (!result.ok) {
      return NextResponse.json(result, { status: result.status || 400, headers: CORS_HEADERS })
    }
    return NextResponse.json(result, { headers: CORS_HEADERS })
  } catch (requestError) {
    console.error('[publication-attribution-review] PATCH failed', requestError)
    return NextResponse.json(
      { ok: false, error: requestError?.message || 'Failed to save the attribution decision.' },
      { status: 500, headers: CORS_HEADERS }
    )
  }
}

export const dynamic = 'force-dynamic'
