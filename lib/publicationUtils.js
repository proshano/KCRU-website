const MONTH_LOOKUP = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
}

function parseMonth(value) {
  if (!value) return null
  if (typeof value === 'number' && Number.isFinite(value)) return value
  const text = String(value).trim().toLowerCase()
  if (!text) return null
  if (/^\d{1,2}$/.test(text)) {
    const num = Number(text)
    return Number.isFinite(num) ? num : null
  }
  return MONTH_LOOKUP[text] || null
}

export function getPublicationDate(pub) {
  if (!pub) return null
  const publishedAt = pub.publishedAt || pub.published_at
  if (publishedAt) {
    const parsed = new Date(publishedAt)
    if (!Number.isNaN(parsed.getTime())) return parsed
  }

  const year = Number(pub.year)
  if (!Number.isFinite(year) || year <= 0) return null
  let month = parseMonth(pub.month)

  if (!month && pub.pubDate) {
    const match = String(pub.pubDate).match(/\b([A-Za-z]{3,9})\b/)
    if (match) month = parseMonth(match[1])
  }

  const monthIndex = Number.isFinite(month) && month >= 1 && month <= 12 ? month - 1 : 0
  return new Date(Date.UTC(year, monthIndex, 1))
}

export function findResearchersForPublication(pub, researchers = [], provenance = {}) {
  if (!researchers.length) return []
  const fromProvenance = new Set(provenance[pub?.pmid] || [])

  const matches = []

  if (fromProvenance.size > 0) {
    for (const researcher of researchers) {
      if (fromProvenance.has(researcher._id)) {
        matches.push(researcher)
      }
    }
  }

  if (matches.length === 0 && pub?.authors?.length) {
    const authors = pub.authors.map((author) => author.toLowerCase())
    for (const researcher of researchers) {
      if (!researcher.name) continue
      const name = researcher.name.toLowerCase()
      const last = name.split(' ').slice(-1)[0]
      if (authors.some((author) => author.includes(name) || author.includes(last))) {
        matches.push(researcher)
      }
    }
  }

  return matches
}
