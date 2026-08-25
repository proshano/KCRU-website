import { NextResponse } from 'next/server'

import { isCronAuthorized } from '@/lib/cronUtils'
import { sendEmail } from '@/lib/email'
import {
  dispatchPublicationAttributionNotifications,
} from '@/lib/publicationAttributionNotifications'
import { fetchPublicationAttributionReviews } from '@/lib/publicationAttributionReview'
import { writeClient } from '@/lib/sanity'

const CRON_SECRET = process.env.CRON_SECRET || ''
const SITE_BASE_URL = (process.env.SITE_URL || process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000').replace(/\/$/, '')

function isDryRunRequest(request, body = {}) {
  const url = new URL(request.url)
  return url.searchParams.get('dryRun') === 'true' || body?.dryRun === true
}

async function readOptionalJson(request) {
  const text = await request.text()
  if (!text.trim()) return {}
  try {
    return JSON.parse(text)
  } catch {
    return {}
  }
}

async function markNotified(reviews, now) {
  const notifiedAt = now instanceof Date ? now.toISOString() : new Date(now).toISOString()
  const transaction = writeClient.transaction()
  for (const review of reviews) {
    transaction.patch(review._id, (patch) => patch.set({
      lastNotifiedAt: notifiedAt,
      notificationCount: (Number(review.notificationCount) || 0) + 1,
    }))
  }
  await transaction.commit()
}

export async function POST(request) {
  if (!CRON_SECRET) {
    return NextResponse.json({ ok: false, error: 'CRON_SECRET not configured' }, { status: 500 })
  }
  if (!isCronAuthorized(request, CRON_SECRET)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }

  const body = await readOptionalJson(request)
  const dryRun = isDryRunRequest(request, body)
  if (!dryRun && !writeClient.config().token) {
    return NextResponse.json(
      { ok: false, error: 'SANITY_API_TOKEN missing; cannot update notification tracking.' },
      { status: 500 }
    )
  }
  try {
    const settings = await writeClient.fetch(`
      *[_type == "siteSettings"][0] {
        "enabled": publicationAttributionReview.enabled,
        "recipients": studyApprovals.admins
      }
    `)
    if (settings?.enabled !== true) {
      return NextResponse.json({
        ok: true,
        skipped: true,
        dryRun,
        reason: 'Publication attribution review is disabled.',
      })
    }

    const reviews = await fetchPublicationAttributionReviews(writeClient)
    const result = await dispatchPublicationAttributionNotifications({
      reviews,
      recipients: settings.recipients,
      portalUrl: `${SITE_BASE_URL}/admin/publications`,
      send: sendEmail,
      markNotified,
      dryRun,
    })
    return NextResponse.json(result)
  } catch (error) {
    console.error('[publication-attribution-review] notification dispatch failed', error)
    return NextResponse.json(
      { ok: false, error: error?.message || 'Publication attribution notification dispatch failed.' },
      { status: 500 }
    )
  }
}

export const dynamic = 'force-dynamic'
