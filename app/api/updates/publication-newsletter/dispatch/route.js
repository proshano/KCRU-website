import { NextResponse } from 'next/server'
import { sanityFetch, writeClient } from '@/lib/sanity'
import { sendEmail } from '@/lib/email'
import { buildPublicationNewsletterEmail } from '@/lib/publicationNewsletterEmailTemplate'
import { buildCorsHeaders, extractBearerToken } from '@/lib/httpUtils'
import { getZonedParts, isCronAuthorized, isTodayNthWeekday, isVercelCronRequest, normalizeNthWeekdaySchedule } from '@/lib/cronUtils'
import { readCache } from '@/lib/pubmedCache'
import { getPublicationDate } from '@/lib/publicationUtils'
import { mergeWithClassifications } from '@/lib/publications'
import { isPublicationExcluded } from '@/lib/publicationExclusions'
import { filterSubscribersByTestEmails, normalizeUpdateEmailTesting } from '@/lib/updateEmailTesting'
import { isSubscriberDeliverable } from '@/lib/updateSubscriberStatus'
import { getWindowStart, hasWindowElapsed, parseLastGlobalSentAt } from '@/lib/publicationNewsletterWindow'

const SITE_BASE_URL = (process.env.SITE_URL || process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000').replace(
  /\/$/,
  ''
)
const AUTH_TOKEN = process.env.PUBLICATION_NEWSLETTER_SEND_TOKEN
const CRON_SECRET = process.env.CRON_SECRET || ''
const CRON_TIMEZONE = process.env.CRON_TIMEZONE || 'America/New_York'
const DEFAULT_SCHEDULE_OCCURRENCE = process.env.PUBLICATION_NEWSLETTER_SCHEDULE_OCCURRENCE || '3rd'
const DEFAULT_SCHEDULE_DAY_OF_WEEK = process.env.PUBLICATION_NEWSLETTER_SCHEDULE_DAY || 'monday'
const DEFAULT_WINDOW_DAYS = Number(process.env.PUBLICATION_NEWSLETTER_WINDOW_DAYS || 30)
const DEFAULT_MAX_PUBLICATIONS = Number(process.env.PUBLICATION_NEWSLETTER_MAX_PUBLICATIONS || 8)
const NEWSLETTER_PREF = 'newsletter'

const CORS_HEADERS = buildCorsHeaders('GET, POST, OPTIONS')

function resolveSchedule(settings = {}) {
  return normalizeNthWeekdaySchedule({
    occurrence: settings?.scheduleOccurrence,
    dayOfWeek: settings?.scheduleDayOfWeek,
    defaultOccurrence: DEFAULT_SCHEDULE_OCCURRENCE,
    defaultDayOfWeek: DEFAULT_SCHEDULE_DAY_OF_WEEK,
  })
}

function shouldRunNow(schedule, date = new Date()) {
  return isTodayNthWeekday({ timeZone: CRON_TIMEZONE, occurrence: schedule.occurrence, dayOfWeek: schedule.dayOfWeek, date })
}

function formatMonthLabel(date) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: CRON_TIMEZONE,
    month: 'long',
    year: 'numeric',
  }).format(date)
}

function formatRangeLabel(startDate, endDate) {
  if (!startDate) return ''
  const end = endDate || new Date()
  const sameYear = startDate.getUTCFullYear() === end.getUTCFullYear()
  const startFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: CRON_TIMEZONE,
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  })
  const endFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: CRON_TIMEZONE,
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
  return `${startFormatter.format(startDate)}-${endFormatter.format(end)}`
}

function countPublicationsSinceYear(publications = [], startYear) {
  const normalizedStart = Number(startYear)
  if (!Number.isFinite(normalizedStart)) return 0
  return publications.reduce((total, pub) => {
    const year = Number(pub?.year)
    if (Number.isFinite(year) && year >= normalizedStart) return total + 1
    return total
  }, 0)
}

function buildManageUrl(token) {
  if (!token) return ''
  return `${SITE_BASE_URL}/updates/manage?token=${encodeURIComponent(token)}`
}

function preparePublications(publications = []) {
  return publications
    .filter((pub) => pub && !isPublicationExcluded(pub))
    .map((pub) => {
      const date = getPublicationDate(pub)
      return {
        ...pub,
        _dateMs: date ? date.getTime() : null,
      }
    })
    .sort((a, b) => {
      const diff = (b._dateMs || 0) - (a._dateMs || 0)
      if (diff !== 0) return diff
      const yearDiff = (b.year || 0) - (a.year || 0)
      if (yearDiff !== 0) return yearDiff
      return String(a.title || '').localeCompare(String(b.title || ''))
    })
}

function filterPublicationsByDate(publications = [], startDate) {
  if (!startDate) return publications
  const startMs = startDate.getTime()
  return publications.filter((pub) => pub._dateMs && pub._dateMs >= startMs)
}

