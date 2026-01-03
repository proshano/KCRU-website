import { NextResponse } from 'next/server'
import { writeClient } from '@/lib/sanity'
import { sendEmail } from '@/lib/email'
import { sanitizeString } from '@/lib/studySubmissions'
import { createAdminPasscodeSession, getAdminEmails, getAdminScopeLabel } from '@/lib/adminSessions'
import { buildCorsHeaders } from '@/lib/httpUtils'

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
    const scope = 'updates'
    const scopeLabel = getAdminScopeLabel(scope)
    if (!email) {
      return NextResponse.json(
        { ok: false, error: 'Email is required.' },
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

    const { code } = await createAdminPasscodeSession({ email, codeTtlMinutes: CODE_TTL_MINUTES })

    const portalLabel = 'administrator'
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
    console.error('[updates-admin-login] failed', error)
    return NextResponse.json(
      { ok: false, error: error?.message || 'Failed to send passcode.' },
      { status: 500, headers: CORS_HEADERS }
    )
  }
}

export const dynamic = 'force-dynamic'
