import { NextResponse } from 'next/server'
import { writeClient } from '@/lib/sanity'
import { ROLE_VALUES, SPECIALTY_VALUES, CORRESPONDENCE_VALUES } from '@/lib/communicationOptions'
import { sanitizeString, normalizeCorrespondence } from '@/lib/inputUtils'
import {
  DELIVERY_STATUS_ACTIVE,
  DELIVERY_STATUS_SUPPRESSED,
  SUBSCRIPTION_STATUS_SUBSCRIBED,
  SUBSCRIPTION_STATUS_UNSUBSCRIBED,
  deriveLegacyStatus,
  resolveDeliveryStatus,
} from '@/lib/updateSubscriberStatus'
import {
  ALL_THERAPEUTIC_AREAS_VALUE,
  buildReferenceList,
  fetchTherapeuticAreas,
  resolveTherapeuticAreaIds,
} from '@/lib/therapeuticAreas'
import { fetchSites, resolveSiteIds } from '@/lib/sites'

async function getSubscriberByToken(token) {
  return writeClient.fetch(
    `*[_type == "updateSubscriber" && manageToken == $token][0]{
      _id,
      name,
      email,
      role,
      specialty,
      practiceSites,
      interestAreas,
      allTherapeuticAreas,
      correspondencePreferences,
      status,
      subscriptionStatus,
      deliveryStatus,
      suppressEmails
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

  const [subscriber, areas, sites] = await Promise.all([
    getSubscriberByToken(token),
    fetchTherapeuticAreas(),
    fetchSites()
  ])
  if (!subscriber?._id) {
    return NextResponse.json({ error: 'Subscription not found.' }, { status: 404 })
  }

  const rawInterestAreas = Array.isArray(subscriber?.interestAreas) ? subscriber.interestAreas : []
  const legacyAll = rawInterestAreas.includes(ALL_THERAPEUTIC_AREAS_VALUE)
  const resolvedInterestAreas = resolveTherapeuticAreaIds(rawInterestAreas, areas)
  const allTherapeuticAreas = Boolean(subscriber?.allTherapeuticAreas) || legacyAll
  const interestAreas = allTherapeuticAreas ? [ALL_THERAPEUTIC_AREAS_VALUE] : resolvedInterestAreas
  const rawPracticeSites = Array.isArray(subscriber?.practiceSites) ? subscriber.practiceSites : []
  const practiceSiteIds = rawPracticeSites.map((site) => site?._ref || site?._id || site).filter(Boolean)
  const practiceSites = resolveSiteIds(practiceSiteIds, sites)

  return NextResponse.json({
    ok: true,
    subscriber: {
      ...subscriber,
      interestAreas,
      allTherapeuticAreas,
      practiceSites,
    },
  })
}

export async function POST(request) {
  let body

  try {
    body = await request.json()
  } catch (error) {
    return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 })
  }

  const { token, action, role, specialty, practiceSites, interestAreas, correspondencePreferences, name } = body || {}
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
      .set({
        subscriptionStatus: SUBSCRIPTION_STATUS_UNSUBSCRIBED,
        status: SUBSCRIPTION_STATUS_UNSUBSCRIBED,
        updatedAt: now,
        unsubscribedAt: now
      })
      .commit()

    return NextResponse.json({
      ok: true,
      subscriptionStatus: SUBSCRIPTION_STATUS_UNSUBSCRIBED,
      deliveryStatus: resolveDeliveryStatus(subscriber)
    })
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
  const trimmedName = sanitizeString(name)
  const existingDeliveryStatus = resolveDeliveryStatus(subscriber)
  const nextDeliveryStatus =
    existingDeliveryStatus === DELIVERY_STATUS_SUPPRESSED ? DELIVERY_STATUS_SUPPRESSED : DELIVERY_STATUS_ACTIVE
  const nextSubscriptionStatus = SUBSCRIPTION_STATUS_SUBSCRIBED
  const legacyStatus = deriveLegacyStatus({
    subscriptionStatus: nextSubscriptionStatus,
    deliveryStatus: nextDeliveryStatus,
  })

  await writeClient
    .patch(subscriber._id)
    .set({
      name: trimmedName,
      role: normalizedRole,
      specialty: normalizedSpecialty || null,
      practiceSites: buildReferenceList(resolvedPracticeSiteIds),
      interestAreas: buildReferenceList(resolvedInterestAreaIds),
      allTherapeuticAreas,
      correspondencePreferences: normalizedCorrespondence,
      subscriptionStatus: nextSubscriptionStatus,
      deliveryStatus: nextDeliveryStatus,
      status: legacyStatus,
      updatedAt: now,
      unsubscribedAt: null
    })
    .commit()

  return NextResponse.json({
    ok: true,
    subscriptionStatus: nextSubscriptionStatus,
    deliveryStatus: nextDeliveryStatus
  })
}

export const dynamic = 'force-dynamic'
