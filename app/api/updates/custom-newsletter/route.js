import { NextResponse } from 'next/server'
import { sanityFetch, writeClient } from '@/lib/sanity'
import { sendEmail } from '@/lib/email'
import { buildCustomNewsletterEmail } from '@/lib/customNewsletterEmailTemplate'
import { buildCorsHeaders, extractBearerToken } from '@/lib/httpUtils'
import { getScopedAdminSession } from '@/lib/adminSessions'
import { getSessionAccess, hasRequiredAccess } from '@/lib/authAccess'
import { ROLE_VALUES, SPECIALTY_VALUES } from '@/lib/communicationOptions'
import { normalizeList, sanitizeString } from '@/lib/inputUtils'
import { filterSubscribersByTestEmails, normalizeUpdateEmailTesting } from '@/lib/updateEmailTesting'
import { isSubscriberDeliverable } from '@/lib/updateSubscriberStatus'
import {
  ALL_THERAPEUTIC_AREAS_VALUE,
  fetchTherapeuticAreas,
  resolveTherapeuticAreaIds,
  resolveTherapeuticAreaLegacyValues,
} from '@/lib/therapeuticAreas'

const CORS_HEADERS = buildCorsHeaders('POST, OPTIONS')

const SITE_BASE_URL = (process.env.SITE_URL || process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000').replace(
  /\/$/,
  ''
)
const NEWSLETTER_PREF = 'newsletter'

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

function normalizeFilterList(values, allowedSet) {
  return normalizeList(values).filter((value) => allowedSet.has(value))
}

function buildManageUrl(token) {
  if (!token) return ''
  return `${SITE_BASE_URL}/updates/manage?token=${encodeURIComponent(token)}`
}

function buildSubscriberQuery({ roles, specialties, interestAreas, legacyInterestAreas }) {
  const roleFilter = roles.length ? ' && role in $roles' : ''
  const specialtyFilter = specialties.length ? ' && specialty in $specialties' : ''
  const interestFilter = interestAreas.length
    ? ' && (allTherapeuticAreas == true || "all" in interestAreas || count(interestAreas[_ref in $interestAreas]) > 0 || count(interestAreas[@ in $legacyInterestAreas]) > 0)'
    : ''

  const query = `
    *[_type == "updateSubscriber"
      && subscriptionStatus == "subscribed"
      && deliveryStatus != "suppressed"
      && "${NEWSLETTER_PREF}" in correspondencePreferences
      && defined(email)
      ${roleFilter}
      ${specialtyFilter}
      ${interestFilter}
    ]{
      _id,
      name,
      email,
      subscriptionStatus,
      deliveryStatus,
      manageToken
    }
  `

  return { query, params: { roles, specialties, interestAreas, legacyInterestAreas } }
}

async function resolveSignature(explicitSignature) {
  const cleaned = sanitizeString(explicitSignature)
  if (cleaned) return cleaned
  const fetcher = writeClient.config().token ? writeClient.fetch.bind(writeClient) : sanityFetch
  const settings = await fetcher(
    `*[_type == "siteSettings"][0]{
      unitName,
      studyUpdates{ signature },
      publicationNewsletter{ signature }
    }`
  )
  return (
    sanitizeString(settings?.publicationNewsletter?.signature) ||
    sanitizeString(settings?.studyUpdates?.signature) ||
    sanitizeString(settings?.unitName) ||
    'London Kidney Clinical Research'
  )
}

async function fetchUpdateEmailTesting() {
  const fetcher = writeClient.config().token ? writeClient.fetch.bind(writeClient) : sanityFetch
  const settings = await fetcher(
    `*[_type == "siteSettings"][0]{
      updateEmailTesting{
        enabled,
        recipients
      }
    }`
  )
  return normalizeUpdateEmailTesting(settings?.updateEmailTesting)
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS })
}

