import { getPublicationKey, normalizeDoi } from './publicationIdentity.js'

export function getResearcherPublicationName(researcher = {}) {
  return String(researcher.publicationAuthorName || researcher.name || '').trim()
}

export function normalizeResearcherPublicationExclusion(value) {
  const text = String(value || '').trim().toLowerCase()
  if (!text) return null

  const pubmedUrlMatch = text.match(/pubmed\.ncbi\.nlm\.nih\.gov\/(\d+)/)
  if (pubmedUrlMatch) return `pmid:${pubmedUrlMatch[1]}`

  const pmid = text.replace(/^pmid:\s*/, '')
  if (/^\d+$/.test(pmid)) return `pmid:${pmid}`

  const doi = normalizeDoi(text)
  return /^10\.\d{4,9}\//.test(doi) ? `doi:${doi}` : text
}

export function isPublicationExcludedForResearcher(publication, researcher = {}) {
  const publicationKeys = new Set([
    getPublicationKey(publication),
    publication?.pmid ? `pmid:${String(publication.pmid).trim()}` : null,
    publication?.doi ? `doi:${normalizeDoi(publication.doi)}` : null,
  ].filter(Boolean))
  if (!publicationKeys.size) return false

  return (researcher.publicationExclusions || []).some((value) => {
    return publicationKeys.has(normalizeResearcherPublicationExclusion(value))
  })
}
