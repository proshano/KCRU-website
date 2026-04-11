import { NextResponse } from 'next/server'
import crypto from 'crypto'
import {
  emailMatchesCoordinatorDomain,
  formatCoordinatorDomains,
  getCoordinatorDomains,
} from '@/lib/coordinatorDomains'
import { sanityFetch, writeClient } from '@/lib/sanity'
import { sanitizeString } from '@/lib/studySubmissions'
import { buildCorsHeaders } from '@/lib/httpUtils'
import { getSanityWriteErrorMessage } from '@/lib/sanityErrors'

const CORS_HEADERS = buildCorsHeaders('POST, OPTIONS')

const SESSION_TTL_HOURS = 8

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

    const domains = await getCoordinatorDomains()
    if (!emailMatchesCoordinatorDomain(email, domains)) {
      return NextResponse.json(
        { ok: false, error: `Email must be at one of: ${formatCoordinatorDomains(domains)}.` },
        { status: 403, headers: CORS_HEADERS }
      )
    }

    const session = await sanityFetch(
      `*[_type == "studyCoordinatorSession" && email == $email && revoked != true] | order(createdAt desc)[0]{
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
    console.error('[manage-verify] failed', error)
    return NextResponse.json(
      {
        ok: false,
        error: getSanityWriteErrorMessage(error, {
          fallback: 'Failed to verify passcode.',
        }),
      },
      { status: 500, headers: CORS_HEADERS }
    )
  }
}

export const dynamic = 'force-dynamic'
