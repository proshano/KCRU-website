import { NextResponse } from 'next/server'

import { isCronAuthorized } from '@/lib/cronUtils'
import { sendEmail } from '@/lib/email'
import { writeClient } from '@/lib/sanity'
import { SOCIAL_NETWORK_X } from '@/lib/socialPosting'
import { dispatchSocialPostNotifications } from '@/lib/socialPostingServer'
import {
  createSanitySocialPostStore,
  fetchSocialPostRecords,
  fetchSocialPostingSettings,
  syncSocialPosts,
} from '@/lib/socialPostingStore'

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

// Daily step after the PubMed refresh: offer each new feed paper as an
// `available` record (no post text) and email approvers once about the new
// ones. Nothing is drafted or sent to Buffer here; an approver creates, edits
// and queues posts at /admin/social.
export async function POST(request) {
  if (!CRON_SECRET) {
    return NextResponse.json({ ok: false, error: 'CRON_SECRET not configured' }, { status: 500 })
  }
  if (!isCronAuthorized(request, CRON_SECRET)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }

  const body = await readOptionalJson(request)
  const dryRun = isDryRunRequest(request, body)
  const seed = body?.seed === true
  if (!dryRun && !writeClient.config().token) {
    return NextResponse.json(
      { ok: false, error: 'SANITY_API_TOKEN missing; cannot record social media posts.' },
      { status: 500 }
    )
  }
  try {
    const settings = await fetchSocialPostingSettings(writeClient)
    if (settings.postToX !== true) {
      return NextResponse.json({
        ok: true,
        skipped: true,
        dryRun,
        reason: 'Offering new publications for X posts is switched off in Site Settings (Social Media Posting).',
      })
    }

    const { records: expectedRecords, ...sync } = await syncSocialPosts({
      client: writeClient,
      writeClient,
      seed,
      dryRun,
    })

    const store = createSanitySocialPostStore(writeClient)
    const records = dryRun ? expectedRecords : await fetchSocialPostRecords(writeClient, SOCIAL_NETWORK_X)
    const notifications = await dispatchSocialPostNotifications({
      records,
      recipients: settings.recipients,
      portalUrl: `${SITE_BASE_URL}/admin/social`,
      send: sendEmail,
      markNotified: (posts, now) => store.markNotified(posts, now),
      dryRun,
    })
    return NextResponse.json({ ok: true, dryRun, sync, notifications })
  } catch (error) {
    console.error('[social-posting] dispatch failed', error)
    return NextResponse.json(
      { ok: false, error: error?.message || 'Social media post dispatch failed.' },
      { status: 500 }
    )
  }
}

export const dynamic = 'force-dynamic'
