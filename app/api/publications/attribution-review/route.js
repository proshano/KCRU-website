import { NextResponse } from 'next/server'

import { getScopedAdminSession } from '@/lib/adminSessions'
import { getSessionAccess } from '@/lib/authAccess'
import { buildCorsHeaders, extractBearerToken } from '@/lib/httpUtils'
import {
  buildAttributionSiteContext,
  canManagePublicationAttributionReviews,
  decidePublicationAttributionReview,
  fetchPublicationAttributionReviews,
  resolveApprovedAttributionSiteStatus,
} from '@/lib/publicationAttributionReview'
import { mergeWithClassifications } from '@/lib/publications'
import { readCache } from '@/lib/pubmedCache'
import { sanityFetch, writeClient } from '@/lib/sanity'
import { sanitizeString } from '@/lib/studySubmissions'

const CORS_HEADERS = buildCorsHeaders('GET, PATCH, OPTIONS')

// The public publication list as /publications reads it, so each approved card can say
// whether its paper is on the site. Null when the cache cannot be read; the reviews still load.
async function loadPublicSiteContext() {
  try {
    const cache = await readCache()
    if (!cache) return null
    return buildAttributionSiteContext({
      publications: await mergeWithClassifications(cache.publications || []),
      provenance: cache.provenance || {},
      refreshedAt: cache.generatedAt || null,
    })
  } catch (error) {
    console.error('[publication-attribution-review] Could not read the public publication cache', error)
    return null
  }
}

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
    const [reviews, siteContext] = await Promise.all([
      fetchPublicationAttributionReviews(fetchClient),
      loadPublicSiteContext(),
    ])
    const pending = reviews
      .filter((review) => review.status === 'pending')
      .sort((left, right) => String(right.firstSeenAt || '').localeCompare(String(left.firstSeenAt || '')))
    const decisions = reviews
      .filter((review) => review.status !== 'pending')
      .sort((left, right) => String(right.reviewedAt || '').localeCompare(String(left.reviewedAt || '')))
      .map((review) => ({ ...review, siteStatus: resolveApprovedAttributionSiteStatus(review, siteContext) }))

    return NextResponse.json({
      ok: true,
      adminEmail: session.email,
      pending,
      decisions,
      publicSite: siteContext
        ? { checked: true, refreshedAt: siteContext.refreshedAt || null }
        : { checked: false, refreshedAt: null },
      counts: {
        pending: pending.length,
        approved: decisions.filter((review) => review.status === 'approved').length,
        rejected: decisions.filter((review) => review.status === 'rejected').length,
        // Still off the site after a refresh, as opposed to approved since the last one.
        approvedNotOnSite: decisions.filter((review) => review.siteStatus && !['public', 'awaiting-refresh'].includes(review.siteStatus.state)).length,
        approvedAwaitingRefresh: decisions.filter((review) => review.siteStatus?.state === 'awaiting-refresh').length,
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
