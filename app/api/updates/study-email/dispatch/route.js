import { NextResponse } from 'next/server'
import { sanityFetch, writeClient } from '@/lib/sanity'
import { sendEmail } from '@/lib/email'
import { buildStudyUpdateEmail } from '@/lib/studyUpdateEmailTemplate'
import { buildCorsHeaders, extractBearerToken } from '@/lib/httpUtils'
import { getZonedParts, isCronAuthorized, isWithinCronWindow } from '@/lib/cronUtils'
import { filterSubscribersByTestEmails, normalizeUpdateEmailTesting } from '@/lib/updateEmailTesting'
import { isSubscriberDeliverable } from '@/lib/updateSubscriberStatus'
import {
  ALL_THERAPEUTIC_AREAS_VALUE,
  fetchTherapeuticAreas,
  resolveTherapeuticAreaIds,
} from '@/lib/therapeuticAreas'

const SITE_BASE_URL = (process.env.SITE_URL || process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000').replace(
  /\/$/,
  ''
)
const AUTH_TOKEN = process.env.STUDY_UPDATE_SEND_TOKEN
const CRON_SECRET = process.env.CRON_SECRET || ''
const CRON_TIMEZONE = process.env.CRON_TIMEZONE || 'America/New_York'
const CRON_TARGET_HOUR = Number(process.env.STUDY_UPDATE_CRON_HOUR || 7)
const CRON_ALLOWED_MINUTES = Number(process.env.STUDY_UPDATE_CRON_WINDOW || 10)
const MAX_STUDIES = Number(process.env.STUDY_UPDATE_MAX_STUDIES || 4)
const STUDY_UPDATES_PREF = 'study_updates'

const CORS_HEADERS = buildCorsHeaders('GET, POST, OPTIONS')
function shouldRunNow() {
  const now = new Date()
  const parts = getZonedParts(now, CRON_TIMEZONE)
  if (parts.day !== 1) return false
  return isWithinCronWindow({
    timeZone: CRON_TIMEZONE,
    targetHour: CRON_TARGET_HOUR,
    allowedMinutes: CRON_ALLOWED_MINUTES,
    date: now,
  })
}

function getMonthStartIso() {
  const now = new Date()
  const parts = getZonedParts(now, CRON_TIMEZONE)
  const startUtc = new Date(Date.UTC(parts.year, parts.month - 1, 1, 0, 0, 0))
  return startUtc.toISOString()
}

function formatMonthLabel(date) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: CRON_TIMEZONE,
    month: 'long',
    year: 'numeric',
  }).format(date)
}

function pickStudiesForSubscriber(studies, subscriber, areas) {
  const eligibleStudies = Array.isArray(studies)
    ? studies.filter(
        (study) =>
          String(study?.status || '').toLowerCase() === 'recruiting' &&
          Boolean(study?.acceptsReferrals)
      )
    : []
  const rawInterestAreas = Array.isArray(subscriber?.interestAreas) ? subscriber.interestAreas : []
  const allTherapeuticAreas =
    Boolean(subscriber?.allTherapeuticAreas) || rawInterestAreas.includes(ALL_THERAPEUTIC_AREAS_VALUE)
  if (allTherapeuticAreas) return eligibleStudies
  const interestAreaIds = resolveTherapeuticAreaIds(rawInterestAreas, areas)
  if (!interestAreaIds.length) return []
  const interestSet = new Set(interestAreaIds)
  return eligibleStudies.filter((study) =>
    Array.isArray(study?.therapeuticAreaIds)
      ? study.therapeuticAreaIds.some((id) => interestSet.has(id))
      : false
  )
}

function buildManageUrl(token) {
  if (!token) return ''
  return `${SITE_BASE_URL}/updates/manage?token=${encodeURIComponent(token)}`
}

async function fetchStudies() {
  const fetcher = writeClient.config().token ? writeClient.fetch.bind(writeClient) : sanityFetch
  const query = `
    *[_type == "trialSummary" && status == "recruiting"] | order(featured desc, title asc) {
      _id,
      status,
      title,
      "slug": slug.current,
      emailTitle,
      emailEligibilitySummary,
      inclusionCriteria,
      acceptsReferrals,
      localContact { email },
      principalInvestigator-> { name },
      principalInvestigatorName,
      "therapeuticAreaIds": therapeuticAreas[]._ref
    }
  `
  return fetcher(query)
}

async function fetchStudyUpdateSettings() {
  const fetcher = writeClient.config().token ? writeClient.fetch.bind(writeClient) : sanityFetch
  const query = `
    *[_type == "siteSettings"][0]{
      studyUpdates{
        subjectTemplate,
        introText,
        emptyIntroText,
        outroText,
        signature,
        maxStudies,
        sendEmpty
      },
      updateEmailTesting{
        enabled,
        recipients
      }
    }
  `
  const settings = await fetcher(query)
  return {
    settings: settings?.studyUpdates || {},
    testing: settings?.updateEmailTesting || {},
  }
}

