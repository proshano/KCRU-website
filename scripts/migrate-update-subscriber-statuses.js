/**
 * Migration: backfill subscriptionStatus/deliveryStatus for update subscribers.
 *
 * Usage:
 *   SANITY_API_TOKEN=... node scripts/migrate-update-subscriber-statuses.js
 *   DRY_RUN=true SANITY_API_TOKEN=... node scripts/migrate-update-subscriber-statuses.js
 */

import { createClient } from '@sanity/client'
import {
  DELIVERY_STATUS_ACTIVE,
  DELIVERY_STATUS_SUPPRESSED,
  SUBSCRIPTION_STATUS_SUBSCRIBED,
  SUBSCRIPTION_STATUS_UNSUBSCRIBED,
} from '../lib/updateSubscriberStatus.js'

const projectId = process.env.NEXT_PUBLIC_SANITY_PROJECT_ID
const dataset = process.env.NEXT_PUBLIC_SANITY_DATASET
const token = process.env.SANITY_API_TOKEN
const dryRun = process.env.DRY_RUN === 'true'

if (!projectId) {
  console.error('Error: NEXT_PUBLIC_SANITY_PROJECT_ID environment variable is required')
  process.exit(1)
}

if (!dataset) {
  console.error('Error: NEXT_PUBLIC_SANITY_DATASET environment variable is required')
  process.exit(1)
}

if (!token) {
  console.error('Error: SANITY_API_TOKEN environment variable is required')
  console.error('Get a token from: https://www.sanity.io/manage → your project → API → Tokens')
  process.exit(1)
}

const client = createClient({
  projectId,
  dataset,
  apiVersion: '2024-01-01',
  useCdn: false,
  token,
})

const SUBSCRIPTION_VALUES = new Set([SUBSCRIPTION_STATUS_SUBSCRIBED, SUBSCRIPTION_STATUS_UNSUBSCRIBED])
const DELIVERY_VALUES = new Set([DELIVERY_STATUS_ACTIVE, DELIVERY_STATUS_SUPPRESSED])

function normalizeSubscriptionStatus(value) {
  return SUBSCRIPTION_VALUES.has(value) ? value : null
}

function normalizeDeliveryStatus(value) {
  return DELIVERY_VALUES.has(value) ? value : null
}

function computeSubscriptionStatus(doc) {
  const existing = normalizeSubscriptionStatus(doc?.subscriptionStatus)
  if (existing) return existing
  if (doc?.status === SUBSCRIPTION_STATUS_UNSUBSCRIBED) {
    return SUBSCRIPTION_STATUS_UNSUBSCRIBED
  }
  if (doc?.status === DELIVERY_STATUS_ACTIVE || doc?.status === DELIVERY_STATUS_SUPPRESSED) {
    return SUBSCRIPTION_STATUS_SUBSCRIBED
  }
  return SUBSCRIPTION_STATUS_UNSUBSCRIBED
}

function computeDeliveryStatus(doc) {
  const existing = normalizeDeliveryStatus(doc?.deliveryStatus)
  if (existing) return existing
  if (doc?.status === DELIVERY_STATUS_SUPPRESSED || doc?.suppressEmails === true) {
    return DELIVERY_STATUS_SUPPRESSED
  }
  return DELIVERY_STATUS_ACTIVE
}

function computeUpdate(doc) {
  const subscriptionStatus = computeSubscriptionStatus(doc)
  const deliveryStatus = computeDeliveryStatus(doc)
  const changes = {}
  const unset = []

  if (doc?.subscriptionStatus !== subscriptionStatus) {
    changes.subscriptionStatus = subscriptionStatus
  }
  if (doc?.deliveryStatus !== deliveryStatus) {
    changes.deliveryStatus = deliveryStatus
  }
  if (typeof doc?.status !== 'undefined') {
    unset.push('status')
  }
  if (typeof doc?.suppressEmails !== 'undefined') {
    unset.push('suppressEmails')
  }

  return {
    changes,
    subscriptionStatus,
    deliveryStatus,
    unset,
  }
}

async function main() {
  console.log('[migrate] Starting update subscriber status backfill...')
  if (dryRun) console.log('[migrate] DRY_RUN=true (no writes)')

  const subscribers = await client.fetch(
    `*[_type == "updateSubscriber"]{
      _id,
      email,
      status,
      subscriptionStatus,
      deliveryStatus,
      suppressEmails
    }`
  )

  const rows = Array.isArray(subscribers) ? subscribers : []
  console.log(`[migrate] Subscribers found: ${rows.length}`)

  let updatedCount = 0
  let skippedCount = 0
  const now = new Date().toISOString()

  for (const row of rows) {
    const { changes, subscriptionStatus, deliveryStatus, unset } = computeUpdate(row)
    if (!Object.keys(changes).length && unset.length === 0) {
      skippedCount += 1
      continue
    }

    updatedCount += 1
    if (dryRun) {
      console.log(
        `[dry-run] ${row._id} (${row.email || 'no email'}) -> ` +
          `subscriptionStatus=${subscriptionStatus}, deliveryStatus=${deliveryStatus}, unset=${unset.join(',') || 'none'}`
      )
      continue
    }

    try {
      let patch = client.patch(row._id)
      if (Object.keys(changes).length) {
        patch = patch.set({ ...changes, updatedAt: now })
      }
      if (unset.length) {
        patch = patch.unset(unset)
      }
      await patch.commit({ returnDocuments: false })
      console.log(`[migrate] updated ${row._id} (${row.email || 'no email'})`)
    } catch (err) {
      console.error(`[migrate] failed ${row._id}: ${err.message}`)
    }
  }

  console.log(`[migrate] Subscribers updated: ${updatedCount}`)
  console.log(`[migrate] Subscribers unchanged: ${skippedCount}`)
  console.log('[migrate] Done.')
}

main().catch((err) => {
  console.error('[migrate] Fatal error:', err.message)
  process.exit(1)
})
