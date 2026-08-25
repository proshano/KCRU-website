import { createHash } from 'node:crypto'

import { getPublicationKey, normalizeDoi } from './publicationIdentity.js'

export const PUBLICATION_ATTRIBUTION_REVIEW_TYPE = 'publicationAttributionReview'
export const PUBLICATION_ATTRIBUTION_REVIEW_ID_PREFIX = 'publicationAttributionReview.'

const HONORIFICS = new Set(['dr', 'prof', 'professor', 'mr', 'mrs', 'ms'])

const INSTITUTION_SIGNALS = [
  ['western university', 'university of western ontario', 'western ontario', 'schulich'],
  ['london health sciences centre', 'london health sciences center'],
  ['ices'],
  ['london ontario', 'london on canada', 'london canada'],
  ['university of toronto'],
  ['boston'],
]

export function normalizeAttributionText(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .trim()
    .toLowerCase()
}

export function normalizeAttributionOrcid(value) {
  return String(value || '')
    .trim()
    .replace(/^https?:\/\/orcid\.org\//i, '')
    .toUpperCase()
}

export function getResearcherPublicationNameParts(researcher = {}) {
  const parts = normalizeAttributionText(
    researcher.publicationAuthorName || researcher.name
  ).split(' ').filter((part) => part && !HONORIFICS.has(part))

  return {
    given: parts[0] || '',
    family: parts.at(-1) || '',
    middleInitials: parts.slice(1, -1).map((part) => part[0]),
  }
}

function cleanAttributionValue(value) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

function normalizeAffiliations(value) {
  const entries = Array.isArray(value) ? value : [value]
  const affiliations = []
  for (const entry of entries) {
    const name = cleanAttributionValue(
      typeof entry === 'string'
        ? entry
        : entry?.name || entry?.display_name || entry?.affiliation || entry?.value
    )
    if (name) affiliations.push(name)
  }
  return Array.from(new Set(affiliations))
}

function splitDisplayAuthor(value, source) {
  const parts = cleanAttributionValue(value).split(' ').filter(Boolean)
  if (parts.length < 2) return { given: '', family: '', displayName: cleanAttributionValue(value) }

  const familyFirst = source === 'pubmed' || /^[A-Za-z'’-]+\s+[A-Z][A-Z. -]{0,8}$/.test(String(value).trim())
  if (familyFirst) {
    return {
      given: parts.slice(1).join(' '),
      family: parts[0],
      displayName: cleanAttributionValue(value),
    }
  }

  return {
    given: parts.slice(0, -1).join(' '),
    family: parts.at(-1),
    displayName: cleanAttributionValue(value),
  }
}

export function normalizeAttributionAuthor(author = {}, source = '') {
  if (typeof author === 'string') return splitDisplayAuthor(author, source)

  const displayName = cleanAttributionValue(
    author.displayName || author.fullName || author.name ||
    [author.given || author.firstName || author.foreName, author.family || author.lastName].filter(Boolean).join(' ')
  )
  const fallback = splitDisplayAuthor(displayName, source)
  const affiliations = [
    ...normalizeAffiliations(author.affiliations),
    ...normalizeAffiliations(author.affiliation),
    ...normalizeAffiliations(author.institutions),
    ...normalizeAffiliations(author.rawAffiliationStrings),
  ]

  return {
    given: cleanAttributionValue(author.given || author.firstName || author.foreName || fallback.given),
    family: cleanAttributionValue(author.family || author.lastName || fallback.family),
    displayName: displayName || cleanAttributionValue([fallback.given, fallback.family].filter(Boolean).join(' ')),
    orcid: normalizeAttributionOrcid(author.orcid || author.ORCID || author.identifier),
    affiliations: Array.from(new Set(affiliations)),
  }
}

export function getPublicationAttributionAuthors(publication = {}) {
  const structured = Array.isArray(publication.attributionAuthors)
    ? publication.attributionAuthors
    : []
  if (structured.length) {
    return structured
      .map((author) => normalizeAttributionAuthor(author, publication.source))
      .filter((author) => author.given && author.family)
  }

  return (publication.authors || [])
    .map((author) => normalizeAttributionAuthor(author, publication.source))
    .filter((author) => author.given && author.family)
}

export function classifyResearcherAuthor(author = {}, researcher = {}) {
  const normalizedAuthor = normalizeAttributionAuthor(author)
  const expected = getResearcherPublicationNameParts(researcher)
  const family = normalizeAttributionText(normalizedAuthor.family)
  const givenParts = normalizeAttributionText(normalizedAuthor.given).split(' ').filter(Boolean)
  if (family !== expected.family || !givenParts.length) return null

  const firstGiven = givenParts[0]
  const isFullGivenName = firstGiven === expected.given
  const isAbbreviatedGivenName = firstGiven.length === 1 && firstGiven === expected.given[0]
  if (!isFullGivenName && !isAbbreviatedGivenName) return null

  const providedMiddleInitials = givenParts.slice(1).map((part) => part[0])
  const hasMiddleConflict = expected.middleInitials.some((initial, index) => {
    return providedMiddleInitials[index] && providedMiddleInitials[index] !== initial
  })
  if (hasMiddleConflict) return null

  return {
    ...normalizedAuthor,
    kind: isFullGivenName ? 'full' : 'abbreviated',
  }
}

export function getAttributionAuthorSignature(author = {}, source = '') {
  const normalized = normalizeAttributionAuthor(author, source)
  const family = normalizeAttributionText(normalized.family)
  const given = normalizeAttributionText(normalized.given)
  if (!family || !given) return null
  return `${family}:${given[0]}`
}

function getResearcherSignature(researcher) {
  return getAttributionAuthorSignature(getResearcherPublicationNameParts(researcher))
}

function getQueryAffiliationTerms(researcher = {}) {
  const query = normalizeAttributionText(researcher.pubmedQuery)
  const matches = []
  for (const aliases of INSTITUTION_SIGNALS) {
    if (!aliases.some((alias) => query.includes(normalizeAttributionText(alias)))) continue
    matches.push(...aliases.map(normalizeAttributionText))
  }
  return matches
}

function addFingerprintPublication(fingerprint, publication, { countCoauthors }) {
  const publicationKey = getPublicationKey(publication)
  if (publicationKey) fingerprint.confirmedPublicationKeys.add(publicationKey)

  const authors = getPublicationAttributionAuthors(publication)
  const researcherMatches = authors
    .map((author) => classifyResearcherAuthor(author, fingerprint.researcher))
    .filter(Boolean)
  for (const match of researcherMatches) {
    for (const affiliation of match.affiliations || []) {
      const normalized = normalizeAttributionText(affiliation)
      if (normalized) fingerprint.knownAffiliations.add(normalized)
    }
  }

  if (!countCoauthors) return
  const researcherSignature = getResearcherSignature(fingerprint.researcher)
  for (const author of authors) {
    const signature = getAttributionAuthorSignature(author)
    if (!signature || signature === researcherSignature) continue
    fingerprint.coauthorCounts.set(signature, (fingerprint.coauthorCounts.get(signature) || 0) + 1)
  }
}

export function buildAttributionFingerprints({
  researchers = [],
  pubmedPublications = [],
  pubmedProvenance = {},
  approvedReviews = [],
} = {}) {
  const fingerprints = new Map(researchers.map((researcher) => [researcher._id, {
    researcher,
    confirmedPublicationKeys: new Set(),
    coauthorCounts: new Map(),
    knownAffiliations: new Set(getQueryAffiliationTerms(researcher)),
  }]))
  const publicationByKey = new Map(
    pubmedPublications.map((publication) => [getPublicationKey(publication), publication])
  )

  for (const [publicationKey, researcherIds] of Object.entries(pubmedProvenance || {})) {
    const publication = publicationByKey.get(publicationKey)
    if (!publication) continue
    for (const researcherId of Array.from(researcherIds || [])) {
      const fingerprint = fingerprints.get(researcherId)
      if (fingerprint) addFingerprintPublication(fingerprint, publication, { countCoauthors: true })
    }
  }

  for (const review of approvedReviews) {
    const researcherId = review?.researcher?._ref || review?.researcherId
    const fingerprint = fingerprints.get(researcherId)
    if (!fingerprint || review.status !== 'approved' || !review.snapshot) continue
    // Prior approvals are durable positive evidence and affiliation context, but they do
    // not make a coauthor "recurring"; that threshold is PubMed-confirmed only.
    addFingerprintPublication(fingerprint, review.snapshot, { countCoauthors: false })
  }

  return fingerprints
}

function countRecurringCoauthors(publication, researcher, fingerprint) {
  const researcherSignature = getResearcherSignature(researcher)
  const signatures = new Set()
  const names = []

  for (const author of getPublicationAttributionAuthors(publication)) {
    const signature = getAttributionAuthorSignature(author)
    if (!signature || signature === researcherSignature) continue
    if ((fingerprint?.coauthorCounts.get(signature) || 0) < 2) continue
    if (signatures.has(signature)) continue
    signatures.add(signature)
    names.push(author.displayName || [author.given, author.family].filter(Boolean).join(' '))
  }

  return { count: signatures.size, names }
}

function getAffiliationMatches(authorMatch, fingerprint) {
  const matches = []
  for (const affiliation of authorMatch?.affiliations || []) {
    const normalized = normalizeAttributionText(affiliation)
    if (!normalized) continue
    const known = Array.from(fingerprint?.knownAffiliations || []).some((term) => {
      return term && (normalized.includes(term) || term.includes(normalized))
    })
    if (known) matches.push(affiliation)
  }
  return Array.from(new Set(matches))
}

export function decideAttributionEvidence({
  isManuallyConfirmed = false,
  isManuallyRejected = false,
  isPubmedConfirmed = false,
  hasExactOrcid = false,
  hasConflictingOrcid = false,
  nameKind = null,
  hasAffiliationMatch = false,
  recurringCoauthors = 0,
} = {}) {
  if (isManuallyRejected) {
    return { decision: 'rejected', reason: 'reviewed false attribution' }
  }
  if (isManuallyConfirmed) {
    return { decision: 'confirmed', reason: 'reviewed attribution' }
  }
  if (isPubmedConfirmed) {
    return { decision: 'confirmed', reason: 'researcher-specific PubMed query' }
  }
  if (hasExactOrcid) {
    return { decision: 'confirmed', reason: 'exact author ORCID' }
  }
  if (hasConflictingOrcid) {
    return { decision: 'hold', reason: 'matching name has a conflicting author ORCID' }
  }
  if (nameKind === 'full' && recurringCoauthors >= 2) {
    return { decision: 'confirmed', reason: 'full name plus two recurring coauthors' }
  }
  if (nameKind === 'full' && hasAffiliationMatch && recurringCoauthors >= 1) {
    return {
      decision: 'confirmed',
      reason: 'full name plus known affiliation and recurring coauthor',
    }
  }
  if (nameKind === 'abbreviated' && hasAffiliationMatch && recurringCoauthors >= 2) {
    return {
      decision: 'confirmed',
      reason: 'abbreviated name plus known affiliation and two recurring coauthors',
    }
  }
  return {
    decision: 'hold',
    reason: nameKind === 'full'
      ? 'full name without independent corroboration'
      : nameKind === 'abbreviated'
        ? 'abbreviated name without sufficient corroboration'
        : 'author name not confirmed by the available structured metadata',
  }
}

export function evaluatePublicationAttribution({
  publication = {},
  researcher = {},
  fingerprint,
  review,
  isExcluded = false,
  isPubmedConfirmed = false,
} = {}) {
  const authors = getPublicationAttributionAuthors(publication)
  const expectedOrcid = normalizeAttributionOrcid(researcher.orcid)
  const exactOrcidAuthor = expectedOrcid
    ? authors.find((author) => normalizeAttributionOrcid(author.orcid) === expectedOrcid)
    : null
  const nameMatches = authors
    .map((author) => classifyResearcherAuthor(author, researcher))
    .filter(Boolean)
  const authorMatch = exactOrcidAuthor || nameMatches.find((match) => match.kind === 'full') || nameMatches[0] || null
  const conflictingOrcid = nameMatches.some((match) => {
    const authorOrcid = normalizeAttributionOrcid(match.orcid)
    return Boolean(authorOrcid && expectedOrcid && authorOrcid !== expectedOrcid)
  })
  const recurring = countRecurringCoauthors(publication, researcher, fingerprint)
  const affiliationMatches = getAffiliationMatches(authorMatch, fingerprint)
  const result = decideAttributionEvidence({
    isManuallyRejected: isExcluded || review?.status === 'rejected',
    isManuallyConfirmed: review?.status === 'approved',
    isPubmedConfirmed,
    hasExactOrcid: Boolean(exactOrcidAuthor),
    hasConflictingOrcid: conflictingOrcid,
    nameKind: authorMatch?.kind || null,
    hasAffiliationMatch: affiliationMatches.length > 0,
    recurringCoauthors: recurring.count,
  })

  return {
    ...result,
    evidence: {
      isManuallyConfirmed: review?.status === 'approved',
      isManuallyRejected: isExcluded || review?.status === 'rejected',
      isPubmedConfirmed,
      expectedOrcid: expectedOrcid || null,
      matchedOrcid: normalizeAttributionOrcid(authorMatch?.orcid) || null,
      hasExactOrcid: Boolean(exactOrcidAuthor),
      hasConflictingOrcid: conflictingOrcid,
      nameKind: authorMatch?.kind || null,
      matchedAuthor: authorMatch?.displayName || [authorMatch?.given, authorMatch?.family].filter(Boolean).join(' ') || null,
      affiliationMatches,
      recurringCoauthorCount: recurring.count,
      recurringCoauthors: recurring.names,
      queryPaths: Array.from(new Set(publication.attributionQueryPaths || [])),
    },
  }
}

export function getAttributionPairKey(researcherId, publicationKey) {
  return `${String(researcherId || '').trim()}|${String(publicationKey || '').trim()}`
}

export function getPublicationAttributionReviewId(researcherId, publication) {
  const publicationKey = typeof publication === 'string' ? publication : getPublicationKey(publication)
  if (!researcherId || !publicationKey) return null
  const digest = createHash('sha256')
    .update(getAttributionPairKey(researcherId, publicationKey))
    .digest('hex')
    .slice(0, 40)
  return `${PUBLICATION_ATTRIBUTION_REVIEW_ID_PREFIX}${digest}`
}

export function getCanonicalAttributionExclusion(publication = {}) {
  const doi = normalizeDoi(publication.doi)
  if (doi) return `doi:${doi}`
  const pmid = String(publication.pmid || '').trim()
  return pmid ? `pmid:${pmid}` : getPublicationKey(publication)
}
