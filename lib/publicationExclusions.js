const EXCLUDED_PUBLICATION_TYPES = new Set([
  'published erratum',
])

const CORRECTION_TITLE_PATTERNS = [
  /^\s*(?:author|publisher)\s+correction\s*:/i,
  /^\s*correction\s*:/i,
  /^\s*correction\s+to\s*:/i,
  /^\s*correction\s+to\b/i,
  /^\s*erratum\s*:/i,
  /^\s*corrigendum\s*:/i,
  /^\s*corrigendum\s+to\b/i,
]

// PubMed marks every piece of a letter exchange - the letter to the editor, the authors'
// reply, an editorial written about one specific paper - with the "Comment" publication
// type. A genuine research letter carries "Letter" alone, so "Letter" by itself is not a
// signal: JAMA- and AJKD-style research letters have no abstract either and must stay.
const CORRESPONDENCE_PUBLICATION_TYPES = new Set([
  'comment',
])

// Titles that identify a reply or letter outright, whatever PubMed has typed so far.
// MEDLINE adds "Comment" weeks after a record first appears, so a new reply is typed
// "Letter" or "Journal Article" only until indexing catches up.
const CORRESPONDENCE_TITLE_PATTERNS = [
  /^\s*(?:the\s+)?authors?['’]?s?\s+(?:reply|response)\b/i,
  /^\s*(?:in\s+)?reply\b/i,
  /^\s*response\s*:/i,
  /^\s*response\s+to\s*(?::|["“'])/i,
  /^\s*response\s+to\s+(?:the\s+)?(?:letter|comment|commentary|editorial|editor|correspondence|dr\b|drs\b|prof)/i,
  /^\s*re\s*:/i,
  /^\s*letters?\s+to\s+the\s+editor\b/i,
  /^\s*comment\s+on\b/i,
  /[-–—:]\s*(?:the\s+)?(?:authors?['’]?s?\s+)?(?:reply|response)\.?\s*$/i,
]

export function normalizePublicationTypes(value) {
  const raw = Array.isArray(value) ? value : [value]
  const seen = new Set()
  const out = []

  for (const item of raw) {
    const text = typeof item === 'string'
      ? item
      : item?.name || item?.title || item?.value || ''
    const cleaned = String(text || '').replace(/\s+/g, ' ').trim()
    if (!cleaned) continue

    const key = cleaned.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(cleaned)
  }

  return out
}

function readPublicationTypes(publication) {
  return normalizePublicationTypes(
    publication?.publicationTypes ||
    publication?.pubTypes ||
    publication?.pubtype ||
    publication?.publicationType
  )
}

// Publisher article body text saved by the DOI backfill is not an abstract. A letter
// exchange usually has enough body text to pass that fallback, so counting it here would
// let every reply back in once the backfill has run.
function hasGenuineAbstract(publication) {
  const text = String(publication?.abstract || '').trim()
  if (!text) return false
  return publication?.abstractContentType !== 'article_body'
}

export function isPublicationCorrectionNotice(publication) {
  const publicationTypes = readPublicationTypes(publication)

  if (publicationTypes.some((type) => EXCLUDED_PUBLICATION_TYPES.has(type.toLowerCase()))) {
    return true
  }

  const title = String(publication?.title || '')
  return CORRECTION_TITLE_PATTERNS.some((pattern) => pattern.test(title))
}

/**
 * Letters to the editor, authors' replies and other comment pieces that PubMed indexes
 * without an abstract. A "Comment"-typed record that does have a real abstract is a
 * substantive commentary and is kept.
 */
export function isPublicationCorrespondence(publication) {
  const title = String(publication?.title || '')
  if (CORRESPONDENCE_TITLE_PATTERNS.some((pattern) => pattern.test(title))) {
    return true
  }

  const publicationTypes = readPublicationTypes(publication)
  const typedAsComment = publicationTypes.some((type) =>
    CORRESPONDENCE_PUBLICATION_TYPES.has(type.toLowerCase())
  )
  return typedAsComment && !hasGenuineAbstract(publication)
}

/**
 * The deterministic exclusion rules, independent of the classifier's own `exclude` flag.
 */
export function isPublicationExcludedByRule(publication) {
  return isPublicationCorrectionNotice(publication) || isPublicationCorrespondence(publication)
}

export function isPublicationExcluded(publication) {
  return publication?.exclude === true || isPublicationExcludedByRule(publication)
}
