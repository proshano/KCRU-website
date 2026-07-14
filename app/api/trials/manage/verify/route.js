import { NextResponse } from 'next/server'
import crypto from 'crypto'
import { getConfiguredAuthAccess } from '@/lib/configuredAuthAccess'
import { sanityFetch, writeClient } from '@/lib/sanity'
import { sanitizeString } from '@/lib/studySubmissions'
import { buildCorsHeaders } from '@/lib/httpUtils'
import { getSanityWriteErrorMessage } from '@/lib/sanityErrors'
import { getRateLimitResponseDetails, SecurityRateLimitError } from '@/lib/securityRateLimit'

const CORS_HEADERS = buildCorsHeaders('POST, OPTIONS')

const SESSION_TTL_HOURS = 8
const PASSCODE_MAX_ATTEMPTS = 5

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

    const access = await getConfiguredAuthAccess(email)
    if (!access.allowed || !access.coordinator) {
      return NextResponse.json(
        { ok: false, error: 'Email is not authorized for study management.' },
        { status: 403, headers: CORS_HEADERS }
      )
    }

    const session = await sanityFetch(
      `*[_type == "studyCoordinatorSession" && email == $email && revoked != true] | order(createdAt desc)[0]{
        _id,
        codeHash,
        codeExpiresAt,
        codeUsedAt,
        failedAttempts,
        passcodeLockedAt
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

    if (session.passcodeLockedAt || Number(session.failedAttempts || 0) >= PASSCODE_MAX_ATTEMPTS) {
      throw new SecurityRateLimitError('Too many invalid passcodes. Request a new code.', 60)
    }

    const codeHash = crypto.createHash('sha256').update(code).digest('hex')
    const supplied = Buffer.from(codeHash, 'hex')
    const expected = Buffer.from(session.codeHash, 'hex')
    if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) {
      const failedAttempts = Number(session.failedAttempts || 0) + 1
      const patch = writeClient.patch(session._id).setIfMissing({ failedAttempts: 0 }).inc({ failedAttempts: 1 })
      if (failedAttempts >= PASSCODE_MAX_ATTEMPTS) {
        patch.set({ passcodeLockedAt: new Date().toISOString() })
      }
      await patch.commit({ returnDocuments: false })
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
    const rateLimit = getRateLimitResponseDetails(error)
    if (rateLimit) {
      return NextResponse.json(
        { ok: false, error: rateLimit.message },
        { status: rateLimit.status, headers: { ...CORS_HEADERS, 'Retry-After': String(rateLimit.retryAfter) } }
      )
    }
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
