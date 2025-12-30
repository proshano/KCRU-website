export function sanitizeString(value = '') {
  if (!value) return ''
  return String(value).trim()
}

export function normalizeList(values) {
  if (!Array.isArray(values)) return []
  const cleaned = values.map((value) => sanitizeString(value)).filter(Boolean)
  return Array.from(new Set(cleaned))
}

export function normalizeInterestAreas(values, allowedSet) {
  const normalized = normalizeList(values).filter((item) => allowedSet.has(item))
  if (normalized.includes('all')) return ['all']
  return normalized
}

export function normalizeCorrespondence(values, allowedSet) {
  return normalizeList(values).filter((item) => allowedSet.has(item))
}
