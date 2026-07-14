import { NextResponse } from 'next/server'
import crypto from 'crypto'
import { getConfiguredAuthAccess } from '@/lib/configuredAuthAccess'
import { writeClient } from '@/lib/sanity'
import { sendEmail } from '@/lib/email'
import { sanitizeString } from '@/lib/studySubmissions'
import { buildCorsHeaders } from '@/lib/httpUtils'
import { getSanityWriteErrorMessage } from '@/lib/sanityErrors'
import { claimSecurityRateLimit, getRateLimitResponseDetails } from '@/lib/securityRateLimit'

const CORS_HEADERS = buildCorsHeaders('POST, OPTIONS')

const CODE_TTL_MINUTES = 10

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS })
}

export async function POST(request) {
  if (!writeClient.config().token) {
    return NextResponse.json(
      { ok: false, error: 'SANITY_API_TOKEN missing; cannot create session.' },
      { status: 500, headers: CORS_HEADERS }
    )
  }

  try {
    const body = await request.json()
    const email = sanitizeString(body?.email).toLowerCase()
    if (!email) {
      return NextResponse.json(
        { ok: false, error: 'Email is required.' },
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

    await claimSecurityRateLimit({
      namespace: 'coordinator-passcode-send',
      key: email,
      limit: 5,
      windowMs: 60 * 60 * 1000,
      minimumIntervalMs: 60 * 1000,
    })

    const code = String(crypto.randomInt(100000, 1000000))
    const codeHash = crypto.createHash('sha256').update(code).digest('hex')
    const createdAt = new Date().toISOString()
    const codeExpiresAt = new Date(Date.now() + CODE_TTL_MINUTES * 60 * 1000).toISOString()

    await writeClient.create({
      _type: 'studyCoordinatorSession',
      email,
      codeHash,
      codeExpiresAt,
      createdAt,
      failedAttempts: 0,
      revoked: false,
    })

    const portalLabel = 'Study Manager'
    const subject = 'London Kidney Clinical Research  - Portal access'
    const text = [
      'London Kidney Clinical Research',
      '',
      `Your verification code for the ${portalLabel} portal is:`,
      code,
      '',
      `This code expires in ${CODE_TTL_MINUTES} minutes.`,
      '',
      "If you didn't request this code, you can safely ignore this email.",
      '',
      '--',
      'London Kidney Clinical Research',
    ].join('\n')
    const html = `
      <div style="font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; font-size: 14px; color: #111; line-height: 1.5;">
        <p style="margin: 0 0 12px;">London Kidney Clinical Research</p>
        <p style="margin: 0 0 12px;">Your verification code for the ${portalLabel} portal is:</p>
        <p style="margin: 0 0 12px; font-size: 20px; letter-spacing: 0.2em;"><strong>${code}</strong></p>
        <p style="margin: 0 0 12px;">This code expires in ${CODE_TTL_MINUTES} minutes.</p>
        <p style="margin: 0 0 12px;">If you didn't request this code, you can safely ignore this email.</p>
        <p style="margin: 0 0 4px;">--</p>
        <p style="margin: 0;">London Kidney Clinical Research</p>
      </div>
    `

    const result = await sendEmail({ to: email, subject, text, html })
    if (result?.skipped) {
      return NextResponse.json(
        { ok: false, error: 'Email provider not configured.' },
        { status: 500, headers: CORS_HEADERS }
      )
    }

    return NextResponse.json({ ok: true }, { headers: CORS_HEADERS })
  } catch (error) {
    console.error('[manage-login] failed', error)
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
          fallback: 'Failed to send passcode.',
        }),
      },
      { status: 500, headers: CORS_HEADERS }
    )
  }
}

export const dynamic = 'force-dynamic'
