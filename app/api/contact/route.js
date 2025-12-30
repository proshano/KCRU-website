import { NextResponse } from 'next/server'
import { sanityFetch, queries, writeClient } from '@/lib/sanity'
import { sendEmail } from '@/lib/email'
import { escapeHtml } from '@/lib/escapeHtml'

const MIN_FORM_TIME_MS = 800
const MAX_MESSAGE_LENGTH = 2000
const RECAPTCHA_ENDPOINT = 'https://www.google.com/recaptcha/api/siteverify'
const MAX_ATTACHMENT_BYTES = 6 * 1024 * 1024 // 6MB
const CONTACT_SENDER_NAME =
  (process.env.CONTACT_FROM_NAME || 'London Kidney Clinical Research').trim() || 'London Kidney Clinical Research'
const DEFAULT_OPTIONS = [
  { key: 'referral', label: 'Healthcare provider making a research or clinical referral', showOceanLink: true },
  { key: 'industry', label: 'Industry interested in partnering on research', showOceanLink: false },
  { key: 'training', label: 'Interested in research training opportunities', showOceanLink: false },
  { key: 'donation', label: 'Interested in donating to support research', showOceanLink: false },
  { key: 'website-feedback', label: 'Website feedback', showOceanLink: false }
]

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

async function storeSubmission({ payload, option, headers }) {
  if (!writeClient.config().token) {
    console.warn('SANITY_API_TOKEN missing; skipping contactSubmission storage.')
    return null
  }

  const now = new Date().toISOString()
  return writeClient.create({
    _type: 'contactSubmission',
    name: payload.name,
    email: payload.email,
    reasonKey: payload.reasonKey,
    reasonLabel: option.label,
    message: option.showOceanLink ? '' : payload.message,
    oceanUrl: option.oceanUrl || null,
    status: 'new',
    submittedAt: now,
    meta: {
      ip: getClientIp(headers),
      userAgent: headers.get('user-agent') || ''
    }
  })
}

function validateAttachment(attachment, requiresTraining) {
  if (!attachment) return null
  const { filename, contentType, base64 } = attachment
  if (!requiresTraining) return null
  if (!filename || !base64) {
    throw new Error('Attachment missing filename or content')
  }
  if (contentType && contentType !== 'application/pdf') {
    throw new Error('Only PDF files are allowed')
  }
  const sizeBytes = Math.floor((base64.length * 3) / 4) // approximate
  if (sizeBytes > MAX_ATTACHMENT_BYTES) {
    throw new Error('File too large (max 6MB)')
  }
  return {
    filename,
    contentType: 'application/pdf',
    content: base64
  }
}

