import { NextResponse } from 'next/server'
import { sanityFetch, writeClient } from '@/lib/sanity'
import { getScopedAdminSession } from '@/lib/adminSessions'
import { getSessionAccess, hasRequiredAccess } from '@/lib/authAccess'
import { buildCorsHeaders, extractBearerToken } from '@/lib/httpUtils'
import { isResearchDigestPublicEnabled } from '@/lib/researchDigestPublic'
import { buildSiteOptions, fetchSites } from '@/lib/sites'
import {
  SubscriberAdminError,
  createSubscriber,
  deleteSubscriber,
  listSubscribers,
  updateSubscriber,
} from '@/lib/subscriberAdminStore'
import { buildTherapeuticAreaOptions, fetchTherapeuticAreas } from '@/lib/therapeuticAreas'

const CORS_HEADERS = buildCorsHeaders('GET, POST, PATCH, DELETE, OPTIONS')

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

function clampNumber(value, fallback, min, max) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(Math.max(parsed, min), max)
}

function respondError(error, status, extra = {}) {
  return NextResponse.json({ ok: false, error, ...extra }, { status, headers: CORS_HEADERS })
}

function isJsonRequest(request) {
  return String(request.headers.get('content-type') || '').toLowerCase().includes('application/json')
}

async function readJson(request) {
  try {
    return await request.json()
  } catch {
    return null
  }
}

// Only active interest areas and research sites can be chosen, as on the public form.
async function fetchChoiceIds() {
  const [areas, sites] = await Promise.all([fetchTherapeuticAreas(), fetchSites()])
  return {
    areaIds: areas.map((area) => area?._id).filter(Boolean),
    siteIds: sites.map((site) => site?._id).filter(Boolean),
  }
}

function handleWriteError(error, label) {
  if (error instanceof SubscriberAdminError) {
    return respondError(error.message, error.statusCode, {
      ...(error.code ? { code: error.code } : {}),
      ...(error.existingId ? { existingId: error.existingId } : {}),
    })
  }
  console.error(`[updates-admin-subscribers] ${label} failed`, error)
  return respondError(error?.message || 'Failed to save the subscriber.', 500)
}

async function requireWriteSession(request) {
  const { session, error, status } = await getSession(request)
  if (!session) return { response: respondError(error, status) }
  if (!writeClient.config().token) {
    return { response: respondError('SANITY_API_TOKEN missing; cannot update subscribers.', 500) }
  }
  return { session }
}

// Sanity's history shows every portal edit as the API token, so log who made it. Subscriber
// addresses stay out of the logs; the record id is enough to find the change.
function logChange(action, session, details) {
  console.info('[updates-admin-subscribers]', JSON.stringify({ action, by: session.email, ...details }))
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS })
}

export async function GET(request) {
  const { session, error, status } = await getSession(request)
  if (!session) return respondError(error, status)

  const { searchParams } = new URL(request.url)
  const limit = clampNumber(searchParams.get('limit'), 200, 25, 5000)
  const offset = clampNumber(searchParams.get('offset'), 0, 0, 100000)

  try {
    const canWrite = Boolean(writeClient.config().token)
    const fetchClient = canWrite ? writeClient : { fetch: sanityFetch }
    const [subscribers, areas, sites, settings] = await Promise.all([
      listSubscribers(fetchClient),
      fetchTherapeuticAreas(),
      fetchSites(),
      sanityFetch(`*[_type == "siteSettings" && !(_id in path("drafts.**"))][0]{ researchDigest{ publicEnabled } }`),
    ])

    return NextResponse.json(
      {
        ok: true,
        canWrite,
        total: subscribers.length,
        offset,
        limit,
        items: subscribers.slice(offset, offset + limit),
        options: {
          therapeuticAreas: buildTherapeuticAreaOptions(areas, { includeAll: false }),
          sites: buildSiteOptions(sites),
          researchDigestPublic: isResearchDigestPublicEnabled(settings || {}),
        },
      },
      { headers: CORS_HEADERS }
    )
  } catch (err) {
    console.error('[updates-admin-subscribers] GET failed', err)
    return respondError(err?.message || 'Failed to load subscribers.', 500)
  }
}

export async function POST(request) {
  const { session, response } = await requireWriteSession(request)
  if (response) return response
  if (!isJsonRequest(request)) return respondError('Send the subscriber as JSON.', 415)

  const body = await readJson(request)
  if (!body) return respondError('Invalid JSON payload.', 400)

  try {
    const subscriber = await createSubscriber(writeClient, {
      input: body.subscriber,
      consentConfirmed: body.consentConfirmed === true,
      adminEmail: session.email,
      ...(await fetchChoiceIds()),
    })
    logChange('create', session, { id: subscriber._id })
    return NextResponse.json({ ok: true, subscriber }, { status: 201, headers: CORS_HEADERS })
  } catch (error) {
    return handleWriteError(error, 'POST')
  }
}

export async function PATCH(request) {
  const { session, response } = await requireWriteSession(request)
  if (response) return response
  if (!isJsonRequest(request)) return respondError('Send the change as JSON.', 415)

  const body = await readJson(request)
  if (!body) return respondError('Invalid JSON payload.', 400)

  try {
    const result = await updateSubscriber(writeClient, {
      id: body.id,
      rev: body.rev,
      changes: body.changes,
      consentConfirmed: body.consentConfirmed === true,
      ...(await fetchChoiceIds()),
    })
    logChange('update', session, {
      id: result.subscriber._id,
      fields: Object.keys(body.changes || {}),
      statusFrom: result.before.status,
      statusTo: result.subscriber.status,
    })
    return NextResponse.json({ ok: true, subscriber: result.subscriber }, { headers: CORS_HEADERS })
  } catch (error) {
    return handleWriteError(error, 'PATCH')
  }
}

export async function DELETE(request) {
  const { session, response } = await requireWriteSession(request)
  if (response) return response

  const { searchParams } = new URL(request.url)
  try {
    const removed = await deleteSubscriber(writeClient, { id: searchParams.get('id') })
    logChange('delete', session, { id: removed._id })
    return NextResponse.json({ ok: true, id: removed._id }, { headers: CORS_HEADERS })
  } catch (error) {
    return handleWriteError(error, 'DELETE')
  }
}

export const dynamic = 'force-dynamic'