async function fetchNewsletterSettings() {
  const fetcher = writeClient.config().token ? writeClient.fetch.bind(writeClient) : sanityFetch
  const query = `
    *[_type == "siteSettings"][0]{
      publicationNewsletter{
        subjectTemplate,
        introText,
        emptyIntroText,
        outroText,
        signature,
        scheduleOccurrence,
        scheduleDayOfWeek,
        windowDays,
        maxPublications,
        sendEmpty,
        lastGlobalSentAt
      },
      updateEmailTesting{
        enabled,
        recipients
      }
    }
  `
  const settings = await fetcher(query)
  return {
    settings: settings?.publicationNewsletter || {},
    testing: settings?.updateEmailTesting || {},
  }
}

/**
 * The newest per-subscriber send, used only to bootstrap the global timestamp.
 *
 * Sends that predate this scheme left no global record, so without this the first run
 * would fall back to a rolling window and lose the real boundary - resending or skipping
 * whatever sits between the two. It is a migration path, not a source of truth: the
 * moment a send completes, recordGlobalSend stores the real value and this stops being
 * consulted. See recordGlobalSend for why the derived value cannot be trusted long-term.
 */
async function fetchBootstrapSentAt() {
  const fetcher = writeClient.config().token ? writeClient.fetch.bind(writeClient) : sanityFetch
  try {
    const raw = await fetcher(
      `*[_type == "updateSubscriber" && defined(lastPublicationNewsletterSentAt)]
        | order(lastPublicationNewsletterSentAt desc)[0].lastPublicationNewsletterSentAt`
    )
    return parseLastGlobalSentAt({ lastGlobalSentAt: raw })
  } catch (error) {
    console.warn('[publication-newsletter] Could not read a bootstrap send timestamp', error?.message || error)
    return null
  }
}

/**
 * Close the window by stamping the site settings.
 *
 * Stored rather than derived from the newest lastPublicationNewsletterSentAt across
 * subscribers: that maximum regresses if the people who received the last send later
 * unsubscribe or are deleted, which would silently reopen a window and resend its
 * publications. Returns false rather than throwing so a failure here cannot lose a send
 * that already went out.
 */
async function recordGlobalSend(sentAt) {
  try {
    const doc = await writeClient.fetch(`*[_type == "siteSettings"][0]{ _id }`)
    if (!doc?._id) {
      console.error('[publication-newsletter] Site settings not found; cannot record global send')
      return false
    }
    await writeClient
      .patch(doc._id)
      .setIfMissing({ publicationNewsletter: {} })
      .set({ 'publicationNewsletter.lastGlobalSentAt': sentAt.toISOString() })
      .commit({ returnDocuments: false })
    return true
  } catch (error) {
    console.error('[publication-newsletter] Failed to record global send timestamp', error)
    return false
  }
}

// No per-subscriber date filter: hasWindowElapsed decides whether the run happens at all,
// and once it does every deliverable subscriber gets the same issue.
async function fetchSubscribers() {
  const fetcher = writeClient.config().token ? writeClient.fetch.bind(writeClient) : sanityFetch
  const query = `
    *[_type == "updateSubscriber"
      && subscriptionStatus == "subscribed"
      && deliveryStatus != "suppressed"
      && "${NEWSLETTER_PREF}" in correspondencePreferences
      && defined(email)
    ]{
      _id,
      name,
      email,
      subscriptionStatus,
      deliveryStatus,
      manageToken,
      lastPublicationNewsletterSentAt
    }
  `
  return fetcher(query)
}

async function fetchResearchers() {
  const fetcher = writeClient.config().token ? writeClient.fetch.bind(writeClient) : sanityFetch
  const query = `
    *[_type == "researcher"] | order(order asc) {
      _id,
      name,
      slug,
      photo
    }
  `
  return fetcher(query)
}

