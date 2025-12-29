import { NextResponse } from 'next/server'
import { writeClient } from '@/lib/sanity'
import { ROLE_VALUES, TOPIC_VALUES } from '@/lib/communicationOptions'

function sanitizeString(value = '') {
  if (!value) return ''
  return String(value).trim()
}

function normalizeList(values) {
  if (!Array.isArray(values)) return []
  const cleaned = values.map((value) => sanitizeString(value)).filter(Boolean)
  return Array.from(new Set(cleaned))
}

async function getSubscriberByToken(token) {
  return writeClient.fetch(
    `*[_type == "updateSubscriber" && manageToken == $token][0]{
      _id,
      name,
      email,
      roles,
      topics,
      status,
      "therapeuticAreaIds": therapeuticAreas[]._ref
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

  const { token, action, roles, therapeuticAreaIds, topics, name } = body || {}
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

  const normalizedRoles = normalizeList(roles).filter((role) => ROLE_VALUES.has(role))
  if (!normalizedRoles.length) {
    return NextResponse.json({ error: 'Please select at least one role.' }, { status: 400 })
  }

  const normalizedTopics = normalizeList(topics).filter((topic) => TOPIC_VALUES.has(topic))
  if (!normalizedTopics.length) {
    return NextResponse.json({ error: 'Please select at least one update type.' }, { status: 400 })
  }

  const normalizedAreas = normalizeList(therapeuticAreaIds)
  if (!normalizedAreas.length) {
    return NextResponse.json({ error: 'Please select at least one therapeutic area.' }, { status: 400 })
  }

  const areaRefs = normalizedAreas.map((id) => ({ _type: 'reference', _ref: id }))
  const trimmedName = sanitizeString(name)

  await writeClient
    .patch(subscriber._id)
    .set({
      name: trimmedName,
      roles: normalizedRoles,
      topics: normalizedTopics,
      therapeuticAreas: areaRefs,
      status: 'active',
      updatedAt: now,
      unsubscribedAt: null
    })
    .commit()

  return NextResponse.json({ ok: true, status: 'active' })
}

export const dynamic = 'force-dynamic'
