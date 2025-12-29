/**
 * Sync therapeutic area documents with the subscription interest-area list.
 *
 * Usage:
 *   SANITY_API_TOKEN=... node scripts/sync-therapeutic-areas.js
 *   DRY_RUN=true SANITY_API_TOKEN=... node scripts/sync-therapeutic-areas.js
 */

import { createClient } from '@sanity/client'
import { THERAPEUTIC_AREA_OPTIONS } from '../lib/communicationOptions.js'

const projectId = process.env.NEXT_PUBLIC_SANITY_PROJECT_ID || 't6eeltne'
const dataset = process.env.NEXT_PUBLIC_SANITY_DATASET || 'production'
const token = process.env.SANITY_API_TOKEN
const dryRun = process.env.DRY_RUN === 'true'

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

function slugify(input) {
  return String(input)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
}

async function fetchExistingAreas() {
  return client.fetch(`*[_type == "therapeuticArea"]{ _id, name, slug, active, order }`)
}

async function upsertAreas(existing) {
  const existingByName = new Map()
  for (const item of existing) {
    const key = String(item?.name || '').toLowerCase()
    if (!key) continue
    if (!existingByName.has(key)) {
      existingByName.set(key, item)
    }
  }

  for (const [index, option] of THERAPEUTIC_AREA_OPTIONS.entries()) {
    const key = option.title.toLowerCase()
    const found = existingByName.get(key)
    const order = index + 1

    if (found?._id) {
      if (dryRun) {
        console.log(`[dry-run] update ${found._id} -> active true, order ${order}`)
        continue
      }
      try {
        const patch = client
          .patch(found._id)
          .set({ name: option.title, active: true, order })

        if (!found.slug?.current) {
          patch.set({ slug: { _type: 'slug', current: slugify(option.title) } })
        }

        await patch.commit({ returnDocuments: false })
        console.log(`[sync] updated ${found._id}`)
      } catch (err) {
        console.error(`[sync] failed to update ${found._id}: ${err.message}`)
      }
      continue
    }

    if (dryRun) {
      console.log(`[dry-run] create therapeuticArea ${option.title}`)
      continue
    }

    try {
      await client.create({
        _type: 'therapeuticArea',
        name: option.title,
        slug: { _type: 'slug', current: slugify(option.title) },
        active: true,
        order
      })
      console.log(`[sync] created ${option.title}`)
    } catch (err) {
      console.error(`[sync] failed to create ${option.title}: ${err.message}`)
    }
  }
}

async function deactivateMissing(existing) {
  const allowed = new Set(THERAPEUTIC_AREA_OPTIONS.map((item) => item.title.toLowerCase()))
  const toDeactivate = existing.filter((item) => {
    const key = String(item?.name || '').toLowerCase()
    return key && !allowed.has(key) && item.active !== false
  })

  for (const item of toDeactivate) {
    if (dryRun) {
      console.log(`[dry-run] deactivate ${item._id} (${item.name})`)
      continue
    }
    try {
      await client.patch(item._id).set({ active: false }).commit({ returnDocuments: false })
      console.log(`[sync] deactivated ${item._id} (${item.name})`)
    } catch (err) {
      console.error(`[sync] failed to deactivate ${item._id}: ${err.message}`)
    }
  }
}

async function main() {
  console.log('[sync] Starting therapeutic area sync...')
  if (dryRun) console.log('[sync] DRY_RUN=true (no writes)')

  const existing = await fetchExistingAreas()
  await upsertAreas(existing)
  await deactivateMissing(existing)

  console.log('[sync] Done.')
}

main().catch((err) => {
  console.error('[sync] Fatal error:', err.message)
  process.exit(1)
})
