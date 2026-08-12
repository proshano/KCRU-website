import { NextResponse } from 'next/server'
import { sanityFetch, writeClient } from '@/lib/sanity'
import { sanitizeString } from '@/lib/studySubmissions'
import { getScopedAdminSession } from '@/lib/adminSessions'
import { getSessionAccess, hasRequiredAccess } from '@/lib/authAccess'
import { buildCorsHeaders, extractBearerToken } from '@/lib/httpUtils'
import { normalizeUpdateEmailTesting } from '@/lib/updateEmailTesting'
import { hasWindowElapsed, parseLastGlobalSentAt } from '@/lib/publicationNewsletterWindow'

const CORS_HEADERS = buildCorsHeaders('GET, PATCH, OPTIONS')

const DEFAULT_WINDOW_DAYS = Number(process.env.PUBLICATION_NEWSLETTER_WINDOW_DAYS || 30)
const DEFAULT_MAX_PUBLICATIONS = Number(process.env.PUBLICATION_NEWSLETTER_MAX_PUBLICATIONS || 8)
const SUBSCRIBED_FILTER = 'subscriptionStatus == "subscribed"'
const DELIVERABLE_FILTER = `${SUBSCRIBED_FILTER} && deliveryStatus != "suppressed"`

async function getSession(request) {
  const sessionAccess = await getSessionAccess()
  if (sessionAccess) {
    if (hasRequiredAccess(sessionAccess.access, { updates: true })) {
      return { session: { email: sessionAccess.email }, status: 200 }
    }
    return { session: null, error: 'Not authorized for study updates.', status: 403 }
  }

  const token = extractBearerToken(request)
  return getScopedAdminSession(token, { scope: 'updates' })
}

function normalizeSettingsPayload(body) {
  const subjectTemplate = sanitizeString(body?.subjectTemplate) || null
  const introText = sanitizeString(body?.introText) || null
  const emptyIntroText = sanitizeString(body?.emptyIntroText) || null
  const outroText = sanitizeString(body?.outroText) || null
  const signature = sanitizeString(body?.signature) || null
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
    windowDays,
    maxPublications,
    sendEmpty,
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS })
}

export async function GET(request) {
  const { session, error, status } = await getSession(request)
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
          windowDays,
          maxPublications,
          sendEmpty,
          lastGlobalSentAt
        },
        updateEmailTesting{
          enabled,
          recipients
        }
      }`
    )

    const settings = settingsRaw?.publicationNewsletter || {}
    const windowDays = Number.isFinite(Number(settings.windowDays)) && Number(settings.windowDays) > 0
      ? Number(settings.windowDays)
      : DEFAULT_WINDOW_DAYS
    const maxPublications = Number.isFinite(Number(settings.maxPublications)) && Number(settings.maxPublications) > 0
      ? Number(settings.maxPublications)
      : DEFAULT_MAX_PUBLICATIONS
    const normalizedSettings = {
      ...settings,
      windowDays,
      maxPublications,
      sendEmpty: Boolean(settings.sendEmpty),
    }

    const statsRaw = await fetcher(
      `{
        "total": count(*[_type == "updateSubscriber"]),
        "active": count(*[_type == "updateSubscriber" && ${DELIVERABLE_FILTER}]),
        "optedIn": count(*[_type == "updateSubscriber" && ${DELIVERABLE_FILTER} && "newsletter" in correspondencePreferences && defined(email)]),
        "suppressed": count(*[_type == "updateSubscriber" && deliveryStatus == "suppressed"]),
        "derivedLastSentAt": *[_type == "updateSubscriber" && defined(lastPublicationNewsletterSentAt)] | order(lastPublicationNewsletterSentAt desc)[0].lastPublicationNewsletterSentAt
      }`
    )

    // Eligibility is a property of the run now, not of individual subscribers: either the
    // window has elapsed and everyone opted in receives the issue, or nobody does.
    // Falls back to the newest per-subscriber send for sends that predate the global
    // timestamp, matching the same bootstrap the dispatch uses, so this panel does not
    // promise a send the dispatch would decline.
    const { derivedLastSentAt, ...counts } = statsRaw || {}
    const lastGlobalSentAt =
      parseLastGlobalSentAt(settings) || parseLastGlobalSentAt({ lastGlobalSentAt: derivedLastSentAt })
    const windowElapsed = hasWindowElapsed({ lastGlobalSentAt, windowDays })

    return NextResponse.json(
      {
        ok: true,
        adminEmail: session.email,
        stats: {
          ...counts,
          eligible: windowElapsed ? counts.optedIn || 0 : 0,
          windowElapsed,
          lastSentAt: lastGlobalSentAt ? lastGlobalSentAt.toISOString() : null,
        },
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
  const { session, error, status } = await getSession(request)
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
        'publicationNewsletter.windowDays': updates.windowDays,
        'publicationNewsletter.maxPublications': updates.maxPublications,
        'publicationNewsletter.sendEmpty': updates.sendEmpty,
      })
      // Clears the retired per-subscriber window mode. lastGlobalSentAt is deliberately
      // absent from this patch: it is owned by the dispatch, not editable here.
      .unset(['publicationNewsletter.windowMode'])
      .commit({ returnDocuments: false })

    const refreshed = await writeClient.fetch(
      `*[_type == "siteSettings"][0]{
        publicationNewsletter{
          subjectTemplate,
          introText,
          emptyIntroText,
          outroText,
          signature,
          windowDays,
          maxPublications,
          sendEmpty,
          lastGlobalSentAt
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
