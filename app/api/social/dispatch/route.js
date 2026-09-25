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

// Daily step after the PubMed refresh: turn new feed papers into pending X
// posts and email approvers. Nothing is sent to Buffer here; that happens only
// when an admin approves a post at /admin/social.
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
        reason: 'Posting to X is switched off in Site Settings (Social Media Posting).',
      })
    }

    const { records: expectedRecords, ...sync } = await syncSocialPosts({
      client: writeClient,
      writeClient,
      settings,
      seed,
      dryRun,
    })
    if (sync.mode === 'abort') {
      console.error('[social-posting] sync aborted', sync.reason)
      return NextResponse.json({ ok: false, error: sync.reason, dryRun, sync }, { status: 500 })
    }

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
