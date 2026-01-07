import { NextResponse } from 'next/server'
import { getAdminAccess, getScopedAdminSession } from '@/lib/adminSessions'
import { getSessionAccess, hasRequiredAccess } from '@/lib/authAccess'
import { buildCorsHeaders, extractBearerToken } from '@/lib/httpUtils'

const CORS_HEADERS = buildCorsHeaders('GET, OPTIONS')

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS })
}

export async function GET(request) {
  const sessionAccess = await getSessionAccess()
  if (sessionAccess) {
    if (!hasRequiredAccess(sessionAccess.access, { admin: true })) {
      return NextResponse.json(
        { ok: false, error: 'Not authorized for admin access.' },
        { status: 403, headers: CORS_HEADERS }
      )
    }
    return NextResponse.json(
      {
        ok: true,
        email: sessionAccess.email,
        access: {
          approvals: Boolean(sessionAccess.access.approvals),
          updates: Boolean(sessionAccess.access.updates),
        },
      },
      { headers: CORS_HEADERS }
    )
  }

  const token = extractBearerToken(request)
  const { session, error, status } = await getScopedAdminSession(token, { scope: 'any' })
  if (!session) {
    return NextResponse.json({ ok: false, error }, { status, headers: CORS_HEADERS })
  }

  const access = await getAdminAccess(session.email)
  return NextResponse.json(
    { ok: true, email: session.email, access },
    { headers: CORS_HEADERS }
  )
}

export const dynamic = 'force-dynamic'