async function runDispatch({ force = false, settingsPayload } = {}) {
  if (!writeClient.config().token) {
    return {
      ok: false,
      status: 500,
      error: 'SANITY_API_TOKEN missing; cannot update send tracking.',
    }
  }

  const now = new Date()
  const monthLabel = formatMonthLabel(now)
  const resolvedSettingsPayload = settingsPayload || await fetchNewsletterSettings()
  const settings = resolvedSettingsPayload?.settings || {}
  const testSettings = normalizeUpdateEmailTesting(resolvedSettingsPayload?.testing)
  if (testSettings.enabled && testSettings.recipients.length === 0) {
    return {
      ok: false,
      status: 409,
      error: 'Update email sending is locked. Add at least one test recipient or disable test mode.',
    }
  }
  const windowDays = Number.isFinite(Number(settings.windowDays)) && Number(settings.windowDays) > 0
    ? Number(settings.windowDays)
    : DEFAULT_WINDOW_DAYS
  const maxPublications = Number.isFinite(Number(settings.maxPublications)) && Number(settings.maxPublications) > 0
    ? Number(settings.maxPublications)
    : DEFAULT_MAX_PUBLICATIONS
  const sendEmpty = Boolean(settings?.sendEmpty)
  const lastGlobalSentAt = parseLastGlobalSentAt(settings) || await fetchBootstrapSentAt()

  if (!force && !hasWindowElapsed({ lastGlobalSentAt, now, windowDays })) {
    return {
      ok: true,
      skipped: true,
      reason: `Last send was less than ${windowDays} days ago`,
      lastGlobalSentAt: lastGlobalSentAt?.toISOString() || null,
      windowDays,
    }
  }

  const [subscribersRaw, cache, researchersRaw] = await Promise.all([
    fetchSubscribers(),
    readCache(),
    fetchResearchers(),
  ])

  let subscribers = Array.isArray(subscribersRaw) ? subscribersRaw : []
  if (testSettings.enabled) {
    subscribers = filterSubscribersByTestEmails(subscribers, testSettings.recipients)
  }
  const researchers = Array.isArray(researchersRaw) ? researchersRaw : []
  const cachePublications = Array.isArray(cache?.publications) ? cache.publications : []
  const publicationsWithClassifications = await mergeWithClassifications(cachePublications)
  const publications = preparePublications(publicationsWithClassifications || [])
  const provenance = cache?.provenance || {}
  const previousYear = getZonedParts(now, CRON_TIMEZONE).year - 1
  const publicationStats = {
    previousYear,
    countSincePreviousYear: countPublicationsSinceYear(publications, previousYear),
    countSince2022: countPublicationsSinceYear(publications, 2022),
  }

  // One window, one publication list, one issue - resolved before the loop rather than
  // per subscriber, because that is the whole point of the global timestamp.
  const startDate = getWindowStart({ lastGlobalSentAt, now, windowDays })
  const rangeLabel = formatRangeLabel(startDate, now) || monthLabel
  const topPublications = filterPublicationsByDate(publications, startDate).slice(0, maxPublications)

  const stats = {
    total: subscribers.length,
    sent: 0,
    skipped: 0,
    errors: 0,
    publications: topPublications.length,
    windowStart: startDate ? startDate.toISOString() : null,
  }
  if (testSettings.enabled) {
    stats.testMode = true
    stats.testRecipients = testSettings.recipients.length
  }
  const errors = []

  if (!topPublications.length && !sendEmpty) {
    return {
      ok: true,
      skipped: true,
      reason: 'No new publications in the window',
      stats: { ...stats, skipped: subscribers.length },
      errors: [],
    }
  }

  for (const subscriber of subscribers) {
    if (!isSubscriberDeliverable(subscriber)) {
      stats.skipped += 1
      continue
    }

    const manageUrl = buildManageUrl(subscriber?.manageToken)
    const email = buildPublicationNewsletterEmail({
      subscriber,
      publications: topPublications,
      manageUrl,
      monthLabel,
      rangeLabel,
      settings,
      publicationStats,
      siteBaseUrl: SITE_BASE_URL,
      researchers,
      provenance,
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
        .set({
          lastPublicationNewsletterSentAt: now.toISOString(),
          lastNewsletterSentAt: now.toISOString(),
        })
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

  // Advance the global timestamp only once something actually reached a real subscriber.
  // Advancing on a run that sent nothing would mark that stretch of publications as
  // covered when nobody received it, and they would never appear in a later issue. A test
  // send goes to the test recipients alone, so it must not close the window either.
  if (stats.sent > 0 && !testSettings.enabled) {
    const recorded = await recordGlobalSend(now)
    stats.lastGlobalSentAt = recorded ? now.toISOString() : null
    if (!recorded) {
      errors.push({
        email: null,
        message: 'Sent, but failed to record the global send timestamp; the next run may repeat this window.',
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
  const isVercelCron = isVercelCronRequest(request)
  if (!CRON_SECRET && !isVercelCron) {
    return NextResponse.json({ ok: false, error: 'CRON_SECRET not configured' }, { status: 500, headers: CORS_HEADERS })
  }

  if (!isCronAuthorized(request, CRON_SECRET)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401, headers: CORS_HEADERS })
  }

  const settingsPayload = await fetchNewsletterSettings()
  const schedule = resolveSchedule(settingsPayload?.settings)

  if (!shouldRunNow(schedule)) {
    return NextResponse.json(
      {
        ok: true,
        skipped: true,
        reason: 'Today does not match the configured scheduled day',
        timezone: CRON_TIMEZONE,
        schedule,
      },
      { headers: CORS_HEADERS }
    )
  }

  const result = await runDispatch({ force: false, settingsPayload })
  const status = result.ok ? 200 : result.status || 500
  return NextResponse.json(result, { status, headers: CORS_HEADERS })
}

export async function POST(request) {
  if (!AUTH_TOKEN) {
    return NextResponse.json(
      { ok: false, error: 'PUBLICATION_NEWSLETTER_SEND_TOKEN not configured' },
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
