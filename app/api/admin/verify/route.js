import { NextResponse } from 'next/server'
import { writeClient } from '@/lib/sanity'
import { sanitizeString } from '@/lib/studySubmissions'
import {
  getAdminAccess,
  getAdminEmails,
  getAdminScopeLabel,
  normalizeAdminScope,
  verifyAdminPasscode,
} from '@/lib/adminSessions'
import { buildCorsHeaders } from '@/lib/httpUtils'
import { getSanityWriteErrorMessage } from '@/lib/sanityErrors'

const CORS_HEADERS = buildCorsHeaders('POST, OPTIONS')

const SESSION_TTL_HOURS = 72

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS })
}

export async function POST(request) {
  if (!writeClient.config().token) {
    return NextResponse.json(
      { ok: false, error: 'SANITY_API_TOKEN missing; cannot verify session.' },
      { status: 500, headers: CORS_HEADERS }
    )
  }

  try {
    const body = await request.json()
    const email = sanitizeString(body?.email).toLowerCase()
    const code = sanitizeString(body?.code)
    const scope = normalizeAdminScope(body?.scope)
    const scopeLabel = getAdminScopeLabel(scope)
    if (!email || !code) {
      return NextResponse.json(
        { ok: false, error: 'Email and passcode are required.' },
        { status: 400, headers: CORS_HEADERS }
      )
    }

    const admins = await getAdminEmails(scope)
    if (!admins.length) {
      return NextResponse.json(
        { ok: false, error: 'No admin emails configured in Sanity.' },
        { status: 400, headers: CORS_HEADERS }
      )
    }

    if (!admins.includes(email)) {
      return NextResponse.json(
        { ok: false, error: `Email not authorized for ${scopeLabel} access.` },
        { status: 403, headers: CORS_HEADERS }
      )
    }

    const result = await verifyAdminPasscode({ email, code, sessionTtlHours: SESSION_TTL_HOURS })
    const access = await getAdminAccess(result.email)
    return NextResponse.json(
      { ok: true, token: result.token, email: result.email, access },
      { headers: CORS_HEADERS }
    )
  } catch (error) {
    console.error('[admin-verify] failed', error)
    return NextResponse.json(
      {
        ok: false,
        error: getSanityWriteErrorMessage(error, {
          fallback: 'Failed to verify passcode.',
          context: 'Admin sign-in',
        }),
      },
      { status: 500, headers: CORS_HEADERS }
    )
  }
}

export const dynamic = 'force-dynamic'
