import { NextResponse } from 'next/server'
import { writeClient } from '@/lib/sanity'
import { ROLE_VALUES, SPECIALTY_VALUES, INTEREST_AREA_VALUES, CORRESPONDENCE_VALUES } from '@/lib/communicationOptions'

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

async function getSubscriberByToken(token) {
  return writeClient.fetch(
    `*[_type == "updateSubscriber" && manageToken == $token][0]{
      _id,
      name,
      email,
      role,
      specialty,
      interestAreas,
      correspondencePreferences,
      status
    }`,
    { token }
  )
}

export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const token = sanitizeString(searchParams.get('token'))

  if (!token) {
    return NextResponse.json({ error: 'Missing token.' }, { status: 400 })
  }

  const subscriber = await getSubscriberByToken(token)
  if (!subscriber?._id) {
    return NextResponse.json({ error: 'Subscription not found.' }, { status: 404 })
  }

  return NextResponse.json({ ok: true, subscriber })
}

export async function POST(request) {
  let body

  try {
    body = await request.json()
  } catch (error) {
    return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 })
  }

  const { token, action, role, specialty, interestAreas, correspondencePreferences, name } = body || {}
  const trimmedToken = sanitizeString(token)

  if (!trimmedToken) {
    return NextResponse.json({ error: 'Missing token.' }, { status: 400 })
  }

  if (!writeClient.config().token) {
    return NextResponse.json({ error: 'Server not configured to save preferences.' }, { status: 500 })
  }

  const subscriber = await getSubscriberByToken(trimmedToken)
  if (!subscriber?._id) {
    return NextResponse.json({ error: 'Subscription not found.' }, { status: 404 })
  }

  const now = new Date().toISOString()

  if (action === 'unsubscribe') {
    await writeClient
      .patch(subscriber._id)
      .set({ status: 'unsubscribed', updatedAt: now, unsubscribedAt: now })
      .commit()

    return NextResponse.json({ ok: true, status: 'unsubscribed' })
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
  const trimmedName = sanitizeString(name)

  await writeClient
    .patch(subscriber._id)
    .set({
      name: trimmedName,
      role: normalizedRole,
      specialty: normalizedSpecialty || null,
      interestAreas: normalizedInterestAreas,
      correspondencePreferences: normalizedCorrespondence,
      status: 'active',
      updatedAt: now,
      unsubscribedAt: null
    })
    .commit()

  return NextResponse.json({ ok: true, status: 'active' })
}

export const dynamic = 'force-dynamic'
