import {
  getAttributionPairKey,
  getCanonicalAttributionExclusion,
  getPublicationAttributionAuthors,
  getPublicationAttributionReviewId,
  PUBLICATION_ATTRIBUTION_REVIEW_TYPE,
} from './publicationAttribution.js'
import { getPublicationKey, withPublicationKey } from './publicationIdentity.js'
import { normalizeResearcherPublicationExclusion } from './researcherPublicationIdentity.js'

export const ATTRIBUTION_REVIEW_STATUSES = ['pending', 'approved', 'rejected']

export function canManagePublicationAttributionReviews(access = {}) {
  return Boolean(access?.approvals)
}

function cleanString(value) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

function uniqueStrings(values = []) {
  return Array.from(new Set((values || []).map(cleanString).filter(Boolean)))
}

function toSanityAuthors(publication = {}) {
  return getPublicationAttributionAuthors(publication).map((author, index) => ({
    _key: `author-${index}`,
    given: author.given || null,
    family: author.family || null,
    displayName: author.displayName || null,
    orcid: author.orcid || null,
    affiliations: uniqueStrings(author.affiliations),
  }))
}

export function normalizePublicationAttributionSnapshot(publication = {}) {
  const normalized = withPublicationKey(publication)
  return {
    publicationKey: normalized.publicationKey,
    pmid: normalized.pmid || null,
    doi: normalized.doi || null,
    title: cleanString(normalized.title),
    authors: uniqueStrings(normalized.authors),
    attributionAuthors: toSanityAuthors(normalized),
    journal: cleanString(normalized.journal) || null,
    publishedAt: normalized.publishedAt || null,
    year: Number(normalized.year) || null,
    month: cleanString(normalized.month) || null,
    url: cleanString(normalized.url || normalized.pubmedUrl) || null,
    source: cleanString(normalized.source) || null,
    sources: uniqueStrings(normalized.sources),
    attributionQueryPaths: uniqueStrings(normalized.attributionQueryPaths),
    openAlexId: cleanString(normalized.openAlexId) || null,
    europePmcId: cleanString(normalized.europePmcId) || null,
    abstract: cleanString(normalized.abstract) || null,
    abstractContentType: cleanString(normalized.abstractContentType) || null,
    abstractSource: cleanString(normalized.abstractSource) || null,
    publicationTypes: uniqueStrings(normalized.publicationTypes),
    laySummary: cleanString(normalized.laySummary) || null,
    topics: uniqueStrings(normalized.topics),
    studyDesign: uniqueStrings(normalized.studyDesign),
    methodologicalFocus: uniqueStrings(normalized.methodologicalFocus),
    exclude: normalized.exclude === true,
  }
}

function normalizeEvidence(evidence = {}) {
  return {
    isManuallyConfirmed: Boolean(evidence.isManuallyConfirmed),
    isManuallyRejected: Boolean(evidence.isManuallyRejected),
    isPubmedConfirmed: Boolean(evidence.isPubmedConfirmed),
    expectedOrcid: cleanString(evidence.expectedOrcid) || null,
    matchedOrcid: cleanString(evidence.matchedOrcid) || null,
    hasExactOrcid: Boolean(evidence.hasExactOrcid),
    hasConflictingOrcid: Boolean(evidence.hasConflictingOrcid),
    nameKind: cleanString(evidence.nameKind) || null,
    matchedAuthor: cleanString(evidence.matchedAuthor) || null,
    affiliationMatches: uniqueStrings(evidence.affiliationMatches),
    recurringCoauthorCount: Number(evidence.recurringCoauthorCount) || 0,
    recurringCoauthors: uniqueStrings(evidence.recurringCoauthors),
    queryPaths: uniqueStrings(evidence.queryPaths),
  }
}