export async function POST(request) {
  const { session, error, status } = await getSession(request)
  if (!session) {
    return NextResponse.json({ ok: false, error }, { status, headers: CORS_HEADERS })
  }

  if (!writeClient.config().token) {
    return NextResponse.json(
      { ok: false, error: 'SANITY_API_TOKEN missing; cannot update send tracking.' },
      { status: 500, headers: CORS_HEADERS }
    )
  }

  let body = {}
  try {
    body = await request.json()
  } catch (error) {
    body = {}
  }

  const subject = sanitizeString(body?.subject)
  const message = typeof body?.message === 'string' ? body.message.trim() : ''
  const dryRun = Boolean(body?.dryRun)
  const filters = body?.filters || {}

  const roles = normalizeFilterList(filters?.roles, ROLE_VALUES)
  const specialties = normalizeFilterList(filters?.specialties, SPECIALTY_VALUES)
  const areas = await fetchTherapeuticAreas()
  const rawInterestAreas = normalizeList(filters?.interestAreas || [])
  const allTherapeuticAreas = rawInterestAreas.includes(ALL_THERAPEUTIC_AREAS_VALUE)
  const interestAreas = allTherapeuticAreas
    ? []
    : resolveTherapeuticAreaIds(rawInterestAreas, areas)
  const legacyInterestAreas = interestAreas.length
    ? resolveTherapeuticAreaLegacyValues(interestAreas, areas)
    : []

  if (!allTherapeuticAreas && rawInterestAreas.length && !interestAreas.length) {
    return NextResponse.json(
      { ok: false, error: 'Please select at least one valid interest area.' },
      { status: 400, headers: CORS_HEADERS }
    )
  }

  if (!dryRun) {
    if (!subject) {
      return NextResponse.json({ ok: false, error: 'Subject is required.' }, { status: 400, headers: CORS_HEADERS })
    }
    if (!message) {
      return NextResponse.json({ ok: false, error: 'Message is required.' }, { status: 400, headers: CORS_HEADERS })
    }
  }

  try {
    const { query, params } = buildSubscriberQuery({
      roles,
      specialties,
      interestAreas,
      legacyInterestAreas,
    })
    const [subscribersRaw, testSettings] = await Promise.all([
      writeClient.fetch(query, params),
      fetchUpdateEmailTesting(),
    ])
    let subscribers = Array.isArray(subscribersRaw) ? subscribersRaw : []
    if (testSettings.enabled) {
      subscribers = filterSubscribersByTestEmails(subscribers, testSettings.recipients)
    }
    const deliverableSubscribers = subscribers.filter((subscriber) => isSubscriberDeliverable(subscriber))

    if (dryRun) {
      return NextResponse.json(
        {
          ok: true,
          count: deliverableSubscribers.length,
          testMode: testSettings.enabled,
          testRecipients: testSettings.recipients.length,
        },
        { headers: CORS_HEADERS }
      )
    }

    if (!testSettings.enabled || testSettings.recipients.length === 0) {
      return NextResponse.json(
        {
          ok: false,
          error: 'Update email sending is locked. Enable test mode and add at least one test recipient.',
        },
        { status: 409, headers: CORS_HEADERS }
      )
    }

    const signature = await resolveSignature(body?.signature)

    const stats = {
      total: deliverableSubscribers.length,
      sent: 0,
      skipped: 0,
      errors: 0,
    }
    if (testSettings.enabled) {
      stats.testMode = true
      stats.testRecipients = testSettings.recipients.length
    }
    const errors = []
    const nowIso = new Date().toISOString()

    for (const subscriber of deliverableSubscribers) {
      const manageUrl = buildManageUrl(subscriber?.manageToken)
      const email = buildCustomNewsletterEmail({
        subscriber,
        subject,
        message,
        manageUrl,
        signature,
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
          .set({ lastNewsletterSentAt: nowIso })
          .commit({ returnDocuments: false })
        stats.sent += 1
      } catch (err) {
        stats.errors += 1
        errors.push({
          email: subscriber.email,
          message: err?.message || 'Failed to send',
        })
      }
    }

    return NextResponse.json(
      { ok: true, stats, errors: errors.slice(0, 8) },
      { headers: CORS_HEADERS }
    )
  } catch (err) {
    console.error('[custom-newsletter] send failed', err)
    return NextResponse.json(
      { ok: false, error: err?.message || 'Failed to send newsletter.' },
      { status: 500, headers: CORS_HEADERS }
    )
  }
}

export const dynamic = 'force-dynamic'
