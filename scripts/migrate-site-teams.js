/**
 * Migration: turn each study's single PI and contact into one study team.
 *
 * Every trialSummary (published and Studio drafts) that has no `siteTeams` gets
 * one team built from its legacy fields: principal investigator (or the free-text
 * name), local contact and "accepts referrals". The team's enrolment status
 * follows the study status, and its coordinating site is the PI's primary site
 * when that researcher has one that coordinates studies; otherwise the team is
 * left without a site and the study is listed under "needs a coordinating site"
 * for a coordinator to fix in the Study Manager.
 *
 * A PI who is not a researcher record (or has no primary site) can be placed by
 * name with SITE_TEAMS_PI_SITES, one "PI name = site" pair per line or separated
 * by semicolons, where the site is a coordinating site's name, short name or id:
 *   SITE_TEAMS_PI_SITES="Kristin Clemens = St. Joseph's Health Care; Alp Sener = UH"
 *
 * Submissions and drafts are not rewritten: normalizeStudyPayload builds the team
 * from a legacy payload every time one is read.
 *
 * Usage:
 *   npm run migrate:site-teams                              # dry run, one line per study
 *   npm run migrate:site-teams -- --apply                   # writes siteTeams, revision-guarded
 *   npm run migrate:site-teams -- --apply --remove-legacy   # also unsets the legacy fields
 *
 * --remove-legacy refuses to run while any study still has no team with a PI,
 * so the old fields are never dropped before their replacement exists.
 */

import { pathToFileURL } from 'node:url'

import { LEGACY_STUDY_FIELDS } from '../lib/studySubmissions.js'
import {
  coordinatingSites,
  legacyPayloadTeam,
  payloadTeamsToSanity,
  resolvePayloadTeams,
  siteLabel,
} from '../lib/studyTeams.js'

const STUDY_QUERY = `
  *[_type == "trialSummary"] | order(title asc) {
    _id,
    _rev,
    title,
    status,
    siteTeams,
    "principalInvestigatorId": principalInvestigator._ref,
    principalInvestigatorName,
    localContact,
    acceptsReferrals
  }
`

// Published researchers only: a primarySite set on an unpublished Studio draft
// is reported, not used.
const RESEARCHER_QUERY = `
  *[_type == "researcher" && !(_id in path("drafts.**"))] {
    _id,
    name,
    "primarySiteId": primarySite._ref,
    "draftPrimarySiteId": *[_id == "drafts." + ^._id][0].primarySite._ref
  }
`

const SITE_QUERY = `*[_type == "site"] { _id, name, shortName, coordinatesStudies }`

