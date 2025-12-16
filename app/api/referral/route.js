import { NextResponse } from 'next/server'
import { sanityFetch, queries, writeClient } from '@/lib/sanity'
import { sendEmail } from '@/lib/email'

const MIN_FORM_TIME_MS = 800
const RECAPTCHA_ENDPOINT = 'https://www.google.com/recaptcha/api/siteverify'

function sanitizeString(value = '') {
  if (!value) return ''
  return String(value).trim()
}

function getClientIp(headers) {
  const xfwd = headers.get('x-forwarded-for')
  if (xfwd) return xfwd.split(',')[0]?.trim()
  return headers.get('x-real-ip') || null
}

async function verifyRecaptcha(token) {
  const secret = process.env.RECAPTCHA_SECRET_KEY || process.env.RECAPTCHA_SECRET
  if (!secret) {
    console.warn('reCAPTCHA secret not configured; skipping verification.')
    return { success: true, skipped: true }
  }

  try {
    const res = await fetch(RECAPTCHA_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `secret=${encodeURIComponent(secret)}&response=${encodeURIComponent(token)}`
    })

    const data = await res.json()
    const scoreOk = typeof data.score !== 'number' || data.score >= 0.4
    return { success: Boolean(data.success) && scoreOk, data }
  } catch (err) {
    console.error('Failed to verify reCAPTCHA', err)
    return { success: false, error: err }
  }
}

async function storeReferral({ providerEmail, study, headers }) {
  if (!writeClient.config().token) {
    console.warn('SANITY_API_TOKEN missing; skipping studyReferral storage.')
    return null
  }

  const now = new Date().toISOString()
  return writeClient.create({
    _type: 'studyReferral',
    providerEmail,
    study: { _type: 'reference', _ref: study._id },
    studyTitle: study.title,
    status: 'new',
    submittedAt: now,
    meta: {
      ip: getClientIp(headers),
      userAgent: headers.get('user-agent') || ''
    }
  })
}

async function sendReferralNotification({ providerEmail, study, coordinatorEmail }) {
  const submittedAt = new Date().toISOString()
  const subject = `Study Referral - ${study.title}`
  
  const text = [
    `Study Referral Request`,
    '',
    `A healthcare provider has requested to discuss a potential patient referral for this study.`,
    '',
    `Study: ${study.title}`,
    `From: ${providerEmail}`,
    `Submitted: ${submittedAt}`,
    '',
    `Reply directly to this email to begin the conversation.`,
    '',
    '—',
    'Sent via londonkidney.ca'
  ].join('\n')

  const html = `
    <div style="font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; font-size: 14px; color: #111; line-height: 1.5;">
      <p style="margin: 0 0 16px; font-size: 16px;"><strong>Study Referral Request</strong></p>
      <p style="margin: 0 0 16px;">
        A healthcare provider has requested to discuss a potential patient referral for this study.
      </p>
      <p style="margin: 0 0 16px;">
        <strong>Study:</strong> ${study.title}<br/>
        <strong>From:</strong> ${providerEmail}<br/>
        <strong>Submitted:</strong> ${submittedAt}
      </p>
      <p style="margin: 0 0 16px; padding: 12px; background: #f5f5f5; border-radius: 6px;">
        Reply directly to this email to begin the conversation.
      </p>
      <hr style="border: none; border-top: 1px solid #eee; margin: 16px 0;" />
      <p style="margin: 0; color: #555; font-size: 12px;">Sent via londonkidney.ca</p>
    </div>
  `

  try {
    const result = await sendEmail({
      to: coordinatorEmail,
      subject,
      text,
      html,
      replyTo: providerEmail
    })

    if (result?.skipped) {
      console.error('Referral email skipped', result)
    }

    return result
  } catch (error) {
    console.error('Failed to send referral email', error)
    return { error: true, message: error.message }
  }
}

export async function POST(request) {
  const headers = request.headers
  let body

  try {
    body = await request.json()
  } catch (error) {
    return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 })
  }

  const {
    email,
    studySlug,
    isProvider,
    recaptchaToken,
    honeypot,
    startedAt
  } = body || {}

  // Honeypot check
  if (honeypot) {
    return NextResponse.json({ error: 'Invalid submission' }, { status: 400 })
  }

  const trimmedEmail = sanitizeString(email)
  const trimmedSlug = sanitizeString(studySlug)

  // Validate required fields
  if (!trimmedEmail) {
    return NextResponse.json({ error: 'Email is required.' }, { status: 400 })
  }

  if (!trimmedSlug) {
    return NextResponse.json({ error: 'Study not specified.' }, { status: 400 })
  }

  if (!isProvider) {
    return NextResponse.json({ error: 'You must confirm you are a healthcare provider.' }, { status: 400 })
  }

  // Basic email validation
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  if (!emailRegex.test(trimmedEmail)) {
    return NextResponse.json({ error: 'Please enter a valid email address.' }, { status: 400 })
  }

  // Timing check (bot protection)
  if (startedAt && Date.now() - Number(startedAt) < MIN_FORM_TIME_MS) {
    return NextResponse.json({ error: 'Please wait a moment before submitting.' }, { status: 400 })
  }

  // reCAPTCHA verification
  const recaptchaResult = await verifyRecaptcha(recaptchaToken)
  if (!recaptchaResult.success) {
    return NextResponse.json({ error: 'reCAPTCHA validation failed.' }, { status: 400 })
  }

  // Fetch study and coordinator info
  const studyRaw = await sanityFetch(queries.trialCoordinator, { slug: trimmedSlug })
  const study = JSON.parse(JSON.stringify(studyRaw || {}))

  if (!study || !study._id) {
    return NextResponse.json({ error: 'Study not found.' }, { status: 404 })
  }

  if (!study.acceptsReferrals) {
    return NextResponse.json({ error: 'This study is not accepting referrals.' }, { status: 400 })
  }

  if (!study.coordinatorEmail) {
    return NextResponse.json({ error: 'No coordinator email configured for this study.' }, { status: 400 })
  }

  // Store referral in Sanity
  await storeReferral({ providerEmail: trimmedEmail, study, headers })

  // Send email to coordinator
  const sendResult = await sendReferralNotification({
    providerEmail: trimmedEmail,
    study,
    coordinatorEmail: study.coordinatorEmail
  })

  if (sendResult?.skipped || sendResult?.error) {
    const reason = sendResult?.reason || sendResult?.message || 'Email failed to send.'
    return NextResponse.json({ error: reason }, { status: 500 })
  }

  return NextResponse.json({
    ok: true,
    message: 'Thank you. The study coordinator will be in touch shortly.'
  })
}

export const dynamic = 'force-dynamic'
