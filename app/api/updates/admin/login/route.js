import { NextResponse } from 'next/server'
import crypto from 'crypto'
import { sanityFetch, writeClient } from '@/lib/sanity'
import { sendEmail } from '@/lib/email'
import { sanitizeString } from '@/lib/studySubmissions'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

const CODE_TTL_MINUTES = 10

async function getUpdateAdmins() {
  const settings = await sanityFetch(`
    *[_type == "siteSettings"][0]{
      "admins": studyUpdates.admins
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

    const admins = await getUpdateAdmins()
    if (!admins.length) {
      return NextResponse.json(
        { ok: false, error: 'No study update admins configured in Sanity.' },
        { status: 400, headers: CORS_HEADERS }
      )
    }

    if (!admins.includes(email)) {
      return NextResponse.json(
        { ok: false, error: 'Email not authorized for study updates.' },
        { status: 403, headers: CORS_HEADERS }
      )
    }

    const createdAt = new Date().toISOString()
    const code = String(Math.floor(100000 + Math.random() * 900000))
    const codeHash = crypto.createHash('sha256').update(code).digest('hex')
    const codeExpiresAt = new Date(Date.now() + CODE_TTL_MINUTES * 60 * 1000).toISOString()

    await writeClient.create({
      _type: 'studyUpdateAdminSession',
      email,
      codeHash,
      codeExpiresAt,
      createdAt,
      revoked: false,
    })

    const subject = 'Study updates admin: your passcode'
    const text = [
      'Use this passcode to access the study updates admin page:',
      code,
      '',
      `This code expires in ${CODE_TTL_MINUTES} minutes.`,
    ].join('\n')
    const html = `
      <div style="font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; font-size: 14px; color: #111; line-height: 1.5;">
        <p style="margin: 0 0 12px;"><strong>Study updates admin sign-in</strong></p>
        <p style="margin: 0 0 12px;">Use this passcode to access the study updates admin page:</p>
        <p style="margin: 0 0 12px; font-size: 20px; letter-spacing: 0.2em;"><strong>${code}</strong></p>
        <p style="margin: 0;">This code expires in ${CODE_TTL_MINUTES} minutes.</p>
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
