import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import {
  buildPublicationAttributionReviewDocument,
} from '../lib/publicationAttributionReview.js'
import { getPublicationKey } from '../lib/publicationIdentity.js'
import { normalizeResearcherPublicationExclusion } from '../lib/researcherPublicationIdentity.js'

export const REVIEWED_CACHE_TIMESTAMP = '2026-08-25T09:42:28.404Z'
export const REVIEWED_PUBLICATION_COUNT = 446
export const REVIEWED_ACTIVE_LINK_COUNT = 636
export const REVIEWED_PUBMED_LINK_COUNT = 582
export const REVIEWED_APPROVAL_COUNT = 53
export const REVIEWED_REJECTION_COUNT = 1
export const DANIELLE_NASH_NAME = 'Danielle Nash'
export const DANIELLE_FALSE_DOI = '10.1016/j.fusengdes.2026.115999'
export const DANIELLE_FALSE_KEY = `doi:${DANIELLE_FALSE_DOI}`

function isPubmedPublication(publication = {}) {
  return publication.source === 'pubmed' || publication.sources?.includes('pubmed')
}

function getPublicationMap(publications = []) {
  return new Map(publications.map((publication) => [getPublicationKey(publication), publication]))
}

function activeLinks(cache = {}) {
  const publicationByKey = getPublicationMap(cache.publications || [])
  const links = []
  for (const entry of cache.provenance || []) {
    const publicationKey = entry.publicationKey || (entry.pmid ? `pmid:${entry.pmid}` : null)
    const publication = publicationByKey.get(publicationKey)
    if (!publication) continue
    for (const researcherId of entry.researcherIds || []) {
      links.push({ publicationKey, publication, researcherId })
    }
  }
  return links
}

function assertReviewedBaseline({ cache, links, pubmedLinks, secondaryLinks, falseLinks }) {
  const mismatches = []
  if (cache.lastRefreshedAt !== REVIEWED_CACHE_TIMESTAMP) {
    mismatches.push(`timestamp ${cache.lastRefreshedAt || 'missing'} (expected ${REVIEWED_CACHE_TIMESTAMP})`)
  }
  if ((cache.publications || []).length !== REVIEWED_PUBLICATION_COUNT) {
    mismatches.push(`publications ${(cache.publications || []).length} (expected ${REVIEWED_PUBLICATION_COUNT})`)
  }
  if (links.length !== REVIEWED_ACTIVE_LINK_COUNT) {
    mismatches.push(`active links ${links.length} (expected ${REVIEWED_ACTIVE_LINK_COUNT})`)
  }
  if (pubmedLinks.length !== REVIEWED_PUBMED_LINK_COUNT) {
    mismatches.push(`PubMed links ${pubmedLinks.length} (expected ${REVIEWED_PUBMED_LINK_COUNT})`)
  }
  if (secondaryLinks.length !== REVIEWED_APPROVAL_COUNT + REVIEWED_REJECTION_COUNT) {
    mismatches.push(`secondary links ${secondaryLinks.length} (expected ${REVIEWED_APPROVAL_COUNT + REVIEWED_REJECTION_COUNT})`)
  }
  if (falseLinks.length !== REVIEWED_REJECTION_COUNT) {
    mismatches.push(`Danielle false links ${falseLinks.length} (expected ${REVIEWED_REJECTION_COUNT})`)
  }
  if (mismatches.length) {
    throw new Error(`Reviewed publication cache snapshot mismatch: ${mismatches.join('; ')}. No migration writes are allowed.`)
  }
}

function buildReviewedDocument({ link, researcher, status, now }) {
  const isApproved = status === 'approved'
  return buildPublicationAttributionReviewDocument({
    researcher,
    publication: link.publication,
    evaluation: {
      reason: isApproved
        ? 'Manually reviewed as correct in the 2026-08-25 secondary-source baseline.'
        : 'Manually reviewed as a Danielle Nash namesake false attribution.',
      evidence: {
        isManuallyConfirmed: isApproved,
        isManuallyRejected: !isApproved,
        isPubmedConfirmed: false,
        queryPaths: link.publication.attributionQueryPaths || [],
      },
    },
    status,
    now,
    reviewedBy: 'migration:reviewed-baseline-2026-08-25',
  })
}

