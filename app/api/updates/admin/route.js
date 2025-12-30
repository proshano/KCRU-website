import { NextResponse } from 'next/server'
import { sanityFetch, writeClient } from '@/lib/sanity'
import { sanitizeString } from '@/lib/studySubmissions'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, PATCH, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

const CRON_TIMEZONE = process.env.CRON_TIMEZONE || 'America/New_York'

function extractToken(request) {
  const header = request.headers.get('authorization') || ''
  if (!header) return ''
  if (header.startsWith('Bearer ')) return header.slice(7)
  return header
}

async function getSession(token) {
  if (!token) return null
  const session = await sanityFetch(
    `*[_type == "studyUpdateAdminSession" && token == $token][0]{ _id, email, expiresAt, revoked }`,
    { token }
  )
  if (!session || session.revoked) return null
  if (session.expiresAt && Date.parse(session.expiresAt) < Date.now()) return null
  return session
}

function getZonedParts(date, timeZone) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
  const parts = fmt.formatToParts(date)
  const map = {}
  for (const p of parts) {
    if (p.type !== 'literal') map[p.type] = p.value
  }
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
  }
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

  return {
    subjectTemplate,
    introText,
    emptyIntroText,
    outroText,
    signature,
    maxStudies,
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS })
}

export async function GET(request) {
  const token = extractToken(request)
  const session = await getSession(token)
  if (!session) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401, headers: CORS_HEADERS })
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
            maxStudies
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
  const token = extractToken(request)
  const session = await getSession(token)
  if (!session) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401, headers: CORS_HEADERS })
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
          maxStudies
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
