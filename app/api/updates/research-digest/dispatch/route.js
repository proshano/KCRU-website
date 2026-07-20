import { createHash } from 'node:crypto'

import { NextResponse } from 'next/server'
import { isCronAuthorized } from '@/lib/cronUtils'
import { sendEmail } from '@/lib/email'
import { extractBearerToken } from '@/lib/httpUtils'
import { buildResearchDigestEmail } from '@/lib/researchDigestEmailTemplate'
import {
  fetchResearchDigestSettings,
  formatResearchDigestDate,
  isWeekdayInTimeZone,
} from '@/lib/researchDigest'
import {
  RESEARCH_DIGEST_ISSUE_STATUS,
  RESEARCH_DIGEST_PREF,
  RESEARCH_DIGEST_TIMEZONE,
} from '@/lib/researchDigestConfig'
import { writeClient } from '@/lib/sanity'
import { filterSubscribersByTestEmails, normalizeUpdateEmailTesting } from '@/lib/updateEmailTesting'
import { isSubscriberDeliverable } from '@/lib/updateSubscriberStatus'

const SITE_BASE_URL = (process.env.SITE_URL || process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000').replace(
  /\/$/,
  ''
)
const AUTH_TOKEN = process.env.RESEARCH_DIGEST_SEND_TOKEN
const CRON_SECRET = process.env.CRON_SECRET || ''

function normalizeDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) ? String(value) : formatResearchDigestDate()
}

async function fetchIssueBundle({ issueDate, maxPapers, maxOpportunities, automaticSelection }) {
  const today = formatResearchDigestDate()
  const query = `{
    "issue": *[_type == "researchDigestIssue" && date == $issueDate][0]{
      _id,
      title,
      date,
      "slug": slug.current,
      status,
      intro,
      approvedAt,
      sentAt
    },
    "papers": *[_type == "researchDigestPaper" && issueDate == $issueDate && approvalStatus == "approved" && autoSelectionExcluded != true && ($automaticSelection == false || autoSelected == true)] | order(priorityScore desc, tier asc, journal asc, title asc)[0...$maxPapers]{
      _id,
      pmid,
      doi,
      title,
      authors,
      journal,
      pubDate,
      year,
      url,
      matchedJournalGroups,
      tier,
      priorityScore,
      whyItMatters,
      summary,
      topics
    },
    "opportunities": *[_type == "researchOpportunity" && $automaticSelection == false && approvalStatus == "approved" && status in ["open", "upcoming"] && (!defined(deadline) || deadline >= $today)] | order(deadline asc, title asc)[0...$maxOpportunities]{
      _id,
      type,
      status,
      sourceName,
      title,
      description,
      deadline,
      eligibility,
      url,
      topics
    }
  }`
  return writeClient.fetch(query, {
    issueDate,
    today,
    maxPapers,
    maxOpportunities,
    automaticSelection,
  })
}

async function fetchSubscribers({ issueDate, force }) {
  const sentFilter = force ? '' : ' && (!defined(lastResearchDigestSentAt) || lastResearchDigestSentAt < $issueDateStart)'
  const query = `
    *[_type == "updateSubscriber"
      && subscriptionStatus == "subscribed"
      && deliveryStatus != "suppressed"
      && "${RESEARCH_DIGEST_PREF}" in correspondencePreferences
      && defined(email)
      ${sentFilter}
    ]{
      _id,
      name,
      email,
      subscriptionStatus,
      deliveryStatus,
      manageToken,
      lastResearchDigestSentAt
    }
  `
  return writeClient.fetch(query, { issueDateStart: `${issueDate}T00:00:00.000Z` })
}