function stripSystemFields(document = {}) {
  const { _rev, _createdAt, _updatedAt, ...portable } = document
  return portable
}

function correctCache(cache, danielleId) {
  const falseEntry = (cache.provenance || []).find((entry) => {
    return entry.publicationKey === DANIELLE_FALSE_KEY && (entry.researcherIds || []).includes(danielleId)
  })
  const remainingFalseResearchers = (falseEntry?.researcherIds || []).filter((id) => id !== danielleId)
  const removeFalsePublication = remainingFalseResearchers.length === 0
  const publications = (cache.publications || []).filter((publication) => {
    return !removeFalsePublication || getPublicationKey(publication) !== DANIELLE_FALSE_KEY
  })
  const provenance = []
  for (const entry of cache.provenance || []) {
    if (entry.publicationKey !== DANIELLE_FALSE_KEY) {
      provenance.push(entry)
      continue
    }
    const researcherIds = (entry.researcherIds || []).filter((id) => id !== danielleId)
    if (researcherIds.length) provenance.push({ ...entry, researcherIds })
  }

  return {
    ...stripSystemFields(cache),
    publications,
    provenance,
    stats: {
      ...(cache.stats || {}),
      totalPublications: publications.length,
    },
  }
}

export function planPublicationAttributionMigration({ cache, researchers = [], existingReviews = [], now = new Date() } = {}) {
  const links = activeLinks(cache)
  const pubmedLinks = links.filter((link) => isPubmedPublication(link.publication))
  const secondaryLinks = links.filter((link) => !isPubmedPublication(link.publication))
  const researcherById = new Map(researchers.map((researcher) => [researcher._id, researcher]))
  const danielle = researchers.find((researcher) => researcher.name === DANIELLE_NASH_NAME)
  if (!danielle?._id) throw new Error('Danielle Nash researcher document was not found.')
  const falseLinks = secondaryLinks.filter((link) => {
    return link.researcherId === danielle._id && link.publicationKey === DANIELLE_FALSE_KEY
  })
  assertReviewedBaseline({ cache, links, pubmedLinks, secondaryLinks, falseLinks })

  const approvalLinks = secondaryLinks.filter((link) => !falseLinks.includes(link))
  const rejectionLinks = falseLinks
  if (approvalLinks.length !== REVIEWED_APPROVAL_COUNT || rejectionLinks.length !== REVIEWED_REJECTION_COUNT) {
    throw new Error(`Migration decision counts must be ${REVIEWED_APPROVAL_COUNT}/${REVIEWED_REJECTION_COUNT}; found ${approvalLinks.length}/${rejectionLinks.length}.`)
  }

  const reviewDocuments = [
    ...approvalLinks.map((link) => buildReviewedDocument({
      link,
      researcher: researcherById.get(link.researcherId),
      status: 'approved',
      now,
    })),
    ...rejectionLinks.map((link) => buildReviewedDocument({
      link,
      researcher: danielle,
      status: 'rejected',
      now,
    })),
  ]
  const existingById = new Map(existingReviews.map((review) => [review._id, review]))
  for (const document of reviewDocuments) {
    const existing = existingById.get(document._id)
    if (existing && existing.status !== document.status) {
      throw new Error(`Existing review ${document._id} has status ${existing.status}; migration expected ${document.status}.`)
    }
  }

  const normalizedFalseKey = normalizeResearcherPublicationExclusion(DANIELLE_FALSE_KEY)
  const danielleExclusions = (danielle.publicationExclusions || []).filter((value) => {
    return normalizeResearcherPublicationExclusion(value) !== normalizedFalseKey
  })
  danielleExclusions.push(DANIELLE_FALSE_KEY)
  const correctedCache = correctCache(cache, danielle._id)

  return {
    counts: {
      publications: cache.publications.length,
      activeLinks: links.length,
      pubmedConfirmedLinks: pubmedLinks.length,
      secondaryLinks: secondaryLinks.length,
      approvedReviews: approvalLinks.length,
      rejectedReviews: rejectionLinks.length,
      reviewedCorrectLinks: links.length - falseLinks.length,
      correctedPublications: correctedCache.publications.length,
      correctedActiveLinks: activeLinks(correctedCache).length,
    },
    reviewDocuments,
    danielle,
    danielleExclusions,
    correctedCache,
  }
}

