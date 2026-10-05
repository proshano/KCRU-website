/**
 * Maintenance: list, create, rename or flag Research Site documents without
 * opening Studio. Driven by environment variables so the GitHub Actions
 * workflow (site-admin.yml) can pass names with apostrophes safely.
 *
 *   SITE_ACTION       list | create | rename | set
 *   SITE_TARGET       the site to change: its id, short name or name (rename, set)
 *   SITE_NAME         the new or full name (create, rename)
 *   SITE_SHORT_NAME   optional short name (create, rename)
 *   SITE_TYPE         create only, defaults to academic_hospital
 *   SITE_CITY         create only, defaults to London
 *   SITE_PROVINCE     create only, defaults to Ontario
 *   SITE_COORDINATES  true | false  (create, set) "Coordinates studies"
 *   SITE_RECRUITS     true | false  (create, set) "Patients can be enrolled here"
 *   SITE_ACTIVE       true | false  (set)
 *   SITE_APPLY        true to write; anything else prints the plan only
 *
 * Writes are revision-guarded and also reach an unpublished Studio draft of the
 * site, so publishing the draft later cannot undo the change. The app lists only
 * sites whose `active` is true, so a site without the field counts as inactive.
 * A created site gets an id derived from its name and is written with
 * createIfNotExists, so running the same create twice (or in parallel) adds
 * nothing the second time.
 *
 * Usage:
 *   SITE_ACTION=list npm run sites
 *   SITE_ACTION=rename SITE_TARGET="UH" SITE_NAME="New name" SITE_APPLY=true npm run sites
 *   SITE_ACTION=create SITE_NAME="St. Joseph's Health Care" SITE_SHORT_NAME="SJHC" SITE_COORDINATES=true SITE_RECRUITS=true SITE_APPLY=true npm run sites
 */

import { pathToFileURL } from 'node:url'

const SITE_TYPES = new Set([
  'academic_hospital',
  'community_hospital',
  'dialysis_centre',
  'private_clinic',
  'university',
  'research_institute',
])

const SITE_QUERY = `
  *[_type == "site"] | order(order asc, name asc) {
    _id,
    _rev,
    name,
    shortName,
    type,
    city,
    province,
    coordinatesStudies,
    recruitsPatients,
    active,
    order
  }
`

function clean(value) {
  return String(value ?? '').trim()
}

function parseFlag(value) {
  const cleaned = clean(value).toLowerCase()
  if (cleaned === 'true') return true
  if (cleaned === 'false') return false
  return undefined
}

function describe(site) {
  const flags = [
    site.coordinatesStudies ? 'coordinates studies' : '',
    site.recruitsPatients ? 'enrols patients' : '',
    site.active === true ? '' : 'inactive (hidden from the site until active is set)',
  ].filter(Boolean)
  return `${site.name || '(unnamed)'}${site.shortName ? ` (${site.shortName})` : ''} [${site._id}]${flags.length ? ` - ${flags.join(', ')}` : ''}`
}

// Deterministic id for a new site, e.g. "Goderich satellite" -> site-goderich-satellite.
export function siteIdFromName(name) {
  const slug = clean(name)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return `site-${slug}`
}

function isDraft(site) {
  return String(site._id || '').startsWith('drafts.')
}

// A site by id, short name or name (case-insensitive), published copies first.
function findSite(sites, target) {
  const wanted = clean(target).toLowerCase()
  if (!wanted) return null
  const published = sites.filter((site) => !isDraft(site))
  return (
    published.find((site) => site._id === target) ||
    published.find((site) => clean(site.shortName).toLowerCase() === wanted) ||
    published.find((site) => clean(site.name).toLowerCase() === wanted) ||
    null
  )
}

/**
 * Pure planning step, exported for tests. `sites` is every site document
 * including drafts.* copies. Returns the mutations to commit, lines to print
 * and any errors (which stop the run).
 */