async function fetchPilotRecipients(recipients = []) {
  const emails = Array.from(new Set(recipients.map((email) => String(email || '').toLowerCase()).filter(Boolean)))
  if (!emails.length) return []

  const existing = await writeClient.fetch(
    `*[_type == "updateSubscriber" && lower(email) in $emails]{
      _id,
      name,
      email,
      subscriptionStatus,
      deliveryStatus,
      manageToken,
      lastResearchDigestSentAt
    }`,
    { emails }
  )
  const byEmail = new Map((existing || []).map((subscriber) => [String(subscriber.email || '').toLowerCase(), subscriber]))
  return emails.map((email) => byEmail.get(email) || {
    name: '',
    email,
    subscriptionStatus: 'subscribed',
    deliveryStatus: 'active',
    manageToken: null,
    pilotOnly: true,
  })
}

function buildIdempotencyKey(issueId, subscriber) {
  const recipientKey = subscriber?._id || createHash('sha256')
    .update(String(subscriber?.email || '').trim().toLowerCase())
    .digest('hex')
    .slice(0, 32)
  return `research-digest:${issueId}:${recipientKey}`
}

async function runDispatch({ force = false, issueDate, settingsPayload } = {}) {
  if (!writeClient.config().token) {
    return { ok: false, status: 500, error: 'SANITY_API_TOKEN missing; cannot update send tracking.' }
  }

  const resolvedSettingsPayload = settingsPayload || await fetchResearchDigestSettings()
  const settings = resolvedSettingsPayload.settings || {}
  const testSettings = normalizeUpdateEmailTesting(resolvedSettingsPayload.testing)
  const selectedDate = normalizeDate(issueDate)
  const hasPrivateRecipients = settings.pilotMode || (testSettings.enabled && testSettings.recipients.length > 0)
  if (!settings.publicEnabled && !hasPrivateRecipients) {
    return {
      ok: true,
      skipped: true,
      reason: 'Research digest public launch is disabled; general subscriber delivery is paused.',
      issueDate: selectedDate,
    }
  }
  const bundle = await fetchIssueBundle({
    issueDate: selectedDate,
    maxPapers: settings.maxPapers,
    maxOpportunities: settings.maxOpportunities,
    automaticSelection: settings.automaticSelection,
  })

  if (!bundle?.issue?._id) {
    return {
      ok: true,
      skipped: true,
      reason: `No research digest issue was created for ${selectedDate}.`,
      issueDate: selectedDate,
    }
  }

  if (bundle.issue.sentAt && !force) {
    return {
      ok: true,
      skipped: true,
      reason: 'Research digest issue has already been sent.',
      issueDate: selectedDate,
      sentAt: bundle.issue.sentAt,
    }
  }

  if (bundle.issue.status !== RESEARCH_DIGEST_ISSUE_STATUS.approved && !force) {
    return {
      ok: true,
      skipped: true,
      reason: 'Research digest issue is not approved for sending.',
      issueDate: selectedDate,
      issueStatus: bundle.issue.status,
    }
  }

  const papers = Array.isArray(bundle.papers) ? bundle.papers : []
  const opportunities = Array.isArray(bundle.opportunities) ? bundle.opportunities : []
  if (!papers.length && !opportunities.length && !settings.sendEmpty) {
    return {
      ok: true,
      skipped: true,
      reason: 'No approved papers or opportunities to send.',
      issueDate: selectedDate,
    }
  }

  let subscribers = []
  if (settings.pilotMode) {
    if (!settings.pilotRecipients.length) {
      return {
        ok: false,
        status: 409,
        error: 'Research digest pilot mode is enabled, but no pilot recipients are configured.',
      }
    }
    subscribers = (await fetchPilotRecipients(settings.pilotRecipients)).filter(isSubscriberDeliverable)
  } else {
    subscribers = await fetchSubscribers({ issueDate: selectedDate, force })
    subscribers = Array.isArray(subscribers) ? subscribers.filter(isSubscriberDeliverable) : []
  }
  if (testSettings.enabled && !settings.pilotMode) {
    subscribers = filterSubscribersByTestEmails(subscribers, testSettings.recipients)
  }
  if (testSettings.enabled && !settings.pilotMode && testSettings.recipients.length === 0) {
    return {
      ok: false,
      status: 409,
      error: 'Update email sending is locked. Add at least one test recipient or disable test mode.',
    }
  }
  if (!subscribers.length) {
    return {
      ok: true,
      skipped: true,
      reason: 'No eligible research digest subscribers were found.',
      issueDate: selectedDate,
    }
  }

  const stats = {
    total: subscribers.length,
    sent: 0,
    skipped: 0,
    errors: 0,
    papers: papers.length,
    opportunities: opportunities.length,
  }
  if (testSettings.enabled && !settings.pilotMode) {
    stats.testMode = true
    stats.testRecipients = testSettings.recipients.length
  }
  if (settings.pilotMode) {
    stats.pilotMode = true
    stats.pilotRecipients = settings.pilotRecipients.length
  }
  const errors = []
  const nowIso = new Date().toISOString()
  const issueForEmail = {
    ...bundle.issue,
    slug: bundle.issue.slug || bundle.issue.date,
  }

  for (const subscriber of subscribers) {
    const email = buildResearchDigestEmail({
      subscriber,
      issue: issueForEmail,
      papers,
      opportunities,
      settings,
      siteBaseUrl: SITE_BASE_URL,
    })

    try {
      const result = await sendEmail({
        to: subscriber.email,
        subject: email.subject,
        text: email.text,
        html: email.html,
        idempotencyKey: force ? undefined : buildIdempotencyKey(bundle.issue._id, subscriber),
      })
      if (result?.skipped) {
        stats.skipped += 1
        continue
      }
      if (subscriber._id) {
        await writeClient
          .patch(subscriber._id)
          .set({
            lastResearchDigestSentAt: nowIso,
            lastNewsletterSentAt: nowIso,
          })
          .commit({ returnDocuments: false })
      }
      stats.sent += 1
    } catch (error) {
      stats.errors += 1
      errors.push({
        recipientId: subscriber._id || 'pilot-recipient',
        message: error?.message || 'Failed to send',
      })
    }
  }

  const deliveryComplete = stats.errors === 0 && stats.skipped === 0
  if (deliveryComplete) {
    await writeClient
      .patch(bundle.issue._id)
      .set({
        status: RESEARCH_DIGEST_ISSUE_STATUS.sent,
        sentAt: nowIso,
        updatedAt: nowIso,
      })
      .commit({ returnDocuments: false })
  }

  return {
    ok: deliveryComplete,
    status: deliveryComplete ? 200 : 502,
    issueDate: selectedDate,
    stats,
    errors: errors.slice(0, 8),
    ...(!deliveryComplete
      ? { error: 'Research digest delivery was incomplete. Retry without force to send only to recipients not yet recorded as sent.' }
      : {}),
  }
}

export async function GET(request) {
  if (!CRON_SECRET) {
    return NextResponse.json({ ok: false, error: 'CRON_SECRET not configured' }, { status: 500 })
  }
  if (!isCronAuthorized(request, CRON_SECRET)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }
  if (!isWeekdayInTimeZone(new Date(), RESEARCH_DIGEST_TIMEZONE)) {
    return NextResponse.json({ ok: true, skipped: true, reason: 'Research digest sends on weekdays only.' })
  }

  const result = await runDispatch({ force: false })
  return NextResponse.json(result, { status: result.ok ? 200 : result.status || 500 })
}

export async function POST(request) {
  if (!AUTH_TOKEN) {
    return NextResponse.json({ ok: false, error: 'RESEARCH_DIGEST_SEND_TOKEN not configured' }, { status: 500 })
  }
  const token = extractBearerToken(request)
  if (token !== AUTH_TOKEN) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json().catch(() => ({}))
  const result = await runDispatch({
    force: Boolean(body?.force),
    issueDate: body?.issueDate,
  })
  return NextResponse.json(result, { status: result.ok ? 200 : result.status || 500 })
}

export const dynamic = 'force-dynamic'