async function fetchMigrationInput() {
  const { client } = await import('../lib/sanity.js')
  return client.withConfig({ useCdn: false }).fetch(`{
    "cache": *[_id == "pubmedCache"][0],
    "researchers": *[_type == "researcher"]{
      _id,
      _type,
      _rev,
      _createdAt,
      _updatedAt,
      name,
      publicationAuthorName,
      publicationExclusions,
      pubmedQuery,
      orcid
    },
    "settings": *[_type == "siteSettings"][0],
    "existingReviews": *[_type == "publicationAttributionReview"]
  }`)
}

function defaultBackupDirectory() {
  return path.resolve(process.cwd(), '..', 'KCRU website publication attribution backups')
}

async function writeBackup(input, backupDirectory) {
  const directory = path.resolve(backupDirectory || defaultBackupDirectory())
  await fs.mkdir(directory, { recursive: true })
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const backupPath = path.join(directory, `publication-attribution-migration-${timestamp}.json`)
  await fs.writeFile(backupPath, JSON.stringify({ exportedAt: new Date().toISOString(), ...input }, null, 2), 'utf8')
  return backupPath
}

async function applyMigration(input, plan, backupDirectory) {
  const { writeClient } = await import('../lib/sanity.js')
  if (!writeClient.config().token) {
    throw new Error('SANITY_API_TOKEN missing; migration cannot be applied.')
  }
  const backupPath = await writeBackup(input, backupDirectory)
  const settingsId = input.settings?._id
  if (!settingsId) throw new Error('Site settings document was not found.')

  const transaction = writeClient.transaction()
  for (const document of plan.reviewDocuments) transaction.createIfNotExists(document)
  transaction.patch(plan.danielle._id, (patch) => patch.set({ publicationExclusions: plan.danielleExclusions }))
  transaction.createOrReplace(plan.correctedCache)
  transaction.patch(settingsId, (patch) => patch
    .setIfMissing({ publicationAttributionReview: {} })
    .set({ 'publicationAttributionReview.enabled': true }))
  await transaction.commit()
  return { backupPath }
}

function parseArguments(argv = []) {
  const apply = argv.includes('--apply')
  const backupIndex = argv.indexOf('--backup-dir')
  const backupDirectory = backupIndex >= 0 ? argv[backupIndex + 1] : null
  return { apply, backupDirectory }
}

async function main() {
  const options = parseArguments(process.argv.slice(2))
  const input = await fetchMigrationInput()
  const plan = planPublicationAttributionMigration(input)
  const report = {
    mode: options.apply ? 'apply' : 'dry-run',
    expectedTimestamp: REVIEWED_CACHE_TIMESTAMP,
    observedTimestamp: input.cache?.lastRefreshedAt,
    ...plan.counts,
    danielleFalsePublication: DANIELLE_FALSE_KEY,
    gateWillBeEnabled: options.apply,
  }

  if (!options.apply) {
    console.log(JSON.stringify(report, null, 2))
    return
  }

  const result = await applyMigration(input, plan, options.backupDirectory)
  console.log(JSON.stringify({ ...report, applied: true, backupPath: result.backupPath }, null, 2))
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) {
  main().catch((error) => {
    console.error('[publication-attribution-migration] failed', error?.message || error)
    process.exitCode = 1
  })
}