async function sendNotification({ payload, option, attachment }) {
  if (!option.email) {
    console.warn('No routing email configured for contact reason', option.key)
    return { skipped: true, reason: 'no_email' }
  }

  const submittedAt = new Date().toISOString()
  const subject = `${CONTACT_SENDER_NAME} contact form — ${option.label}`
  const text = [
    `${CONTACT_SENDER_NAME} contact form submission`,
    '',
    `Submitted: ${submittedAt}`,
    `Reason: ${option.label} (${option.key})`,
    '',
    `Name: ${payload.name}`,
    `Email: ${payload.email}`,
    option.showOceanLink && option.oceanUrl ? `OceanMD link: ${option.oceanUrl}` : '',
    payload.message ? `Message:\n${payload.message}` : '',
    '',
    '—',
    'Sent via the londonkidney.ca contact form.'
  ]
    .filter(Boolean)
    .join('\n')

  const html = `
    <div style="font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; font-size: 14px; color: #111; line-height: 1.5;">
      <p style="margin: 0 0 12px;"><strong>${escapeHtml(CONTACT_SENDER_NAME)} contact form submission</strong></p>
      <p style="margin: 0 0 12px;">
        <strong>Submitted:</strong> ${escapeHtml(submittedAt)}<br/>
        <strong>Reason:</strong> ${escapeHtml(option.label)} (${escapeHtml(option.key)})
      </p>
      <p style="margin: 0 0 12px;"><strong>Name:</strong> ${escapeHtml(payload.name)}<br/>
      <strong>Email:</strong> ${escapeHtml(payload.email)}</p>
      ${option.showOceanLink && option.oceanUrl ? `<p style="margin: 0 0 12px;"><strong>OceanMD link:</strong> ${escapeHtml(option.oceanUrl)}</p>` : ''}
      ${payload.message ? `<p style="margin: 0 0 12px;"><strong>Message:</strong><br/>${escapeHtml(payload.message).replace(/\n/g, '<br/>')}</p>` : ''}
      <hr style="border: none; border-top: 1px solid #eee; margin: 16px 0;" />
      <p style="margin: 0; color: #555; font-size: 12px;">Sent via the londonkidney.ca contact form.</p>
    </div>
  `

  try {
    const result = await sendEmail({
      to: option.email,
      subject,
      text,
      html,
      replyTo: payload.email,
      attachments: attachment ? [attachment] : undefined
    })

    if (result?.skipped) {
      console.error('Contact email skipped', result)
    }

    return result
  } catch (error) {
    console.error('Failed to send contact email', error)
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
    name,
    email,
    reasonKey,
    message: rawMessage,
    recaptchaToken,
    honeypot,
    startedAt,
    attachment
  } = body || {}

  if (honeypot) {
    return NextResponse.json({ error: 'Invalid submission' }, { status: 400 })
  }

  const trimmedName = sanitizeString(name)
  const trimmedEmail = sanitizeString(email)
  const trimmedReason = sanitizeString(reasonKey)
  const trimmedMessage = sanitizeString(rawMessage).slice(0, MAX_MESSAGE_LENGTH)

  if (!trimmedName || !trimmedEmail || !trimmedReason) {
    return NextResponse.json({ error: 'Name, email, and reason are required.' }, { status: 400 })
  }

  if (startedAt && Date.now() - Number(startedAt) < MIN_FORM_TIME_MS) {
    return NextResponse.json({ error: 'Please wait a moment before submitting.' }, { status: 400 })
  }

  const recaptchaResult = await verifyRecaptcha(recaptchaToken)
  if (!recaptchaResult.success) {
    return NextResponse.json({ error: 'reCAPTCHA validation failed.' }, { status: 400 })
  }

  const [routingRaw, settingsRaw] = await Promise.all([
    sanityFetch(queries.contactRouting),
    sanityFetch(queries.siteSettings)
  ])

  const routing = JSON.parse(JSON.stringify(routingRaw || {}))
  const settings = JSON.parse(JSON.stringify(settingsRaw || {}))
  const fallbackEmail = settings.contactEmail || process.env.CONTACT_FALLBACK_EMAIL || ''

  const routingOptions =
    routing?.options?.map((opt) => ({
      ...opt,
      email: opt.email || fallbackEmail
    })) || []

  const fallbackOptions = fallbackEmail
    ? DEFAULT_OPTIONS.map((opt) => ({ ...opt, email: fallbackEmail }))
    : []

  const option =
    routingOptions.find((opt) => opt?.key === trimmedReason) ||
    fallbackOptions.find((opt) => opt.key === trimmedReason)

  if (!option) {
    return NextResponse.json({ error: 'Unknown contact reason.' }, { status: 400 })
  }

  if (!option.showOceanLink && !trimmedMessage) {
    return NextResponse.json({ error: 'Please include a short message.' }, { status: 400 })
  }

  const requiresTraining = trimmedReason === 'training'
  let normalizedAttachment = null
  try {
    normalizedAttachment = validateAttachment(attachment, requiresTraining)
  } catch (err) {
    return NextResponse.json({ error: err.message || 'Invalid attachment.' }, { status: 400 })
  }

  const payload = {
    name: trimmedName,
    email: trimmedEmail,
    reasonKey: trimmedReason,
    message: option.showOceanLink ? '' : trimmedMessage
  }

  await storeSubmission({ payload, option, headers })
  const sendResult = await sendNotification({ payload, option, attachment: normalizedAttachment })

  if (sendResult?.skipped || sendResult?.error) {
    const reason = sendResult?.reason || sendResult?.message || 'Email failed to send.'
    return NextResponse.json({ error: reason }, { status: 500 })
  }

  return NextResponse.json({
    ok: true,
    showOceanLink: option.showOceanLink || false,
    oceanUrl: option.oceanUrl || null,
    successMessage:
      option.successMessage ||
      (option.showOceanLink
        ? 'Thanks — please submit your referral through the link below.'
        : 'Thanks for reaching out. We will respond soon.')
  })
}

export const dynamic = 'force-dynamic'



