import { NextResponse } from 'next/server'
import { sanityFetch, writeClient } from '@/lib/sanity'
import { sendEmail } from '@/lib/email'
import { buildPublicationNewsletterEmail } from '@/lib/publicationNewsletterEmailTemplate'
import { buildCorsHeaders, extractBearerToken } from '@/lib/httpUtils'
import { getZonedParts, isCronAuthorized, isWithinCronWindow } from '@/lib/cronUtils'
import { readCache } from '@/lib/pubmedCache'
import { getPublicationDate } from '@/lib/publicationUtils'

const SITE_BASE_URL = (process.env.SITE_URL || process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000').replace(
  /\/$/,
  ''
)
const AUTH_TOKEN = process.env.PUBLICATION_NEWSLETTER_SEND_TOKEN || ''
const CRON_SECRET = process.env.CRON_SECRET || ''
const CRON_TIMEZONE = process.env.CRON_TIMEZONE || 'America/New_York'
const CRON_TARGET_DAY = Number(process.env.PUBLICATION_NEWSLETTER_CRON_DAY || 1)
const CRON_TARGET_HOUR = Number(process.env.PUBLICATION_NEWSLETTER_CRON_HOUR || 8)
const CRON_ALLOWED_MINUTES = Number(process.env.PUBLICATION_NEWSLETTER_CRON_WINDOW || 10)
const DEFAULT_WINDOW_DAYS = Number(process.env.PUBLICATION_NEWSLETTER_WINDOW_DAYS || 30)
const DEFAULT_MAX_PUBLICATIONS = Number(process.env.PUBLICATION_NEWSLETTER_MAX_PUBLICATIONS || 8)
const NEWSLETTER_PREF = 'newsletter'

const CORS_HEADERS = buildCorsHeaders('GET, POST, OPTIONS')

function shouldRunNow() {
  const now = new Date()
  const parts = getZonedParts(now, CRON_TIMEZONE)
  if (parts.day !== CRON_TARGET_DAY) return false
  return isWithinCronWindow({
    timeZone: CRON_TIMEZONE,
    targetHour: CRON_TARGET_HOUR,
    allowedMinutes: CRON_ALLOWED_MINUTES,
    date: now,
  })
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

function buildManageUrl(token) {
  if (!token) return ''
  return `${SITE_BASE_URL}/updates/manage?token=${encodeURIComponent(token)}`
}

function normalizeWindowMode(value) {
  return value === 'last_sent' ? 'last_sent' : 'rolling_days'
}

function getStartDate({ subscriber, now, windowMode, windowDays }) {
  if (windowMode === 'last_sent') {
    const lastSent = subscriber?.lastPublicationNewsletterSentAt
      ? new Date(subscriber.lastPublicationNewsletterSentAt)
      : null
    if (lastSent && !Number.isNaN(lastSent.getTime())) return lastSent
  }
  if (windowDays > 0) {
    return new Date(now.getTime() - windowDays * 24 * 60 * 60 * 1000)
  }
  return null
}

function preparePublications(publications = []) {
  return publications
    .filter((pub) => pub && pub.exclude !== true)
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
        windowMode,
        windowDays,
        maxPublications,
        sendEmpty
      }
    }
  `
  const settings = await fetcher(query)
  return settings?.publicationNewsletter || {}
}

async function fetchSubscribers({ cutoffIso, force, windowMode }) {
  const fetcher = writeClient.config().token ? writeClient.fetch.bind(writeClient) : sanityFetch
  const windowFilter = !force && windowMode === 'rolling_days' && cutoffIso
    ? ' && (!defined(lastPublicationNewsletterSentAt) || lastPublicationNewsletterSentAt < $cutoffIso)'
    : ''
  const query = `
    *[_type == "updateSubscriber"
      && status == "active"
      && "${NEWSLETTER_PREF}" in correspondencePreferences
      && defined(email)
      ${windowFilter}
    ]{
      _id,
      name,
      email,
      manageToken,
      lastPublicationNewsletterSentAt
    }
  `
  return fetcher(query, { cutoffIso })
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
  const settings = await fetchNewsletterSettings()
  const windowMode = normalizeWindowMode(settings?.windowMode)
  const windowDays = Number.isFinite(Number(settings?.windowDays)) && Number(settings?.windowDays) > 0
    ? Number(settings.windowDays)
    : DEFAULT_WINDOW_DAYS
  const maxPublications = Number.isFinite(Number(settings?.maxPublications)) && Number(settings?.maxPublications) > 0
    ? Number(settings.maxPublications)
    : DEFAULT_MAX_PUBLICATIONS
  const sendEmpty = Boolean(settings?.sendEmpty)

  const cutoffIso = windowMode === 'rolling_days'
    ? new Date(now.getTime() - windowDays * 24 * 60 * 60 * 1000).toISOString()
    : null

  const [subscribersRaw, cache, researchersRaw] = await Promise.all([
    fetchSubscribers({ cutoffIso, force, windowMode }),
    readCache(),
    fetchResearchers(),
  ])

  const subscribers = Array.isArray(subscribersRaw) ? subscribersRaw : []
  const researchers = Array.isArray(researchersRaw) ? researchersRaw : []
  const publications = preparePublications(cache?.publications || [])
  const provenance = cache?.provenance || {}

  const stats = {
    total: subscribers.length,
    sent: 0,
    skipped: 0,
    errors: 0,
  }
  const errors = []

  for (const subscriber of subscribers) {
    const startDate = getStartDate({ subscriber, now, windowMode, windowDays })
    const rangeLabel = formatRangeLabel(startDate, now) || monthLabel
    const relevant = filterPublicationsByDate(publications, startDate)
    const topPublications = relevant.slice(0, maxPublications)

    if (!topPublications.length && !sendEmpty) {
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
        tags: [{ name: 'campaign', value: 'publication-newsletter' }],
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
  if (AUTH_TOKEN) {
    const token = extractBearerToken(request)
    if (token !== AUTH_TOKEN) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401, headers: CORS_HEADERS })
    }
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
