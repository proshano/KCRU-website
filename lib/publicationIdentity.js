export function normalizeDoi(value) {
  return String(value || '')
    .trim()
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '')
    .replace(/^doi:\s*/i, '')
    .toLowerCase()
}

export function getPublicationKey(publication = {}) {
  const doi = normalizeDoi(publication.doi)
  if (doi) return `doi:${doi}`

  const pmid = String(publication.pmid || '').trim()
  if (pmid) return `pmid:${pmid}`

  const openAlexId = String(publication.openAlexId || '').trim()
  if (openAlexId) return `openalex:${openAlexId.replace(/^https:\/\/openalex\.org\//i, '')}`

  const europePmcId = String(publication.europePmcId || '').trim()
  if (europePmcId) return `europepmc:${europePmcId}`

  return String(publication.publicationKey || '').trim()
}

function normalizeAbstractContent(publication = {}) {
  const abstract = String(publication.abstract || '').trim()
  if (!abstract) {
    return {
      abstract: null,
      abstractContentType: null,
      abstractSource: null,
    }
  }
  return {
    abstract,
    abstractContentType: ['abstract', 'article_body'].includes(publication.abstractContentType)
      ? publication.abstractContentType
      : null,
    abstractSource: publication.abstractSource || publication.source || null,
  }
}

export function selectPreferredAbstractContent(left = {}, right = {}) {
  const leftContent = normalizeAbstractContent(left)
  const rightContent = normalizeAbstractContent(right)
  if (!leftContent.abstract) return rightContent
  if (!rightContent.abstract) return leftContent

  const contentRank = (content) => {
    if (content.abstractContentType === 'abstract') return 2
    if (content.abstractContentType === 'article_body') return 0
    return 1
  }
  const rankDifference = contentRank(leftContent) - contentRank(rightContent)
  if (rankDifference !== 0) {
    return rankDifference > 0 ? leftContent : rightContent
  }
  return leftContent.abstract.length >= rightContent.abstract.length
    ? leftContent
    : rightContent
}

/**
 * Deduplicate and sort the discovery-source list.
 *
 * The stored order used to depend on which sources answered during a given run, so a
 * single Crossref throttle flipped dozens of records from ['pubmed','crossref'] to
 * ['pubmed'] and back. That registered as a metadata change and forced a full cache
 * rewrite every day. Sorting makes the comparison reflect real changes only.
 */
export function normalizePublicationSources(publication = {}) {
  const values = [
    ...(Array.isArray(publication.sources) ? publication.sources : []),
    publication.source,
  ]
    .map((value) => String(value || '').trim())
    .filter(Boolean)
  return Array.from(new Set(values)).sort()
}

function normalizeStringList(values = []) {
  return Array.from(new Set((Array.isArray(values) ? values : [])
    .map((value) => String(value || '').trim())
    .filter(Boolean)))
}

function mergeAttributionAuthors(left = [], right = []) {
  const authors = []
  const seen = new Set()
  for (const author of [...(left || []), ...(right || [])]) {
    const key = [author?.orcid, author?.family, author?.given, author?.displayName]
      .map((value) => String(value || '').trim().toLowerCase())
      .join('|')
    if (!key.replace(/\|/g, '') || seen.has(key)) continue
    seen.add(key)
    authors.push({
      ...author,
      affiliations: normalizeStringList(author?.affiliations),
    })
  }
  return authors
}

export function withPublicationKey(publication = {}) {
  const doi = normalizeDoi(publication.doi)
  const publicationKey = getPublicationKey({ ...publication, doi })
  const abstractContent = normalizeAbstractContent(publication)
  return {
    ...publication,
    ...abstractContent,
    doi: doi || null,
    sources: normalizePublicationSources(publication),
    attributionAuthors: mergeAttributionAuthors(publication.attributionAuthors),
    attributionQueryPaths: normalizeStringList(publication.attributionQueryPaths),
    publicationKey: publicationKey || null,
  }
}

export function getProvenanceIds(publication, provenance = {}) {
  const publicationKey = getPublicationKey(publication)
  if (publicationKey && provenance[publicationKey]) return provenance[publicationKey]

  const legacyPmid = String(publication?.pmid || '').trim()
  return legacyPmid ? (provenance[legacyPmid] || []) : []
}

export function toSanityPublicationKey(publication = {}, fallback = 'publication') {
  const key = getPublicationKey(publication) || fallback
  const sanitized = key
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
  if (!sanitized) return fallback
  if (sanitized.length <= 96) return sanitized

  let hash = 2166136261
  for (const character of key) {
    hash ^= character.charCodeAt(0)
    hash = Math.imul(hash, 16777619)
  }
  return `${sanitized.slice(0, 80)}-${(hash >>> 0).toString(36)}`
}

const SOURCE_PRIORITY = ['pubmed', 'crossref', 'europepmc', 'openalex']

function sourceRank(publication) {
  const rank = SOURCE_PRIORITY.indexOf(publication?.source)
  return rank === -1 ? SOURCE_PRIORITY.length : rank
}

export function mergePublicationRecords(left, right) {
  if (!left) return withPublicationKey(right)
  if (!right) return withPublicationKey(left)

  const preferred = sourceRank(left) <= sourceRank(right) ? left : right
  const fallback = preferred === left ? right : left
  const sources = new Set([
    ...(left.sources || []),
    ...(right.sources || []),
    left.source,
    right.source,
  ].filter(Boolean))
  const abstractContent = selectPreferredAbstractContent(left, right)
  const attributionAuthors = mergeAttributionAuthors(
    preferred.attributionAuthors,
    fallback.attributionAuthors
  )
  const attributionQueryPaths = normalizeStringList([
    ...(left.attributionQueryPaths || []),
    ...(right.attributionQueryPaths || []),
  ])

  return withPublicationKey({
    ...fallback,
    ...preferred,
    pmid: preferred.pmid || fallback.pmid || null,
    doi: preferred.doi || fallback.doi || null,
    openAlexId: preferred.openAlexId || fallback.openAlexId || null,
    europePmcId: preferred.europePmcId || fallback.europePmcId || null,
    ...abstractContent,
    laySummary: preferred.laySummary || fallback.laySummary || null,
    authors: preferred.authors?.length ? preferred.authors : (fallback.authors || []),
    publicationTypes: preferred.publicationTypes?.length
      ? preferred.publicationTypes
      : (fallback.publicationTypes || []),
    attributionAuthors,
    attributionQueryPaths,
    sources: Array.from(sources),
  })
}

export function mergePublications(publications = []) {
  const byKey = new Map()
  for (const rawPublication of publications) {
    const publication = withPublicationKey(rawPublication)
    if (!publication.publicationKey) continue
    byKey.set(
      publication.publicationKey,
      mergePublicationRecords(byKey.get(publication.publicationKey), publication)
    )
  }
  return Array.from(byKey.values())
}
