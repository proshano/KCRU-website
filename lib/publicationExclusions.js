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

export function isPublicationCorrectionNotice(publication) {
  const publicationTypes = normalizePublicationTypes(
    publication?.publicationTypes ||
    publication?.pubTypes ||
    publication?.pubtype ||
    publication?.publicationType
  )

  if (publicationTypes.some((type) => EXCLUDED_PUBLICATION_TYPES.has(type.toLowerCase()))) {
    return true
  }

  const title = String(publication?.title || '')
  return CORRECTION_TITLE_PATTERNS.some((pattern) => pattern.test(title))
}

export function isPublicationExcluded(publication) {
  return publication?.exclude === true || isPublicationCorrectionNotice(publication)
}
