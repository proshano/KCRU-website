import { NextResponse } from 'next/server'
import { sanityFetch, writeClient, queries } from '@/lib/sanity'
import { sanitizeString } from '@/lib/studySubmissions'
import { getScopedAdminSession } from '@/lib/adminSessions'
import { buildCorsHeaders, extractBearerToken } from '@/lib/httpUtils'
import { getZonedParts } from '@/lib/cronUtils'
import { normalizeTestEmailList, normalizeUpdateEmailTesting } from '@/lib/updateEmailTesting'

const CORS_HEADERS = buildCorsHeaders('GET, PATCH, OPTIONS')

const CRON_TIMEZONE = process.env.CRON_TIMEZONE || 'America/New_York'
const SUBSCRIBED_FILTER = 'subscriptionStatus == "subscribed"'
const DELIVERABLE_FILTER = `${SUBSCRIBED_FILTER} && deliveryStatus != "suppressed"`

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value || {}, key)
}

async function getSession(token) {
  return getScopedAdminSession(token, { scope: 'updates' })
}

function getMonthStartIso() {
  const now = new Date()
  const parts = getZonedParts(now, CRON_TIMEZONE)
  const startUtc = new Date(Date.UTC(parts.year, parts.month - 1, 1, 0, 0, 0))
  return startUtc.toISOString()
}

function normalizeSettingsPayload(body) {
  const payload = {}
  if (hasOwn(body, 'subjectTemplate')) {
    payload.subjectTemplate = sanitizeString(body.subjectTemplate) || null
  }
  if (hasOwn(body, 'introText')) {
    payload.introText = sanitizeString(body.introText) || null
  }
  if (hasOwn(body, 'emptyIntroText')) {
    payload.emptyIntroText = sanitizeString(body.emptyIntroText) || null
  }
  if (hasOwn(body, 'outroText')) {
    payload.outroText = sanitizeString(body.outroText) || null
  }
  if (hasOwn(body, 'signature')) {
    payload.signature = sanitizeString(body.signature) || null
  }
  if (hasOwn(body, 'maxStudies')) {
    const maxStudiesRaw = Number(body.maxStudies)
    payload.maxStudies = Number.isFinite(maxStudiesRaw) && maxStudiesRaw > 0
      ? Math.min(Math.round(maxStudiesRaw), 12)
      : null
  }
  if (hasOwn(body, 'sendEmpty')) {
    payload.sendEmpty = Boolean(body.sendEmpty)
  }

  return payload
}

function normalizeTestSettingsPayload(body) {
  if (!body || typeof body !== 'object') return {}
  const payload = {}
  if (hasOwn(body, 'enabled')) {
    payload.enabled = Boolean(body.enabled)
  }
  if (hasOwn(body, 'recipients')) {
    payload.recipients = normalizeTestEmailList(body.recipients)
  }
  return payload
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
    const monthStartIso = getMonthStartIso()
    const fetcher = writeClient.config().token
      ? (query, params) => writeClient.fetch(query, params)
      : sanityFetch

    const [statsRaw, settingsRaw, areasRaw] = await Promise.all([
      fetcher(
        `{
          "total": count(*[_type == "updateSubscriber"]),
          "active": count(*[_type == "updateSubscriber" && ${DELIVERABLE_FILTER}]),
          "optedIn": count(*[_type == "updateSubscriber" && ${DELIVERABLE_FILTER} && "study_updates" in correspondencePreferences && defined(email)]),
          "eligible": count(*[_type == "updateSubscriber" && ${DELIVERABLE_FILTER} && "study_updates" in correspondencePreferences && defined(email) && (!defined(lastStudyUpdateSentAt) || lastStudyUpdateSentAt < $monthStartIso)]),
          "suppressed": count(*[_type == "updateSubscriber" && deliveryStatus == "suppressed"]),
          "lastSentAt": *[_type == "updateSubscriber" && defined(lastStudyUpdateSentAt)] | order(lastStudyUpdateSentAt desc)[0].lastStudyUpdateSentAt
        }`,
        { monthStartIso }
      ),
      fetcher(
        `*[_type == "siteSettings"][0]{
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
        }`
      ),
      fetcher(queries.therapeuticAreasMinimal),
    ])

    return NextResponse.json(
      {
        ok: true,
        adminEmail: session.email,
        stats: statsRaw || {},
        settings: settingsRaw?.studyUpdates || {},
        testSettings: normalizeUpdateEmailTesting(settingsRaw?.updateEmailTesting),
        therapeuticAreas: areasRaw || [],
      },
      { headers: CORS_HEADERS }
    )
  } catch (error) {
    console.error('[updates-admin] GET failed', error)
    return NextResponse.json(
      { ok: false, error: error?.message || 'Failed to load study update admin data.' },
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
    const testUpdates = normalizeTestSettingsPayload(body?.updateEmailTesting)

    const settingsDoc = await writeClient.fetch(`*[_type == "siteSettings"][0]{ _id }`)
    if (!settingsDoc?._id) {
      return NextResponse.json(
        { ok: false, error: 'Site settings not found.' },
        { status: 500, headers: CORS_HEADERS }
      )
    }

    const patch = {}
    if (updates.subjectTemplate !== undefined) {
      patch['studyUpdates.subjectTemplate'] = updates.subjectTemplate
    }
    if (updates.introText !== undefined) {
      patch['studyUpdates.introText'] = updates.introText
    }
    if (updates.emptyIntroText !== undefined) {
      patch['studyUpdates.emptyIntroText'] = updates.emptyIntroText
    }
    if (updates.outroText !== undefined) {
      patch['studyUpdates.outroText'] = updates.outroText
    }
    if (updates.signature !== undefined) {
      patch['studyUpdates.signature'] = updates.signature
    }
    if (updates.maxStudies !== undefined) {
      patch['studyUpdates.maxStudies'] = updates.maxStudies
    }
    if (updates.sendEmpty !== undefined) {
      patch['studyUpdates.sendEmpty'] = updates.sendEmpty
    }
    if (testUpdates.enabled !== undefined) {
      patch['updateEmailTesting.enabled'] = testUpdates.enabled
    }
    if (testUpdates.recipients !== undefined) {
      patch['updateEmailTesting.recipients'] = testUpdates.recipients
    }

    if (!Object.keys(patch).length) {
      return NextResponse.json(
        { ok: false, error: 'No settings provided.' },
        { status: 400, headers: CORS_HEADERS }
      )
    }

    await writeClient.patch(settingsDoc._id).set(patch).commit({ returnDocuments: false })

    const refreshed = await writeClient.fetch(
      `*[_type == "siteSettings"][0]{
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
      }`
    )

    return NextResponse.json(
      {
        ok: true,
        settings: refreshed?.studyUpdates || {},
        testSettings: normalizeUpdateEmailTesting(refreshed?.updateEmailTesting),
      },
      { headers: CORS_HEADERS }
    )
  } catch (error) {
    console.error('[updates-admin] PATCH failed', error)
    return NextResponse.json(
      { ok: false, error: error?.message || 'Failed to update settings.' },
      { status: 500, headers: CORS_HEADERS }
    )
  }
}

export const dynamic = 'force-dynamic'