export function buildPublicationAttributionReviewDocument({
  researcher,
  publication,
  evaluation = {},
  status = 'pending',
  now = new Date(),
  reviewedBy = null,
  reviewedAt = null,
} = {}) {
  const snapshot = normalizePublicationAttributionSnapshot(publication)
  const publicationKey = snapshot.publicationKey
  const researcherId = researcher?._id || researcher?.researcherId
  const id = getPublicationAttributionReviewId(researcherId, publicationKey)
  if (!id || !publicationKey || !researcherId) {
    throw new Error('A researcher and canonical DOI/PMID are required for attribution review.')
  }
  if (!ATTRIBUTION_REVIEW_STATUSES.includes(status)) {
    throw new Error(`Invalid attribution review status: ${status}`)
  }

  const timestamp = now instanceof Date ? now.toISOString() : new Date(now).toISOString()
  const decisionTimestamp = status === 'pending' ? null : (reviewedAt || timestamp)
  return {
    _id: id,
    _type: PUBLICATION_ATTRIBUTION_REVIEW_TYPE,
    researcher: { _type: 'reference', _ref: researcherId },
    researcherName: cleanString(researcher.name) || null,
    publicationKey,
    doi: snapshot.doi,
    pmid: snapshot.pmid,
    title: snapshot.title,
    authors: snapshot.authors,
    attributionAuthors: snapshot.attributionAuthors,
    journal: snapshot.journal,
    publishedAt: snapshot.publishedAt,
    year: snapshot.year,
    url: snapshot.url,
    discoverySources: snapshot.sources,
    evidence: normalizeEvidence(evaluation.evidence),
    holdReason: cleanString(evaluation.reason) || 'Manual attribution review required.',
    snapshot,
    status,
    firstSeenAt: timestamp,
    lastSeenAt: timestamp,
    lastNotifiedAt: null,
    notificationCount: 0,
    reviewedAt: decisionTimestamp,
    reviewedBy: status === 'pending' ? null : cleanString(reviewedBy) || null,
  }
}

function getRefreshPatch(document) {
  return {
    researcherName: document.researcherName,
    publicationKey: document.publicationKey,
    doi: document.doi,
    pmid: document.pmid,
    title: document.title,
    authors: document.authors,
    attributionAuthors: document.attributionAuthors,
    journal: document.journal,
    publishedAt: document.publishedAt,
    year: document.year,
    url: document.url,
    discoverySources: document.discoverySources,
    evidence: document.evidence,
    holdReason: document.holdReason,
    snapshot: document.snapshot,
    lastSeenAt: document.lastSeenAt,
  }
}

export async function upsertPublicationAttributionCandidates({
  writeClient,
  candidates = [],
  now = new Date(),
} = {}) {
  if (!candidates.length) return { upserted: 0 }
  if (!writeClient?.config?.().token) {
    throw new Error('SANITY_API_TOKEN missing; ambiguous publication attributions cannot be stored safely.')
  }

  const byId = new Map()
  for (const candidate of candidates) {
    const document = buildPublicationAttributionReviewDocument({ ...candidate, now })
    byId.set(document._id, document)
  }

  const transaction = writeClient.transaction()
  for (const document of byId.values()) {
    transaction.createIfNotExists(document)
    transaction.patch(document._id, (patch) => patch.set(getRefreshPatch(document)))
  }
  await transaction.commit()
  return { upserted: byId.size }
}

export async function fetchPublicationAttributionReviews(fetchClient) {
  return fetchClient.fetch(`
    *[_type == "${PUBLICATION_ATTRIBUTION_REVIEW_TYPE}"] | order(status asc, lastSeenAt desc) {
      _id,
      _rev,
      _createdAt,
      _updatedAt,
      researcher,
      researcherName,
      publicationKey,
      doi,
      pmid,
      title,
      authors,
      attributionAuthors,
      journal,
      publishedAt,
      year,
      url,
      discoverySources,
      evidence,
      holdReason,
      snapshot,
      status,
      firstSeenAt,
      lastSeenAt,
      lastNotifiedAt,
      notificationCount,
      reviewedAt,
      reviewedBy,
      "researcherDetails": researcher->{_id, name, publicationExclusions}
    }
  `)
}

export async function resolveAutomaticallyConfirmedAttributionReviews({
  writeClient,
  resolutions = [],
  now = new Date(),
} = {}) {
  const pendingById = new Map((resolutions || [])
    .filter((resolution) => resolution?.review?.status === 'pending')
    .map((resolution) => [resolution.review._id, resolution]))
  if (!pendingById.size) return { resolved: 0 }
  if (!writeClient?.config?.().token) {
    throw new Error('SANITY_API_TOKEN missing; confirmed attribution reviews cannot be resolved safely.')
  }

  const reviewedAt = now instanceof Date ? now.toISOString() : new Date(now).toISOString()
  const transaction = writeClient.transaction()
  for (const { review, reason } of pendingById.values()) {
    transaction.patch(review._id, (patch) => {
      const guarded = review._rev ? patch.ifRevisionId(review._rev) : patch
      return guarded.set({
        status: 'approved',
        reviewedAt,
        reviewedBy: `automatic:${cleanString(reason || 'confirmed-attribution').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`,
      })
    })
  }
  await transaction.commit()
  return { resolved: pendingById.size }
}

export function indexPublicationAttributionReviews(reviews = []) {
  return new Map(reviews.map((review) => [
    getAttributionPairKey(review?.researcher?._ref || review?.researcherId, review.publicationKey),
    review,
  ]))
}

