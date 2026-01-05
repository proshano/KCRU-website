import { NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { writeClient } from '@/lib/sanity'
import { ROLE_VALUES, SPECIALTY_VALUES, CORRESPONDENCE_VALUES } from '@/lib/communicationOptions'
import { sendEmail } from '@/lib/email'
import { escapeHtml } from '@/lib/escapeHtml'
import { getClientIp } from '@/lib/httpUtils'
import { sanitizeString, normalizeCorrespondence } from '@/lib/inputUtils'
import { verifyRecaptcha } from '@/lib/recaptcha'
import {
  DELIVERY_STATUS_ACTIVE,
  DELIVERY_STATUS_SUPPRESSED,
  SUBSCRIPTION_STATUS_SUBSCRIBED,
  SUBSCRIPTION_STATUS_UNSUBSCRIBED,
  deriveLegacyStatus,
  resolveDeliveryStatus,
  resolveSubscriptionStatus,
} from '@/lib/updateSubscriberStatus'
import {
  ALL_THERAPEUTIC_AREAS_VALUE,
  buildReferenceList,
  fetchTherapeuticAreas,
  resolveTherapeuticAreaIds,
} from '@/lib/therapeuticAreas'
import { fetchSites, resolveSiteIds } from '@/lib/sites'

const MIN_FORM_TIME_MS = 800
const SITE_BASE_URL = (process.env.SITE_URL || process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000').replace(
  /\/$/,
  ''
)

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
      <p style="margin: 0 0 12px;">${escapeHtml(greeting)}</p>
      <p style="margin: 0 0 12px;">Thanks for subscribing to London Clinical Kidney Research Updates.</p>
      <p style="margin: 0 0 16px;">
        Manage your preferences or unsubscribe at any time using this link:<br/>
        <a href="${escapeHtml(manageUrl)}" style="color: #6b21a8; font-weight: 600;">Manage preferences</a>
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
  practiceSites,
  interestAreas,
  allTherapeuticAreas,
  correspondencePreferences,
  headers,
  recaptchaData
}) {
  if (!writeClient.config().token) {
    throw new Error('SANITY_API_TOKEN missing')
  }

  const emailLower = email.toLowerCase()
  const existing = await writeClient.fetch(
    `*[_type == "updateSubscriber" && lower(email) == $emailLower][0]{
      _id,
      manageToken,
      status,
      subscriptionStatus,
      deliveryStatus,
      suppressEmails,
      source
    }`,
    { emailLower }
  )

  const now = new Date().toISOString()
  if (existing?._id) {
    const manageToken = existing.manageToken || randomUUID()
    const existingDeliveryStatus = resolveDeliveryStatus(existing)
    const nextDeliveryStatus =
      existingDeliveryStatus === DELIVERY_STATUS_SUPPRESSED ? DELIVERY_STATUS_SUPPRESSED : DELIVERY_STATUS_ACTIVE
    const nextSubscriptionStatus = SUBSCRIPTION_STATUS_SUBSCRIBED
    const legacyStatus = deriveLegacyStatus({
      subscriptionStatus: nextSubscriptionStatus,
      deliveryStatus: nextDeliveryStatus,
    })
    let patch = writeClient
      .patch(existing._id)
      .set({
        name,
        email,
        role,
        specialty: specialty || null,
        practiceSites,
        interestAreas,
        allTherapeuticAreas,
        correspondencePreferences,
        subscriptionStatus: nextSubscriptionStatus,
        deliveryStatus: nextDeliveryStatus,
        status: legacyStatus,
        updatedAt: now,
        ...(existing.manageToken ? {} : { manageToken })
      })

    if (resolveSubscriptionStatus(existing) === SUBSCRIPTION_STATUS_UNSUBSCRIBED) {
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
    practiceSites,
    interestAreas,
    allTherapeuticAreas,
    correspondencePreferences,
    subscriptionStatus: SUBSCRIPTION_STATUS_SUBSCRIBED,
    deliveryStatus: DELIVERY_STATUS_ACTIVE,
    status: DELIVERY_STATUS_ACTIVE,
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
    practiceSites,
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

  const normalizedCorrespondence = normalizeCorrespondence(correspondencePreferences, CORRESPONDENCE_VALUES)
  if (!normalizedCorrespondence.length) {
    return NextResponse.json({ error: 'Please select at least one correspondence option.' }, { status: 400 })
  }

  const rawPracticeSites = Array.isArray(practiceSites) ? practiceSites : []
  let resolvedPracticeSiteIds = []

  if (rawPracticeSites.length) {
    const sites = await fetchSites()
    if (!sites.length) {
      return NextResponse.json({ error: 'Research sites are not configured.' }, { status: 500 })
    }
    resolvedPracticeSiteIds = resolveSiteIds(rawPracticeSites, sites)
    if (!resolvedPracticeSiteIds.length) {
      return NextResponse.json({ error: 'Please select a valid location of practice.' }, { status: 400 })
    }
  }

  const wantsStudyUpdates = normalizedCorrespondence.includes('study_updates')
  let resolvedInterestAreaIds = []
  let allTherapeuticAreas = false

  if (wantsStudyUpdates) {
    const areas = await fetchTherapeuticAreas()
    if (!areas.length) {
      return NextResponse.json({ error: 'Therapeutic areas are not configured.' }, { status: 500 })
    }

    const rawInterestAreas = Array.isArray(interestAreas) ? interestAreas : []
    allTherapeuticAreas =
      Boolean(body?.allTherapeuticAreas) || rawInterestAreas.includes(ALL_THERAPEUTIC_AREAS_VALUE)
    resolvedInterestAreaIds = allTherapeuticAreas ? [] : resolveTherapeuticAreaIds(rawInterestAreas, areas)

    if (!allTherapeuticAreas && !resolvedInterestAreaIds.length) {
      return NextResponse.json({ error: 'Please select at least one interest area.' }, { status: 400 })
    }
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
      practiceSites: buildReferenceList(resolvedPracticeSiteIds),
      interestAreas: buildReferenceList(resolvedInterestAreaIds),
      allTherapeuticAreas,
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
