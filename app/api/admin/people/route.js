import { NextResponse } from 'next/server'

import { getAdminAccess, getScopedAdminSession } from '@/lib/adminSessions'
import { getSessionAccess, hasRequiredAccess } from '@/lib/authAccess'
import { buildCorsHeaders, extractBearerToken } from '@/lib/httpUtils'
import { sanitizeString } from '@/lib/inputUtils'
import { extractEmailAddresses } from '@/lib/peopleSettings'
import { PeopleSettingsError, buildPeopleView, fetchPeopleSettings, updatePeopleField } from '@/lib/peopleSettingsStore'
import { sanityFetch, writeClient } from '@/lib/sanity'

const CORS_HEADERS = buildCorsHeaders('GET, PATCH, OPTIONS')

// Any admin can see the lists; each PATCH is checked against the group that owns the setting.
async function getPeopleSession(request) {
  const sessionAccess = await getSessionAccess()
  if (sessionAccess) {
    if (hasRequiredAccess(sessionAccess.access, { admin: true })) {
      return { session: { email: sessionAccess.email, access: sessionAccess.access }, status: 200 }
    }
    return { session: null, error: 'Not authorized for admin access.', status: 403 }
  }

  const token = extractBearerToken(request)
  const { session, error, status } = await getScopedAdminSession(token, { scope: 'any' })
  if (!session) return { session: null, error, status }
  const access = await getAdminAccess(session.email)
  return {
    session: { email: sanitizeString(session.email).toLowerCase(), access: { admin: true, ...access } },
    status: 200,
  }
}

function serverPilotRecipients() {
  return extractEmailAddresses(process.env.RESEARCH_DIGEST_PILOT_EMAILS || '').emails
}

async function loadView(client, access) {
  const documents = await fetchPeopleSettings(client)
  return buildPeopleView(documents, { access, serverPilotRecipients: serverPilotRecipients() })
}

function respondError(message, status) {
  return NextResponse.json({ ok: false, error: message }, { status, headers: CORS_HEADERS })
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS })
}

export async function GET(request) {
  const { session, error, status } = await getPeopleSession(request)
  if (!session) return respondError(error, status)

  try {
    const canWrite = Boolean(writeClient.config().token)
    const view = await loadView(canWrite ? writeClient : { fetch: sanityFetch }, session.access)
    return NextResponse.json(
      {
        ok: true,
        adminEmail: session.email,
        access: { approvals: Boolean(session.access.approvals), updates: Boolean(session.access.updates) },
        canWrite,
        ...view,
      },
      { headers: CORS_HEADERS }
    )
  } catch (requestError) {
    console.error('[people-admin] GET failed', requestError)
    return respondError(requestError?.message || 'Failed to load people and email lists.', 500)
  }
}

export async function PATCH(request) {
  const { session, error, status } = await getPeopleSession(request)
  if (!session) return respondError(error, status)

  // Access lists are the most sensitive settings in the app, so only accept the JSON the
  // portal sends (a cross-site form post cannot set this content type).
  if (!String(request.headers.get('content-type') || '').toLowerCase().includes('application/json')) {
    return respondError('Send the change as JSON.', 415)
  }
  if (!writeClient.config().token) {
    return respondError('SANITY_API_TOKEN missing; cannot save changes.', 500)
  }

  let body
  try {
    body = await request.json()
  } catch {
    return respondError('Invalid JSON payload.', 400)
  }

  const key = sanitizeString(body?.field)
  try {
    const result = await updatePeopleField(writeClient, {
      key,
      value: body?.value,
      previous: body?.previous,
      access: session.access,
      editorEmail: session.email,
    })
    if (result.changed) {
      // Sanity's history shows every portal edit as the API token, so log who made it.
      console.info('[people-admin] setting changed', JSON.stringify({
        field: key,
        by: session.email,
        change: result.change,
        draftUpdated: Boolean(result.draftUpdated),
      }))
    }
    const view = await loadView(writeClient, session.access)
    return NextResponse.json(
      {
        ok: true,
        changed: result.changed,
        draftUpdated: Boolean(result.draftUpdated),
        adminEmail: session.email,
        access: { approvals: Boolean(session.access.approvals), updates: Boolean(session.access.updates) },
        canWrite: true,
        ...view,
      },
      { headers: CORS_HEADERS }
    )
  } catch (requestError) {
    if (requestError instanceof PeopleSettingsError) {
      return respondError(requestError.message, requestError.statusCode)
    }
    console.error('[people-admin] PATCH failed', requestError)
    return respondError(requestError?.message || 'Failed to save the change.', 500)
  }
}

export const dynamic = 'force-dynamic'
