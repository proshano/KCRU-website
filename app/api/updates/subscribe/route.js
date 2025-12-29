import { NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { writeClient } from '@/lib/sanity'
import { ROLE_VALUES, SPECIALTY_VALUES, INTEREST_AREA_VALUES, CORRESPONDENCE_VALUES } from '@/lib/communicationOptions'
import { sendEmail } from '@/lib/email'

const MIN_FORM_TIME_MS = 800
const RECAPTCHA_ENDPOINT = 'https://www.google.com/recaptcha/api/siteverify'
const SITE_BASE_URL = (process.env.SITE_URL || process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000').replace(
  /\/$/,
  ''
)

function sanitizeString(value = '') {
  if (!value) return ''
  return String(value).trim()
}

function normalizeList(values) {
  if (!Array.isArray(values)) return []
  const cleaned = values.map((value) => sanitizeString(value)).filter(Boolean)
  return Array.from(new Set(cleaned))
}

function normalizeInterestAreas(values) {
  const normalized = normalizeList(values).filter((item) => INTEREST_AREA_VALUES.has(item))
  if (normalized.includes('all')) return ['all']
  return normalized
}

function normalizeCorrespondence(values) {
  return normalizeList(values).filter((item) => CORRESPONDENCE_VALUES.has(item))
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

async function sendSubscriptionEmail({ name, email, manageToken }) {
  if (!manageToken) return { skipped: true, reason: 'missing_token' }

  const manageUrl = `${SITE_BASE_URL}/updates/manage?token=${encodeURIComponent(manageToken)}`
  const greeting = name ? `Hi ${name},` : 'Hello,'
  const subject = 'You are subscribed to London Clinical Kidney Research Updates'
  const text = [
    greeting,
    '',
    'Thanks for subscribing to London Clinical Kidney Research Updates.',
    'You can manage your preferences or unsubscribe at any time using this link:',
    manageUrl,
    '',
    'If you did not request these updates, you can use the same link to unsubscribe.',
    '',
    '—',
    'London Kidney Clinical Research'
  ].join('\n')

  const html = `
    <div style="font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; font-size: 14px; color: #111; line-height: 1.6;">
      <p style="margin: 0 0 12px;">${greeting}</p>
      <p style="margin: 0 0 12px;">Thanks for subscribing to London Clinical Kidney Research Updates.</p>
      <p style="margin: 0 0 16px;">
        Manage your preferences or unsubscribe at any time using this link:<br/>
        <a href="${manageUrl}" style="color: #6b21a8; font-weight: 600;">Manage preferences</a>
      </p>
      <p style="margin: 0 0 12px; color: #555; font-size: 12px;">
        If you did not request these updates, you can use the same link to unsubscribe.
      </p>
      <hr style="border: none; border-top: 1px solid #eee; margin: 16px 0;" />
      <p style="margin: 0; color: #555; font-size: 12px;">London Kidney Clinical Research</p>
    </div>
  `

  return sendEmail({ to: email, subject, text, html })
}

async function upsertSubscriber({
  name,
  email,
  role,
  specialty,
  interestAreas,
  correspondencePreferences,
  headers,
  recaptchaData
}) {
  if (!writeClient.config().token) {
    throw new Error('SANITY_API_TOKEN missing')
  }

  const emailLower = email.toLowerCase()
  const existing = await writeClient.fetch(
    `*[_type == "updateSubscriber" && lower(email) == $emailLower][0]{ _id, manageToken, status, source }`,
    { emailLower }
  )

  const now = new Date().toISOString()
  if (existing?._id) {
    const manageToken = existing.manageToken || randomUUID()
    let patch = writeClient
      .patch(existing._id)
      .set({
        name,
        email,
        role,
        specialty: specialty || null,
        interestAreas,
        correspondencePreferences,
        status: 'active',
        updatedAt: now,
        ...(existing.manageToken ? {} : { manageToken })
      })

    if (existing.status === 'unsubscribed') {
      patch = patch.unset(['unsubscribedAt'])
    }

    await patch.commit()
    return { manageToken, created: false }
  }

  const manageToken = randomUUID()
  await writeClient.create({
    _type: 'updateSubscriber',
    name,
    email,
    role,
    specialty: specialty || null,
    interestAreas,
    correspondencePreferences,
    status: 'active',
    source: 'self',
    manageToken,
    createdAt: now,
    updatedAt: now,
    consent: {
      source: 'self',
      timestamp: now,
      ip: getClientIp(headers),
      userAgent: headers.get('user-agent') || '',
      recaptchaScore: typeof recaptchaData?.score === 'number' ? recaptchaData.score : null
    }
  })

  return { manageToken, created: true }
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
    role,
    specialty,
    interestAreas,
    correspondencePreferences,
    recaptchaToken,
    honeypot,
    startedAt
  } = body || {}

  if (honeypot) {
    return NextResponse.json({ error: 'Invalid submission' }, { status: 400 })
  }

  const trimmedName = sanitizeString(name)
  const trimmedEmail = sanitizeString(email)

  if (!trimmedEmail) {
    return NextResponse.json({ error: 'Email is required.' }, { status: 400 })
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  if (!emailRegex.test(trimmedEmail)) {
    return NextResponse.json({ error: 'Please enter a valid email address.' }, { status: 400 })
  }

  if (startedAt && Date.now() - Number(startedAt) < MIN_FORM_TIME_MS) {
    return NextResponse.json({ error: 'Please wait a moment before submitting.' }, { status: 400 })
  }

  const normalizedRole = sanitizeString(role)
  if (!normalizedRole || !ROLE_VALUES.has(normalizedRole)) {
    return NextResponse.json({ error: 'Please select a valid role.' }, { status: 400 })
  }

  const normalizedSpecialty = sanitizeString(specialty)
  if (normalizedSpecialty && !SPECIALTY_VALUES.has(normalizedSpecialty)) {
    return NextResponse.json({ error: 'Please select a valid specialty.' }, { status: 400 })
  }

  const normalizedInterestAreas = normalizeInterestAreas(interestAreas)
  if (!normalizedInterestAreas.length) {
    return NextResponse.json({ error: 'Please select at least one interest area.' }, { status: 400 })
  }

  const normalizedCorrespondence = normalizeCorrespondence(correspondencePreferences)
  if (!normalizedCorrespondence.length) {
    return NextResponse.json({ error: 'Please select at least one correspondence option.' }, { status: 400 })
  }

  const recaptchaResult = await verifyRecaptcha(recaptchaToken)
  if (!recaptchaResult.success) {
    return NextResponse.json({ error: 'reCAPTCHA validation failed.' }, { status: 400 })
  }

  try {
    const result = await upsertSubscriber({
      name: trimmedName,
      email: trimmedEmail,
      role: normalizedRole,
      specialty: normalizedSpecialty,
      interestAreas: normalizedInterestAreas,
      correspondencePreferences: normalizedCorrespondence,
      headers,
      recaptchaData: recaptchaResult.data
    })

    if (result.created) {
      try {
        const emailResult = await sendSubscriptionEmail({
          name: trimmedName,
          email: trimmedEmail,
          manageToken: result.manageToken
        })
        if (emailResult?.skipped) {
          console.warn('Subscription email skipped', emailResult)
        }
      } catch (error) {
        console.error('Failed to send subscription email', error)
      }
    }

    return NextResponse.json({
      ok: true,
      manageToken: result.manageToken,
      created: result.created
    })
  } catch (error) {
    console.error('Failed to save update subscriber', error)
    return NextResponse.json({ error: 'Unable to save subscription right now.' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
