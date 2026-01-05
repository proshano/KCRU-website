/**
 * Maintenance: ensure therapeutic areas have slugs, active flags, and ordering.
 *
 * Usage:
 *   SANITY_API_TOKEN=... node scripts/sync-therapeutic-areas.js
 *   DRY_RUN=true SANITY_API_TOKEN=... node scripts/sync-therapeutic-areas.js
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

function slugify(input) {
  return String(input || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
}

async function fetchAreas() {
  return client.fetch(
    `*[_type == "therapeuticArea"] | order(order asc, name asc) {
      _id,
      name,
      slug,
      active,
      order
    }`
  )
}

async function updateAreas(areas) {
  const rows = Array.isArray(areas) ? areas : []
  for (const [index, area] of rows.entries()) {
    if (!area?._id) continue
    let patch = client.patch(area._id)
    let hasChanges = false

    if (!area.slug?.current && area.name) {
      patch = patch.set({ slug: { _type: 'slug', current: slugify(area.name) } })
      hasChanges = true
    }

    if (area.active === undefined) {
      patch = patch.set({ active: true })
      hasChanges = true
    }

    if (area.order === undefined || area.order === null) {
      patch = patch.set({ order: index + 1 })
      hasChanges = true
    }

    if (!hasChanges) continue

    if (dryRun) {
      console.log(`[dry-run] update therapeuticArea ${area._id}`)
      continue
    }

    try {
      await patch.commit({ returnDocuments: false })
      console.log(`[sync] updated therapeuticArea ${area._id}`)
    } catch (err) {
      console.error(`[sync] failed to update ${area._id}: ${err.message}`)
    }
  }
}

async function main() {
  console.log('[sync] Starting therapeutic area maintenance...')
  if (dryRun) console.log('[sync] DRY_RUN=true (no writes)')

  const areas = await fetchAreas()
  await updateAreas(areas)

  console.log('[sync] Done.')
}

main().catch((err) => {
  console.error('[sync] Fatal error:', err.message)
  process.exit(1)
})
