/**
 * `abstractSource` value for text transcribed from a publisher's first-page preview image.
 * Such text is stored as `article_body`; this marker lets the summary prompt say that only
 * the opening page was available. Defined here, not beside the fetcher, because Studio
 * bundles lib/summaries.js and this module is browser-safe.
 */
export const PUBLISHER_FIRST_PAGE_SOURCE = 'publisher first page image'

export function normalizeDoi(value) {
  const text = String(value || '')
    .trim()
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '')
    .replace(/^doi:\s*/i, '')
    .toLowerCase()
  // PubMed elocationid can contain a PII followed by the DOI. A PII alone is
  // not a DOI, and must fall back to the PMID instead of creating a new identity.
  return text.match(/(?:^|\s)(10\.\d{4,9}\/\S+)$/)?.[1] || ''
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

// The element id of a paper's entry on /publications and profile pages, so a link such as
// /team/<slug>#paper-doi-10-1000-xyz lands on that paper. `key` is a publication key or a
// feed GUID, which share the doi:/pmid: format.
export function publicationAnchorFromKey(key) {
  const slug = String(key || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return slug ? `paper-${slug}` : ''
}

export function getPublicationAnchorId(publication) {
  return publicationAnchorFromKey(getPublicationKey(publication || {}))
}

// For a #paper-… link: opens the closed year section holding that paper and scrolls to it.
// Returns false, doing nothing, when the hash is not a paper anchor or no paper matches.
// `doc` is the page's document.
export function revealLinkedPublication(hash, doc) {
  let id
  try {
    id = decodeURIComponent(String(hash || '').replace(/^#/, ''))
  } catch {
    return false
  }
  if (!id.startsWith('paper-')) return false
  const target = doc?.getElementById(id)
  if (!target) return false
  const section = target.closest('details')
  if (section && !section.open) section.open = true
  target.scrollIntoView()
  return true
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

// A notice a source returns where the abstract would be. Short by nature: a real abstract
// may use the same words ("records with no abstract were screened in full").
const TEXT_NOTICE_PATTERNS = [
  /\bno abstract\b/i,
  /\babstract (?:is |was )?not (?:available|provided)\b/i,
]
const MAX_TEXT_NOTICE_LENGTH = 250
// A link or path with nothing else: `https://…`, or `//static.cambridge.org/…/firstPage.jpg`
// (what Cambridge puts in `citation_abstract`). ASCII only, so text in a script written
// without spaces is not mistaken for one.
const BARE_LINK_PATTERN = /^[\w\-.~:/?#[\]@!$&'()*+,;=%]+$/
// `width=device-width, initial-scale=1.0` (a viewport tag) and similar settings.
const SETTINGS_LIST_PATTERN = /^[\w.-]+=[^=,;]*(?:[,;]\s*[\w.-]+=[^=,;]*)+$/
// One `Family, Given` entry of a `citation_authors` tag.
const NAME_LIST_ENTRY_PATTERN = /^\p{L}[\p{L}.'’ -]*,\s*\p{L}[\p{L}.'’ -]*$/u

function wordTokens(value) {
  return String(value || '').toLowerCase().match(/[a-z0-9]+/g) || []
}

// The title again, cut short or lightly reworded ("after 1 Year" / "After One Year"):
// about the title's length, and made of the title's words.
function repeatsTitle(text, title) {
  const titleText = String(title || '').trim()
  if (!titleText || text.length > titleText.length * 1.5) return false
  const titleWords = new Set(wordTokens(titleText))
  const words = wordTokens(text)
  if (!words.length || !titleWords.size) return false
  return words.filter((word) => titleWords.has(word)).length / words.length >= 0.8
}

function isNameList(text) {
  const entries = text.split(';').map((entry) => entry.trim()).filter(Boolean)
  return entries.length >= 3 &&
    entries.every((entry) => entry.length <= 60 && NAME_LIST_ENTRY_PATTERN.test(entry))
}

/**
 * Text saved in place of an abstract that says nothing about the paper: a bare link, a
 * `citation_…=` reference string, a list of settings or author names, a "no abstract
 * available" notice, or the title repeated. Until November 2026 the DOI backfill took the
 * longest meta tag on a publisher page when it found no abstract tag, which stored Ovid
 * page URLs and titles for JASN meeting abstracts, a viewport setting and an author list;
 * the summaries written from them said the findings were not reported, or inferred
 * findings from the title.
 */
export function isPlaceholderPublicationText(text, title) {
  const value = String(text || '').trim()
  if (!value) return false
  if (value.includes('/') && BARE_LINK_PATTERN.test(value)) return true
  if (/^citation_[a-z_]+=/i.test(value)) return true
  if (SETTINGS_LIST_PATTERN.test(value) || isNameList(value)) return true
  if (value.length <= MAX_TEXT_NOTICE_LENGTH && TEXT_NOTICE_PATTERNS.some((re) => re.test(value))) return true
  return repeatsTitle(value, title)
}

export function selectPreferredAbstractContent(left = {}, right = {}) {
  const leftContent = normalizeAbstractContent(left)
  const rightContent = normalizeAbstractContent(right)
  if (!leftContent.abstract) return rightContent
  if (!rightContent.abstract) return leftContent

  // Placeholder text ranks below everything, so real text replaces it, but it is kept when
  // it is all there is: dropping it would take a paper without a PMID off the site. Each
  // side is compared with its own title (a preprint and its final article can differ).
  const contentRank = (content, title) => {
    if (isPlaceholderPublicationText(content.abstract, title)) return -1
    if (content.abstractContentType === 'abstract') return 2
    if (content.abstractContentType === 'article_body') return 0
    return 1
  }
  const rankDifference = contentRank(leftContent, left.title || right.title) -
    contentRank(rightContent, right.title || left.title)
  if (rankDifference !== 0) {
    return rankDifference > 0 ? leftContent : rightContent
  }
  return leftContent.abstract.length >= rightContent.abstract.length
    ? leftContent
    : rightContent
}

// The shortest abstract or publisher article text the refresh accepts as usable text.
export const PUBLICATION_TEXT_MIN_LENGTH = 50

export function hasUsablePublicationText(publication) {
  return String(publication?.abstract || '').trim().length >= PUBLICATION_TEXT_MIN_LENGTH
}

// Whether the DOI backfill should look for text: none yet, or only a placeholder. A
// placeholder still counts as usable text for publishing (`isPublicationReadyToPublish`).
export function needsPublicationText(publication) {
  return !hasUsablePublicationText(publication) ||
    isPlaceholderPublicationText(publication?.abstract, publication?.title)
}

// Whether `nextText` is real text taking the place of a placeholder, so that a summary
// written from the placeholder no longer describes the record.
export function replacesPlaceholderText(previousText, nextText, title) {
  return isPlaceholderPublicationText(previousText, title) &&
    hasUsablePublicationText({ abstract: nextText }) &&
    !isPlaceholderPublicationText(nextText, title)
}

// Fields to apply when the DOI backfill replaces a placeholder: the lay summary written from
// it is dropped so the summary step writes a new one, and its tags are replaced when that
// succeeds. Discovery text that replaces a placeholder drops it the same way (refresh merge).
export function withoutPlaceholderSummary(publication) {
  return isPlaceholderPublicationText(publication?.abstract, publication?.title) && publication?.laySummary
    ? { laySummary: null }
    : {}
}

/**
 * Whether the refresh puts this record on the site. A PubMed record is published as it is.
 * A paper found only through Crossref, OpenAlex or Europe PMC is held back until an
 * abstract or publisher article text has been found for it, even when an admin approved
 * the attribution, and every refresh looks again. The review page uses the same rule to
 * explain why an approved paper is not on the site yet.
 */
export function isPublicationReadyToPublish(publication) {
  return Boolean(publication?.pmid) || publication?.source === 'pubmed' || hasUsablePublicationText(publication)
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

export function normalizePublicationProvenance(publications = [], provenance = {}) {
  const aliases = new Map()
  for (const publication of publications) {
    const key = getPublicationKey(publication)
    if (!key) continue
    if (publication.publicationKey) aliases.set(publication.publicationKey, key)
    if (publication.pmid) aliases.set(String(publication.pmid), key)
    if (publication.doi) aliases.set(`doi:${String(publication.doi).trim().toLowerCase()}`, key)
  }

  const normalized = {}
  for (const [storedKey, ids] of Object.entries(provenance)) {
    const key = aliases.get(storedKey) || storedKey
    normalized[key] = Array.from(new Set([...(normalized[key] || []), ...(ids || [])]))
  }
  return normalized
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