function getExclusionSet(researcher = {}) {
  return new Set((researcher.publicationExclusions || [])
    .map(normalizeResearcherPublicationExclusion)
    .filter(Boolean))
}

export function isAttributionRejected({ researcher, publicationKey, review } = {}) {
  if (review?.status === 'rejected') return true
  return getExclusionSet(researcher).has(normalizeResearcherPublicationExclusion(publicationKey))
}

export function filterRejectedProvenance({ provenance = {}, researchers = [], reviews = [] } = {}) {
  const researcherById = new Map(researchers.map((researcher) => [researcher._id, researcher]))
  const reviewByPair = indexPublicationAttributionReviews(reviews)
  const filtered = {}

  for (const [publicationKey, researcherIds] of Object.entries(provenance || {})) {
    const retainedIds = Array.from(new Set(Array.from(researcherIds || []))).filter((researcherId) => {
      const researcher = researcherById.get(researcherId)
      const review = reviewByPair.get(getAttributionPairKey(researcherId, publicationKey))
      return researcher && !isAttributionRejected({ researcher, publicationKey, review })
    })
    if (retainedIds.length) filtered[publicationKey] = retainedIds
  }

  return filtered
}

export async function decidePublicationAttributionReview({
  writeClient,
  reviewId,
  decision,
  reviewerEmail,
  now = new Date(),
} = {}) {
  if (!writeClient?.config?.().token) {
    return { ok: false, status: 500, error: 'SANITY_API_TOKEN missing; cannot save attribution decisions.' }
  }
  if (!['approved', 'rejected'].includes(decision)) {
    return { ok: false, status: 400, error: 'Decision must be approved or rejected.' }
  }

  const review = await writeClient.fetch(`
    *[_type == "${PUBLICATION_ATTRIBUTION_REVIEW_TYPE}" && _id == $reviewId][0] {
      _id,
      publicationKey,
      doi,
      pmid,
      researcher,
      "researcherDetails": researcher->{_id, publicationExclusions}
    }
  `, { reviewId })
  if (!review?._id || !review?.researcher?._ref) {
    return { ok: false, status: 404, error: 'Attribution review candidate not found.' }
  }

  const publication = {
    publicationKey: review.publicationKey,
    doi: review.doi,
    pmid: review.pmid,
  }
  const exclusion = getCanonicalAttributionExclusion(publication)
  if (!exclusion) {
    return { ok: false, status: 400, error: 'Candidate has no canonical DOI or PMID.' }
  }

  const existingExclusions = review.researcherDetails?.publicationExclusions || []
  const normalizedTarget = normalizeResearcherPublicationExclusion(exclusion)
  const retainedExclusions = existingExclusions.filter((value) => {
    return normalizeResearcherPublicationExclusion(value) !== normalizedTarget
  })
  const nextExclusions = decision === 'rejected'
    ? [...retainedExclusions, exclusion]
    : retainedExclusions
  const reviewedAt = now instanceof Date ? now.toISOString() : new Date(now).toISOString()

  await writeClient
    .transaction()
    .patch(review._id, (patch) => patch.set({
      status: decision,
      reviewedAt,
      reviewedBy: cleanString(reviewerEmail).toLowerCase(),
    }))
    .patch(review.researcher._ref, (patch) => patch.set({ publicationExclusions: nextExclusions }))
    .commit()

  return { ok: true, reviewId, decision, reviewedAt, exclusion }
}

export function mergeApprovedReviewSnapshots({ publications = [], provenance = {}, reviews = [], researchers = [] } = {}) {
  const researcherById = new Map(researchers.map((researcher) => [researcher._id, researcher]))
  const byKey = new Map(publications.map((publication) => [getPublicationKey(publication), publication]))
  const nextProvenance = Object.fromEntries(
    Object.entries(provenance || {}).map(([key, ids]) => [key, Array.from(new Set(ids || []))])
  )

  for (const review of reviews) {
    if (review.status !== 'approved' || !review.snapshot) continue
    const researcherId = review?.researcher?._ref || review.researcherId
    const researcher = researcherById.get(researcherId)
    if (!researcher || isAttributionRejected({ researcher, publicationKey: review.publicationKey, review })) continue
    if (!byKey.has(review.publicationKey)) byKey.set(review.publicationKey, withPublicationKey(review.snapshot))
    nextProvenance[review.publicationKey] ||= []
    if (!nextProvenance[review.publicationKey].includes(researcherId)) {
      nextProvenance[review.publicationKey].push(researcherId)
    }
  }

  return { publications: Array.from(byKey.values()), provenance: nextProvenance }
}
