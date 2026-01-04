import { NextResponse } from 'next/server'
import { sanityFetch, writeClient } from '@/lib/sanity'
import { sanitizeString } from '@/lib/studySubmissions'
import { getScopedAdminSession } from '@/lib/adminSessions'
import { buildCorsHeaders, extractBearerToken } from '@/lib/httpUtils'
import { normalizeUpdateEmailTesting } from '@/lib/updateEmailTesting'

const CORS_HEADERS = buildCorsHeaders('GET, PATCH, OPTIONS')

const DEFAULT_WINDOW_DAYS = Number(process.env.PUBLICATION_NEWSLETTER_WINDOW_DAYS || 30)
const DEFAULT_MAX_PUBLICATIONS = Number(process.env.PUBLICATION_NEWSLETTER_MAX_PUBLICATIONS || 8)

async function getSession(token) {
  return getScopedAdminSession(token, { scope: 'updates' })
}

function normalizeWindowMode(value) {
  const normalized = sanitizeString(value).toLowerCase()
  return normalized === 'last_sent' ? 'last_sent' : 'rolling_days'
}

function normalizeSettingsPayload(body) {
  const subjectTemplate = sanitizeString(body?.subjectTemplate) || null
  const introText = sanitizeString(body?.introText) || null
  const emptyIntroText = sanitizeString(body?.emptyIntroText) || null
  const outroText = sanitizeString(body?.outroText) || null
  const signature = sanitizeString(body?.signature) || null
  const windowMode = normalizeWindowMode(body?.windowMode)
  const windowDaysRaw = Number(body?.windowDays)
  const windowDays = Number.isFinite(windowDaysRaw) && windowDaysRaw > 0
    ? Math.min(Math.round(windowDaysRaw), 365)
    : null
  const maxPublicationsRaw = Number(body?.maxPublications)
  const maxPublications = Number.isFinite(maxPublicationsRaw) && maxPublicationsRaw > 0
    ? Math.min(Math.round(maxPublicationsRaw), 30)
    : null
  const sendEmpty = Boolean(body?.sendEmpty)

  return {
    subjectTemplate,
    introText,
    emptyIntroText,
    outroText,
    signature,
    windowMode,
    windowDays,
    maxPublications,
    sendEmpty,
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS })
}

export async function GET(request) {
  const token = extractBearerToken(request)
  const { session, error, status } = await getSession(token)
  if (!session) {
    return NextResponse.json({ ok: false, error }, { status, headers: CORS_HEADERS })
  }

  try {
    const fetcher = writeClient.config().token
      ? (query, params) => writeClient.fetch(query, params)
      : sanityFetch

    const settingsRaw = await fetcher(
      `*[_type == "siteSettings"][0]{
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
        },
        updateEmailTesting{
          enabled,
          recipients
        }
      }`
    )

    const settings = settingsRaw?.publicationNewsletter || {}
    const windowMode = normalizeWindowMode(settings.windowMode)
    const windowDays = Number.isFinite(Number(settings.windowDays)) && Number(settings.windowDays) > 0
      ? Number(settings.windowDays)
      : DEFAULT_WINDOW_DAYS
    const maxPublications = Number.isFinite(Number(settings.maxPublications)) && Number(settings.maxPublications) > 0
      ? Number(settings.maxPublications)
      : DEFAULT_MAX_PUBLICATIONS
    const normalizedSettings = {
      ...settings,
      windowMode,
      windowDays,
      maxPublications,
      sendEmpty: Boolean(settings.sendEmpty),
    }
    const cutoffIso = windowMode === 'rolling_days'
      ? new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString()
      : null
    const eligibleFilter = windowMode === 'rolling_days'
      ? ' && (!defined(lastPublicationNewsletterSentAt) || lastPublicationNewsletterSentAt < $cutoffIso)'
      : ''

    const statsRaw = await fetcher(
      `{
        "total": count(*[_type == "updateSubscriber"]),
        "active": count(*[_type == "updateSubscriber" && status == "active"]),
        "optedIn": count(*[_type == "updateSubscriber" && status == "active" && "newsletter" in correspondencePreferences && defined(email) && suppressEmails != true]),
        "eligible": count(*[_type == "updateSubscriber" && status == "active" && "newsletter" in correspondencePreferences && defined(email) && suppressEmails != true${eligibleFilter}]),
        "suppressed": count(*[_type == "updateSubscriber" && suppressEmails == true]),
        "lastSentAt": *[_type == "updateSubscriber" && defined(lastPublicationNewsletterSentAt)] | order(lastPublicationNewsletterSentAt desc)[0].lastPublicationNewsletterSentAt
      }`,
      { cutoffIso }
    )

    return NextResponse.json(
      {
        ok: true,
        adminEmail: session.email,
        stats: statsRaw || {},
        settings: normalizedSettings,
        testSettings: normalizeUpdateEmailTesting(settingsRaw?.updateEmailTesting),
      },
      { headers: CORS_HEADERS }
    )
  } catch (error) {
    console.error('[publication-newsletter-admin] GET failed', error)
    return NextResponse.json(
      { ok: false, error: error?.message || 'Failed to load publication newsletter data.' },
      { status: 500, headers: CORS_HEADERS }
    )
  }
}

export async function PATCH(request) {
  const token = extractBearerToken(request)
  const { session, error, status } = await getSession(token)
  if (!session) {
    return NextResponse.json({ ok: false, error }, { status, headers: CORS_HEADERS })
  }

  if (!writeClient.config().token) {
    return NextResponse.json(
      { ok: false, error: 'SANITY_API_TOKEN missing; cannot update settings.' },
      { status: 500, headers: CORS_HEADERS }
    )
  }

  try {
    const body = await request.json()
    const updates = normalizeSettingsPayload(body || {})

    const settingsDoc = await writeClient.fetch(`*[_type == "siteSettings"][0]{ _id }`)
    if (!settingsDoc?._id) {
      return NextResponse.json(
        { ok: false, error: 'Site settings not found.' },
        { status: 500, headers: CORS_HEADERS }
      )
    }

    await writeClient
      .patch(settingsDoc._id)
      .set({
        'publicationNewsletter.subjectTemplate': updates.subjectTemplate,
        'publicationNewsletter.introText': updates.introText,
        'publicationNewsletter.emptyIntroText': updates.emptyIntroText,
        'publicationNewsletter.outroText': updates.outroText,
        'publicationNewsletter.signature': updates.signature,
        'publicationNewsletter.windowMode': updates.windowMode,
        'publicationNewsletter.windowDays': updates.windowDays,
        'publicationNewsletter.maxPublications': updates.maxPublications,
        'publicationNewsletter.sendEmpty': updates.sendEmpty,
      })
      .commit({ returnDocuments: false })

    const refreshed = await writeClient.fetch(
      `*[_type == "siteSettings"][0]{
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
        },
        updateEmailTesting{
          enabled,
          recipients
        }
      }`
    )

    return NextResponse.json(
      {
        ok: true,
        settings: refreshed?.publicationNewsletter || {},
        testSettings: normalizeUpdateEmailTesting(refreshed?.updateEmailTesting),
      },
      { headers: CORS_HEADERS }
    )
  } catch (error) {
    console.error('[publication-newsletter-admin] PATCH failed', error)
    return NextResponse.json(
      { ok: false, error: error?.message || 'Failed to update settings.' },
      { status: 500, headers: CORS_HEADERS }
    )
  }
}

export const dynamic = 'force-dynamic'