function normalizePersonName(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/^\s*dr\.?\s+/, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

// "PI name = site" pairs, separated by newlines or semicolons.
export function parsePiSiteOverrides(text) {
  return String(text || '')
    .split(/[\n;]+/)
    .map((entry) => entry.trim())
    .filter((entry) => entry && !entry.startsWith('#'))
    .map((entry) => {
      const index = entry.indexOf('=')
      if (index === -1) throw new Error(`PI site override "${entry}" must look like "PI name = site".`)
      const pi = entry.slice(0, index).trim()
      const site = entry.slice(index + 1).trim()
      if (!pi || !site) throw new Error(`PI site override "${entry}" must look like "PI name = site".`)
      return { pi, site }
    })
}

function findCoordinatingSite(label, coordinating) {
  const wanted = String(label || '').trim().toLowerCase()
  return (
    coordinating.find((site) => site._id === label) ||
    coordinating.find((site) => String(site.shortName || '').trim().toLowerCase() === wanted) ||
    coordinating.find((site) => String(site.name || '').trim().toLowerCase() === wanted) ||
    null
  )
}

function hasLegacyFields(study) {
  return LEGACY_STUDY_FIELDS.some((field) => {
    if (field === 'principalInvestigator') return Boolean(study.principalInvestigatorId)
    return study[field] !== undefined && study[field] !== null
  })
}

/**
 * Pure planning step, exported for tests. Returns the patches to write and a
 * report with one line per study.
 */
export function planSiteTeamMigration({ studies = [], researchers = [], sites = [], piSites = [] } = {}) {
  const coordinatingList = coordinatingSites(sites)
  const coordinating = new Map(coordinatingList.map((site) => [site._id, site]))
  const researcherById = new Map(researchers.map((researcher) => [researcher._id, researcher]))

  const errors = []
  const overrides = new Map()
  for (const override of piSites) {
    const site = findCoordinatingSite(override.site, coordinatingList)
    if (!site) {
      const available = coordinatingList.map((candidate) => siteLabel(candidate)).join(', ') || 'none'
      errors.push(`No coordinating site matches "${override.site}" (for PI "${override.pi}"). Coordinating sites: ${available}.`)
      continue
    }
    overrides.set(normalizePersonName(override.pi), { pi: override.pi, site, used: 0 })
  }

  const patches = []
  const lines = []
  const counts = {
    studies: studies.length,
    alreadyMigrated: 0,
    converted: 0,
    siteInferred: 0,
    siteFromOverride: 0,
    needsSite: 0,
    noLegacyData: 0,
  }

  for (const study of studies) {
    const label = `${study.title || 'Untitled'} [${study._id}]`
    if (Array.isArray(study.siteTeams) && study.siteTeams.length) {
      counts.alreadyMigrated += 1
      continue
    }
    const team = legacyPayloadTeam(study)
    if (!team) {
      counts.noLegacyData += 1
      lines.push(`${label} -> no PI or contact to convert; add a team in the Study Manager`)
      continue
    }

    const researcher = researcherById.get(team.principalInvestigatorId)
    const inferredSite = researcher?.primarySiteId ? coordinating.get(researcher.primarySiteId) : null
    const piName = researcher?.name || team.principalInvestigatorName
    const override = overrides.get(normalizePersonName(piName))
    if (inferredSite) {
      team.siteId = inferredSite._id
      team._key = `site-${inferredSite._id}`
      counts.siteInferred += 1
      lines.push(`${label} -> ${siteLabel(inferredSite)} (from ${researcher.name}'s primary site)`)
    } else if (override) {
      team.siteId = override.site._id
      team._key = `site-${override.site._id}`
      override.used += 1
      counts.siteFromOverride += 1
      lines.push(`${label} -> ${siteLabel(override.site)} (from the PI site override for "${override.pi}")`)
    } else {
      counts.needsSite += 1
      const reason = !researcher
        ? team.principalInvestigatorName
          ? `PI "${team.principalInvestigatorName}" is not a researcher record`
          : 'no PI recorded'
        : researcher.draftPrimarySiteId
          ? `${researcher.name}'s primary site is set only on an unpublished Studio draft; publish it and rerun`
          : researcher.primarySiteId
            ? `${researcher.name}'s primary site does not coordinate studies`
            : `${researcher.name} has no primary site`
      lines.push(`${label} -> no site (${reason})`)
    }

    counts.converted += 1
    patches.push({ id: study._id, rev: study._rev, set: { siteTeams: payloadTeamsToSanity([team]) } })
  }

  for (const override of overrides.values()) {
    if (!override.used) lines.push(`PI site override for "${override.pi}" matched no study.`)
  }

  return { patches, lines, counts, errors }
}

/**
 * Pure planning step for --remove-legacy, exported for tests. Refuses when any
 * study (including drafts) still lacks a team with a PI.
 */
export function planLegacyRemoval({ studies = [] } = {}) {
  const blocking = studies.filter(
    (study) => !resolvePayloadTeams(study).some((team) => team.principalInvestigatorId || team.principalInvestigatorName)
  )
  if (blocking.length) {
    return {
      ok: false,
      blocking: blocking.map((study) => `${study.title || 'Untitled'} [${study._id}]`),
      patches: [],
    }
  }
  const withTeams = studies.filter((study) => Array.isArray(study.siteTeams) && study.siteTeams.length)
  const stillLegacyOnly = studies.length - withTeams.length
  if (stillLegacyOnly > 0) {
    return {
      ok: false,
      blocking: studies
        .filter((study) => !(Array.isArray(study.siteTeams) && study.siteTeams.length))
        .map((study) => `${study.title || 'Untitled'} [${study._id}] has no siteTeams yet; run --apply first`),
      patches: [],
    }
  }
  return {
    ok: true,
    blocking: [],
    patches: studies
      .filter(hasLegacyFields)
      .map((study) => ({ id: study._id, rev: study._rev, unset: [...LEGACY_STUDY_FIELDS] })),
  }
}

async function commitPatches(client, patches) {
  if (!patches.length) return
  let transaction = client.transaction()
  for (const patch of patches) {
    transaction = transaction.patch(patch.id, (builder) => {
      const guarded = builder.ifRevisionId(patch.rev)
      if (patch.set) return guarded.set(patch.set)
      return guarded.unset(patch.unset)
    })
  }
  await transaction.commit()
}

async function main() {
  const args = process.argv.slice(2)
  const apply = args.includes('--apply')
  const removeLegacy = args.includes('--remove-legacy')

  const { writeClient } = await import('../lib/sanity.js')
  if (apply && !writeClient.config().token) {
    console.error('SANITY_API_TOKEN is required to apply the migration.')
    process.exit(1)
  }

  const [studies, researchers, sites] = await Promise.all([
    writeClient.fetch(STUDY_QUERY),
    writeClient.fetch(RESEARCHER_QUERY),
    writeClient.fetch(SITE_QUERY),
  ])

  const piSites = parsePiSiteOverrides(process.env.SITE_TEAMS_PI_SITES)
  const plan = planSiteTeamMigration({ studies, researchers, sites, piSites })
  for (const line of plan.lines) console.log(line)
  for (const error of plan.errors) console.error(`Error: ${error}`)
  console.log(JSON.stringify({ ...plan.counts, applied: apply && !plan.errors.length }, null, 2))

  if (plan.errors.length) {
    console.error('Fix the PI site overrides above and rerun.')
    process.exit(1)
  }

  if (apply && plan.patches.length) {
    await commitPatches(writeClient, plan.patches)
    console.log(`Wrote siteTeams on ${plan.patches.length} stud${plan.patches.length === 1 ? 'y' : 'ies'}.`)
  }

  if (!removeLegacy) return

  // Re-read so the guard sees the teams written above.
  const current = apply ? await writeClient.fetch(STUDY_QUERY) : studies
  const removal = planLegacyRemoval({ studies: current })
  if (!removal.ok) {
    console.error('Legacy fields were not removed. Fix these studies first:')
    for (const line of removal.blocking) console.error(`- ${line}`)
    process.exit(1)
  }
  console.log(`Legacy fields to remove on ${removal.patches.length} document(s).`)
  if (apply && removal.patches.length) {
    await commitPatches(writeClient, removal.patches)
    console.log('Legacy fields removed.')
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error)
    process.exit(1)
  })
}
