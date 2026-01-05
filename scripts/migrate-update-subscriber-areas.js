/**
 * Migration: convert updateSubscriber.interestAreas to therapeuticArea references.
 *
 * Usage:
 *   SANITY_API_TOKEN=... node scripts/migrate-update-subscriber-areas.js
 *   DRY_RUN=true SANITY_API_TOKEN=... node scripts/migrate-update-subscriber-areas.js
 */

import { createClient } from '@sanity/client'

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

const ALL_VALUE = 'all'

function normalizeKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[–—]/g, '-')
    .replace(/_/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizeKeyLoose(value) {
  const base = normalizeKey(value)
  if (!base) return ''
  return base.replace(/\band\b/g, '').replace(/\s+/g, ' ').trim()
}

function buildAreaLookup(areas) {
  const byId = new Map()
  const byKey = new Map()
  for (const area of areas || []) {
    if (area?._id) {
      byId.set(area._id, area)
    }
    const keys = [
      normalizeKey(area?.name),
      normalizeKeyLoose(area?.name),
      normalizeKey(area?.slug),
      normalizeKeyLoose(area?.slug),
    ]
    for (const key of keys) {
      if (key && !byKey.has(key)) {
        byKey.set(key, area)
      }
    }
  }
  return { byId, byKey }
}

function resolveAreaIds(values, lookup) {
  const seen = new Set()
  const resolved = []
  const items = Array.isArray(values) ? values : []

  for (const item of items) {
    if (!item) continue
    let id = ''
    if (typeof item === 'object') {
      id = item._ref || item._id || ''
    } else if (typeof item === 'string') {
      if (item === ALL_VALUE) continue
      if (lookup.byId.has(item)) {
        id = item
      } else {
        const key = normalizeKey(item)
        const looseKey = normalizeKeyLoose(item)
        const match = lookup.byKey.get(key) || lookup.byKey.get(looseKey)
        id = match?._id || ''
      }
    }

    if (!id || seen.has(id)) continue
    if (!lookup.byId.has(id)) continue
    seen.add(id)
    resolved.push(id)
  }

  return resolved
}

function buildReferences(ids) {
  return Array.from(new Set(ids)).map((id) => ({ _type: 'reference', _ref: id, _key: id }))
}

async function fetchAreas() {
  return client.fetch(`*[_type == "therapeuticArea"]{ _id, name, "slug": slug.current }`)
}

async function fetchSubscribers() {
  return client.fetch(`*[_type == "updateSubscriber"]{ _id, interestAreas, allTherapeuticAreas }`)
}

async function migrate() {
  const [areas, subscribers] = await Promise.all([fetchAreas(), fetchSubscribers()])
  const lookup = buildAreaLookup(areas)

  for (const subscriber of subscribers || []) {
    const rawAreas = Array.isArray(subscriber?.interestAreas) ? subscriber.interestAreas : []
    const legacyAll = rawAreas.includes(ALL_VALUE)
    const allTherapeuticAreas = Boolean(subscriber?.allTherapeuticAreas) || legacyAll
    const resolvedIds = allTherapeuticAreas ? [] : resolveAreaIds(rawAreas, lookup)
    const nextReferences = buildReferences(resolvedIds)

    const hasLegacyStrings = rawAreas.some((item) => typeof item === 'string')
    const shouldUpdate =
      legacyAll ||
      hasLegacyStrings ||
      Boolean(subscriber?.allTherapeuticAreas) !== allTherapeuticAreas

    if (!shouldUpdate) {
      continue
    }

    if (dryRun) {
      console.log(
        `[dry-run] updateSubscriber ${subscriber._id} -> allTherapeuticAreas=${allTherapeuticAreas} interestAreas=${resolvedIds.length}`
      )
      continue
    }

    try {
      await client
        .patch(subscriber._id)
        .set({
          allTherapeuticAreas,
          interestAreas: nextReferences,
          updatedAt: new Date().toISOString(),
        })
        .commit({ returnDocuments: false })
      console.log(`[migrate] updated updateSubscriber ${subscriber._id}`)
    } catch (err) {
      console.error(`[migrate] failed updateSubscriber ${subscriber._id}: ${err.message}`)
    }
  }
}

async function main() {
  console.log('[migrate] Starting updateSubscriber interest area migration...')
  if (dryRun) console.log('[migrate] DRY_RUN=true (no writes)')
  await migrate()
  console.log('[migrate] Done.')
}

main().catch((err) => {
  console.error('[migrate] Fatal error:', err.message)
  process.exit(1)
})
