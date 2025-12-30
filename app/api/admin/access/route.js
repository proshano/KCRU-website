import { NextResponse } from 'next/server'
import { getAdminAccess, getScopedAdminSession } from '@/lib/adminSessions'
import { buildCorsHeaders, extractBearerToken } from '@/lib/httpUtils'

const CORS_HEADERS = buildCorsHeaders('GET, OPTIONS')

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS })
}

export async function GET(request) {
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
