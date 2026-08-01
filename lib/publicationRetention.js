// Keeps already-published papers on the site when a discovery source has an off day.
//
// A refresh re-runs every researcher's PubMed query plus Crossref/OpenAlex/Europe PMC
// discovery, and the result used to replace the cache wholesale. Any paper missing from
// that single snapshot was deleted - so a Crossref 429 or an OpenAlex outage silently
// removed real publications from /publications, along with their lay summaries and
// classifications, until a later run happened to rediscover them.
//
// Membership is now sticky. A cached paper that today's run did not return is carried
// forward and only pruned once it has been absent from several consecutive runs in which
// every source that could have found it actually answered.

import { getPublicationKey } from './publicationIdentity.js'

export const DEFAULT_PRUNE_AFTER_MISSING_RUNS = (() => {
  const raw = Number(process.env.PUBLICATION_PRUNE_AFTER_MISSING_RUNS)
  return Number.isFinite(raw) && raw > 0 ? raw : 3
})()

// If a run returns drastically fewer publications than the cache holds, something is
// broken upstream rather than genuinely removed. Treat the whole run as degraded.
export const DEFAULT_COLLAPSE_RATIO = (() => {
  const raw = Number(process.env.PUBLICATION_COLLAPSE_RATIO)
  return Number.isFinite(raw) && raw > 0 && raw <= 1 ? raw : 0.75
})()

function toIdArray(value) {
  if (Array.isArray(value)) return value
  if (value instanceof Set) return Array.from(value)
  return []
}

/**
 * Decide whether a fetched publication set is trustworthy enough to delete from.
 */
export function isDiscoveryCollapsed({
  cachedCount = 0,
  fetchedCount = 0,
  collapseRatio = DEFAULT_COLLAPSE_RATIO,
} = {}) {
  if (!cachedCount) return false
  return fetchedCount < cachedCount * collapseRatio
}

/**
 * Merge this run's publications with cached ones the run did not return.
 *
 * @param {object[]} cachedPublications  Publications already stored in the cache.
 * @param {object[]} fetchedPublications Publications returned by this run.
 * @param {object} cachedProvenance      publicationKey -> researcher ids, from the cache.
 * @param {object} fetchedProvenance     publicationKey -> researcher ids, from this run.
 * @param {string[]} degradedResearcherIds Researchers whose discovery partially failed.
 * @param {boolean} discoveryDegraded    Treat every researcher as degraded.
 * @param {number} pruneAfterMissingRuns Consecutive clean absences before removal.
 * @param {(pub: object) => boolean} isRetainable Records that are never carried forward.
 * @returns {{publications: object[], provenance: object, retained: object[], removed: object[]}}
 */
export function retainPublications({
  cachedPublications = [],
  fetchedPublications = [],
  cachedProvenance = {},
  fetchedProvenance = {},
  degradedResearcherIds = [],
  discoveryDegraded = false,
  pruneAfterMissingRuns = DEFAULT_PRUNE_AFTER_MISSING_RUNS,
  isRetainable = () => true,
  now = new Date(),
} = {}) {
  const seenAt = now.toISOString()
  const degraded = new Set(toIdArray(degradedResearcherIds).filter(Boolean))
  const fetchedKeys = new Set()

  const publications = fetchedPublications.map((pub) => {
    const publicationKey = getPublicationKey(pub)
    if (publicationKey) fetchedKeys.add(publicationKey)
    return { ...pub, lastSeenAt: seenAt, missingRuns: 0 }
  })

  const provenance = { ...fetchedProvenance }
  const retained = []
  const removed = []

  for (const pub of cachedPublications) {
    const publicationKey = getPublicationKey(pub)
    if (!publicationKey || fetchedKeys.has(publicationKey)) continue

    if (!isRetainable(pub)) {
      removed.push({ publication: pub, publicationKey, reason: 'not-retainable' })
      continue
    }

    // Only researchers this paper is actually attributed to matter: a Crossref throttle
    // for one researcher should not freeze pruning for everybody else.
    const researcherIds = toIdArray(cachedProvenance[publicationKey])
    const isProtected = discoveryDegraded ||
      researcherIds.some((id) => degraded.has(id)) ||
      (researcherIds.length === 0 && degraded.size > 0)

    const missingRuns = isProtected
      ? (Number(pub.missingRuns) || 0)
      : (Number(pub.missingRuns) || 0) + 1

    if (!isProtected && missingRuns >= pruneAfterMissingRuns) {
      removed.push({ publication: pub, publicationKey, reason: 'absent', missingRuns })
      continue
    }

    const carried = { ...pub, missingRuns }
    publications.push(carried)
    retained.push({
      publication: carried,
      publicationKey,
      reason: isProtected ? 'degraded-discovery' : 'absent',
      missingRuns,
    })

    if (!provenance[publicationKey] && researcherIds.length > 0) {
      provenance[publicationKey] = researcherIds
    }
  }

  return { publications, provenance, retained, removed }
}