export function planSiteAction({ action, sites = [], input = {} }) {
  const lines = []
  const errors = []
  const mutations = []
  const published = sites.filter((site) => !isDraft(site))

  if (action === 'list') {
    if (!published.length) lines.push('No sites.')
    for (const site of published) lines.push(describe(site))
    return { mutations, lines, errors }
  }

  if (action === 'create') {
    const name = clean(input.name)
    const type = clean(input.type) || 'academic_hospital'
    if (!name) errors.push('SITE_NAME is required to create a site.')
    if (!SITE_TYPES.has(type)) errors.push(`SITE_TYPE "${type}" is not one of ${[...SITE_TYPES].join(', ')}.`)
    if (errors.length) return { mutations, lines, errors }
    const id = siteIdFromName(name)
    const duplicate = published.find((site) => site._id === id || clean(site.name).toLowerCase() === name.toLowerCase())
    if (duplicate) {
      lines.push(`${describe(duplicate)}: already exists, nothing to create.`)
      return { mutations, lines, errors }
    }

    const maxOrder = published.reduce((max, site) => (Number.isFinite(site.order) ? Math.max(max, site.order) : max), 0)
    const doc = {
      _id: id,
      _type: 'site',
      name,
      shortName: clean(input.shortName) || undefined,
      type,
      city: clean(input.city) || 'London',
      province: clean(input.province) || 'Ontario',
      coordinatesStudies: parseFlag(input.coordinates) === true,
      recruitsPatients: parseFlag(input.recruits) === true,
      active: true,
      order: maxOrder + 1,
    }
    mutations.push({ createIfNotExists: doc })
    lines.push(`Create ${describe(doc)}`)
    return { mutations, lines, errors }
  }

  if (action === 'rename' || action === 'set') {
    const target = findSite(sites, input.target)
    if (!target) {
      errors.push(`No site matches "${clean(input.target)}". Sites: ${published.map((site) => describe(site)).join('; ') || 'none'}.`)
      return { mutations, lines, errors }
    }

    const set = {}
    if (action === 'rename') {
      const name = clean(input.name)
      if (!name) errors.push('SITE_NAME is required to rename a site.')
      else if (name !== target.name) set.name = name
      const shortName = clean(input.shortName)
      if (shortName && shortName !== target.shortName) set.shortName = shortName
    } else {
      const coordinates = parseFlag(input.coordinates)
      const recruits = parseFlag(input.recruits)
      const active = parseFlag(input.active)
      if (coordinates !== undefined && coordinates !== Boolean(target.coordinatesStudies)) set.coordinatesStudies = coordinates
      if (recruits !== undefined && recruits !== Boolean(target.recruitsPatients)) set.recruitsPatients = recruits
      if (active !== undefined && active !== (target.active === true)) set.active = active
      if (coordinates === undefined && recruits === undefined && active === undefined) {
        errors.push('Set at least one of SITE_COORDINATES, SITE_RECRUITS or SITE_ACTIVE to true or false.')
      }
    }
    if (errors.length) return { mutations, lines, errors }
    if (!Object.keys(set).length) {
      lines.push(`${describe(target)}: already as requested, nothing to change.`)
      return { mutations, lines, errors }
    }

    const draft = sites.find((site) => site._id === `drafts.${target._id}`)
    for (const doc of [target, draft].filter(Boolean)) {
      mutations.push({ patch: { id: doc._id, rev: doc._rev, set } })
    }
    const changes = Object.entries(set).map(([key, value]) => `${key}: ${JSON.stringify(doc(target)[key])} -> ${JSON.stringify(value)}`)
    lines.push(`${describe(target)}: ${changes.join(', ')}${draft ? ' (and its Studio draft)' : ''}`)
    return { mutations, lines, errors }
  }

  errors.push(`SITE_ACTION must be list, create, rename or set (got "${clean(action)}").`)
  return { mutations, lines, errors }
}

function doc(site) {
  return {
    name: site.name,
    shortName: site.shortName,
    coordinatesStudies: Boolean(site.coordinatesStudies),
    recruitsPatients: Boolean(site.recruitsPatients),
    active: site.active === true,
  }
}

async function commit(client, mutations) {
  let transaction = client.transaction()
  for (const mutation of mutations) {
    if (mutation.createIfNotExists) {
      transaction = transaction.createIfNotExists(mutation.createIfNotExists)
    } else {
      transaction = transaction.patch(mutation.patch.id, (builder) =>
        builder.ifRevisionId(mutation.patch.rev).set(mutation.patch.set)
      )
    }
  }
  await transaction.commit()
}

async function main() {
  const apply = clean(process.env.SITE_APPLY).toLowerCase() === 'true'
  const action = clean(process.env.SITE_ACTION).toLowerCase() || 'list'
  const input = {
    target: process.env.SITE_TARGET,
    name: process.env.SITE_NAME,
    shortName: process.env.SITE_SHORT_NAME,
    type: process.env.SITE_TYPE,
    city: process.env.SITE_CITY,
    province: process.env.SITE_PROVINCE,
    coordinates: process.env.SITE_COORDINATES,
    recruits: process.env.SITE_RECRUITS,
    active: process.env.SITE_ACTIVE,
  }

  const { writeClient } = await import('../lib/sanity.js')
  if (apply && !writeClient.config().token) {
    console.error('SANITY_API_TOKEN is required to apply changes.')
    process.exit(1)
  }

  const sites = await writeClient.fetch(SITE_QUERY)
  const plan = planSiteAction({ action, sites, input })
  for (const line of plan.lines) console.log(line)
  for (const error of plan.errors) console.error(`Error: ${error}`)
  if (plan.errors.length) process.exit(1)

  if (!plan.mutations.length) return
  if (!apply) {
    console.log('Dry run: set SITE_APPLY=true to write this change.')
    return
  }
  await commit(writeClient, plan.mutations)
  console.log('Done.')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error)
    process.exit(1)
  })
}
