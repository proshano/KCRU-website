import { NextResponse } from 'next/server'
import { sanityFetch, writeClient } from '@/lib/sanity'
import { sanitizeString } from '@/lib/studySubmissions'
import { getScopedAdminSession } from '@/lib/adminSessions'
import { buildCorsHeaders, extractBearerToken } from '@/lib/httpUtils'
import { getZonedParts } from '@/lib/cronUtils'

const CORS_HEADERS = buildCorsHeaders('GET, PATCH, OPTIONS')

const CRON_TIMEZONE = process.env.CRON_TIMEZONE || 'America/New_York'

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
  const subjectTemplate = sanitizeString(body?.subjectTemplate) || null
  const introText = sanitizeString(body?.introText) || null
  const emptyIntroText = sanitizeString(body?.emptyIntroText) || null
  const outroText = sanitizeString(body?.outroText) || null
  const signature = sanitizeString(body?.signature) || null
  const maxStudiesRaw = Number(body?.maxStudies)
  const maxStudies = Number.isFinite(maxStudiesRaw) && maxStudiesRaw > 0
    ? Math.min(Math.round(maxStudiesRaw), 12)
    : null
  const sendEmpty = Boolean(body?.sendEmpty)

  return {
    subjectTemplate,
    introText,
    emptyIntroText,
    outroText,
    signature,
    maxStudies,
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
    const monthStartIso = getMonthStartIso()
    const fetcher = writeClient.config().token
      ? (query, params) => writeClient.fetch(query, params)
      : sanityFetch

    const [statsRaw, settingsRaw] = await Promise.all([
      fetcher(
        `{
          "total": count(*[_type == "updateSubscriber"]),
          "active": count(*[_type == "updateSubscriber" && status == "active"]),
          "optedIn": count(*[_type == "updateSubscriber" && status == "active" && "study_updates" in correspondencePreferences && defined(email)]),
          "eligible": count(*[_type == "updateSubscriber" && status == "active" && "study_updates" in correspondencePreferences && defined(email) && (!defined(lastStudyUpdateSentAt) || lastStudyUpdateSentAt < $monthStartIso)]),
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
          }
        }`
      ),
    ])

    return NextResponse.json(
      {
        ok: true,
        adminEmail: session.email,
        stats: statsRaw || {},
        settings: settingsRaw?.studyUpdates || {},
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
        'studyUpdates.subjectTemplate': updates.subjectTemplate,
        'studyUpdates.introText': updates.introText,
        'studyUpdates.emptyIntroText': updates.emptyIntroText,
        'studyUpdates.outroText': updates.outroText,
        'studyUpdates.signature': updates.signature,
        'studyUpdates.maxStudies': updates.maxStudies,
        'studyUpdates.sendEmpty': updates.sendEmpty,
      })
      .commit({ returnDocuments: false })

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
        }
      }`
    )

    return NextResponse.json(
      { ok: true, settings: refreshed?.studyUpdates || {} },
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