async function fetchSubscribers({ monthStartIso, force }) {
  const fetcher = writeClient.config().token ? writeClient.fetch.bind(writeClient) : sanityFetch
  const monthFilter = force
    ? ''
    : ' && (!defined(lastStudyUpdateSentAt) || lastStudyUpdateSentAt < $monthStartIso)'
  const query = `
    *[_type == "updateSubscriber"
      && (subscriptionStatus == "subscribed" || (!defined(subscriptionStatus) && status == "active"))
      && (!defined(deliveryStatus) || deliveryStatus != "suppressed")
      && suppressEmails != true
      && "${STUDY_UPDATES_PREF}" in correspondencePreferences
      && defined(email)
      ${monthFilter}
    ]{
      _id,
      name,
      email,
      status,
      subscriptionStatus,
      deliveryStatus,
      suppressEmails,
      interestAreas,
      allTherapeuticAreas,
      manageToken,
      lastStudyUpdateSentAt
    }
  `
  return fetcher(query, { monthStartIso })
}

async function runDispatch({ force = false } = {}) {
  if (!writeClient.config().token) {
    return {
      ok: false,
      status: 500,
      error: 'SANITY_API_TOKEN missing; cannot update send tracking.',
    }
  }

  const now = new Date()
  const monthLabel = formatMonthLabel(now)
  const monthStartIso = getMonthStartIso()

  const [studiesRaw, subscribersRaw, settingsPayload, areasRaw] = await Promise.all([
    fetchStudies(),
    fetchSubscribers({ monthStartIso, force }),
    fetchStudyUpdateSettings(),
    fetchTherapeuticAreas(),
  ])

  const studies = Array.isArray(studiesRaw) ? studiesRaw : []
  const areas = Array.isArray(areasRaw) ? areasRaw : []
  const updateSettings = settingsPayload?.settings || {}
  const testSettings = normalizeUpdateEmailTesting(settingsPayload?.testing)
  if (!testSettings.enabled || testSettings.recipients.length === 0) {
    return {
      ok: false,
      status: 409,
      error: 'Update email sending is locked. Enable test mode and add at least one test recipient.',
    }
  }
  let subscribers = Array.isArray(subscribersRaw) ? subscribersRaw : []
  if (testSettings.enabled) {
    subscribers = filterSubscribersByTestEmails(subscribers, testSettings.recipients)
  }
  const maxStudies = Number.isFinite(Number(updateSettings.maxStudies)) && Number(updateSettings.maxStudies) > 0
    ? Number(updateSettings.maxStudies)
    : MAX_STUDIES
  const sendEmpty = Boolean(updateSettings?.sendEmpty)

  const stats = {
    total: subscribers.length,
    sent: 0,
    skipped: 0,
    errors: 0,
  }
  if (testSettings.enabled) {
    stats.testMode = true
    stats.testRecipients = testSettings.recipients.length
  }
  const errors = []

  for (const subscriber of subscribers) {
    if (!isSubscriberDeliverable(subscriber)) {
      stats.skipped += 1
      continue
    }
    const relevant = pickStudiesForSubscriber(studies, subscriber, areas)
    const topStudies = relevant.slice(0, maxStudies)
    if (!topStudies.length && !sendEmpty) {
      stats.skipped += 1
      continue
    }
    const manageUrl = buildManageUrl(subscriber?.manageToken)
    const email = buildStudyUpdateEmail({
      subscriber,
      studies: topStudies,
      manageUrl,
      monthLabel,
      settings: updateSettings,
      siteBaseUrl: SITE_BASE_URL,
    })

    try {
      const result = await sendEmail({
        to: subscriber.email,
        subject: email.subject,
        text: email.text,
        html: email.html,
      })
      if (result?.skipped) {
        stats.skipped += 1
        continue
      }
      await writeClient
        .patch(subscriber._id)
        .set({ lastStudyUpdateSentAt: now.toISOString() })
        .commit({ returnDocuments: false })
      stats.sent += 1
    } catch (error) {
      stats.errors += 1
      errors.push({
        email: subscriber.email,
        message: error?.message || 'Failed to send',
      })
    }
  }

  return {
    ok: true,
    stats,
    errors: errors.slice(0, 8),
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS })
}

export async function GET(request) {
  if (!CRON_SECRET) {
    return NextResponse.json({ ok: false, error: 'CRON_SECRET not configured' }, { status: 500, headers: CORS_HEADERS })
  }

  if (!isCronAuthorized(request, CRON_SECRET)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401, headers: CORS_HEADERS })
  }

  const skipTimeCheck = process.env.CRON_SKIP_TIME_CHECK === 'true'
  if (!skipTimeCheck && !shouldRunNow()) {
    return NextResponse.json(
      {
        ok: true,
        skipped: true,
        reason: 'Outside scheduled local-time window',
        timezone: CRON_TIMEZONE,
      },
      { headers: CORS_HEADERS }
    )
  }

  const result = await runDispatch({ force: false })
  const status = result.ok ? 200 : result.status || 500
  return NextResponse.json(result, { status, headers: CORS_HEADERS })
}

export async function POST(request) {
  if (!AUTH_TOKEN) {
    return NextResponse.json(
      { ok: false, error: 'STUDY_UPDATE_SEND_TOKEN not configured' },
      { status: 500, headers: CORS_HEADERS }
    )
  }

  const token = extractBearerToken(request)
  if (token !== AUTH_TOKEN) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401, headers: CORS_HEADERS })
  }

  let body = {}
  try {
    body = await request.json()
  } catch (error) {
    body = {}
  }

  const force = Boolean(body?.force)
  const result = await runDispatch({ force })
  const status = result.ok ? 200 : result.status || 500
  return NextResponse.json(result, { status, headers: CORS_HEADERS })
}

export const dynamic = 'force-dynamic'
