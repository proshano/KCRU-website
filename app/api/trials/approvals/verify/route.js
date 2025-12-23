import { NextResponse } from 'next/server'
import crypto from 'crypto'
import { sanityFetch, writeClient } from '@/lib/sanity'
import { sanitizeString } from '@/lib/studySubmissions'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

const SESSION_TTL_HOURS = 8

async function getApprovalAdmins() {
  const settings = await sanityFetch(`
    *[_type == "siteSettings"][0]{
      "admins": studyApprovals.admins
    }
  `)
  return (settings?.admins || []).map((email) => String(email).trim().toLowerCase()).filter(Boolean)
}

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
    if (!email || !code) {
      return NextResponse.json(
        { ok: false, error: 'Email and passcode are required.' },
        { status: 400, headers: CORS_HEADERS }
      )
    }

    const admins = await getApprovalAdmins()
    if (!admins.length) {
      return NextResponse.json(
        { ok: false, error: 'No approval admins configured in Sanity.' },
        { status: 400, headers: CORS_HEADERS }
      )
    }

    if (!admins.includes(email)) {
      return NextResponse.json(
        { ok: false, error: 'Email not authorized for approvals.' },
        { status: 403, headers: CORS_HEADERS }
      )
    }

    const session = await sanityFetch(
      `*[_type == "studyApprovalSession" && email == $email && revoked != true] | order(createdAt desc)[0]{
        _id,
        codeHash,
        codeExpiresAt,
        codeUsedAt
      }`,
      { email }
    )

    if (!session?._id || !session.codeHash) {
      return NextResponse.json(
        { ok: false, error: 'Passcode not found. Request a new code.' },
        { status: 400, headers: CORS_HEADERS }
      )
    }

    if (session.codeUsedAt) {
      return NextResponse.json(
        { ok: false, error: 'Passcode already used. Request a new code.' },
        { status: 400, headers: CORS_HEADERS }
      )
    }

    if (session.codeExpiresAt && Date.parse(session.codeExpiresAt) < Date.now()) {
      return NextResponse.json(
        { ok: false, error: 'Passcode expired. Request a new code.' },
        { status: 400, headers: CORS_HEADERS }
      )
    }

    const codeHash = crypto.createHash('sha256').update(code).digest('hex')
    if (codeHash !== session.codeHash) {
      return NextResponse.json(
        { ok: false, error: 'Invalid passcode.' },
        { status: 401, headers: CORS_HEADERS }
      )
    }

    const token = crypto.randomBytes(32).toString('hex')
    const expiresAt = new Date(Date.now() + SESSION_TTL_HOURS * 60 * 60 * 1000).toISOString()

    await writeClient
      .patch(session._id)
      .set({
        token,
        expiresAt,
        codeUsedAt: new Date().toISOString(),
      })
      .commit({ returnDocuments: false })

    return NextResponse.json({ ok: true, token, email }, { headers: CORS_HEADERS })
  } catch (error) {
    console.error('[approvals-verify] failed', error)
    return NextResponse.json(
      { ok: false, error: error?.message || 'Failed to verify passcode.' },
      { status: 500, headers: CORS_HEADERS }
    )
  }
}

export const dynamic = 'force-dynamic'
