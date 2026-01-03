import { NextResponse } from 'next/server'
import crypto from 'crypto'
import { sanityFetch, writeClient } from '@/lib/sanity'
import { sendEmail } from '@/lib/email'
import { sanitizeString } from '@/lib/studySubmissions'
import { buildCorsHeaders } from '@/lib/httpUtils'

const CORS_HEADERS = buildCorsHeaders('POST, OPTIONS')

const CODE_TTL_MINUTES = 10

async function getCoordinatorDomain() {
  const settings = await sanityFetch(`
    *[_type == "siteSettings"][0]{
      "domain": studyApprovals.coordinatorDomain
    }
  `)
  const raw =
    (settings?.domain || process.env.STUDY_COORDINATOR_DOMAIN || 'lhsc.on.ca')
      .toString()
      .trim()
      .toLowerCase()
  return raw.replace(/^@/, '')
}

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

    const domain = await getCoordinatorDomain()
    if (!email.endsWith(`@${domain}`)) {
      return NextResponse.json(
        { ok: false, error: `Email must be at @${domain}.` },
        { status: 403, headers: CORS_HEADERS }
      )
    }

    const code = String(Math.floor(100000 + Math.random() * 900000))
    const codeHash = crypto.createHash('sha256').update(code).digest('hex')
    const createdAt = new Date().toISOString()
    const codeExpiresAt = new Date(Date.now() + CODE_TTL_MINUTES * 60 * 1000).toISOString()

    await writeClient.create({
      _type: 'studyCoordinatorSession',
      email,
      codeHash,
      codeExpiresAt,
      createdAt,
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
    return NextResponse.json(
      { ok: false, error: error?.message || 'Failed to send passcode.' },
      { status: 500, headers: CORS_HEADERS }
    )
  }
}

export const dynamic = 'force-dynamic'
