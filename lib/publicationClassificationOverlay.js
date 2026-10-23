import { isPublicationExcluded } from './publicationExclusions.js'
import { getPublicationKey } from './publicationIdentity.js'

/**
 * The identity a stored classification (`pubmedClassification`) is looked up by: the PMID when
 * the paper has one, which is how every document written before 2026-10-23 is keyed, otherwise
 * the publication key (`doi:…`), so papers found only through Crossref, OpenAlex or Europe PMC
 * can be classified and overlaid too. Documents carry both `pmid` and `publicationKey`.
 */
export function classificationIdentity(publication = {}) {
  const pmid = String(publication?.pmid || '').trim()
  if (pmid) return pmid
  return getPublicationKey(publication) || ''
}

/** The `$pmids` and `$keys` a classification query matches on for these publications. */
export function classificationLookupParams(publications = []) {
  const pmids = new Set()
  const keys = new Set()
  for (const pub of publications || []) {
    const pmid = String(pub?.pmid || '').trim()
    if (pmid) pmids.add(pmid)
    const key = getPublicationKey(pub || {})
    if (key) keys.add(key)
  }
  return { pmids: [...pmids], keys: [...keys] }
}

/** Index classification documents by PMID and by publication key; `pick` shapes the value. */
export function buildClassificationMap(docs = [], pick = (doc) => doc) {
  const map = new Map()
  for (const doc of docs || []) {
    if (!doc) continue
    const value = pick(doc)
    const pmid = String(doc.pmid || '').trim()
    if (pmid) map.set(pmid, value)
    const key = String(doc.publicationKey || '').trim()
    if (key) map.set(key, value)
  }
  return map
}

/** The stored classification for a publication, by PMID first and then by publication key. */
export function lookupClassification(map, publication = {}) {
  if (!map || !map.size) return undefined
  const pmid = String(publication?.pmid || '').trim()
  if (pmid && map.has(pmid)) return map.get(pmid)
  const key = getPublicationKey(publication || {})
  return key ? map.get(key) : undefined
}

export function applyPublicationClassificationOverlay(publication, classification) {
  if (!classification) return publication

  const overlaid = {
    ...publication,
    topics: Array.isArray(classification.topics) ? classification.topics : publication.topics || [],
    studyDesign: Array.isArray(classification.studyDesign) ? classification.studyDesign : publication.studyDesign || [],
    methodologicalFocus: Array.isArray(classification.methodologicalFocus)
      ? classification.methodologicalFocus
      : publication.methodologicalFocus || [],
  }

  if (typeof classification.exclude === 'boolean') {
    overlaid.exclude = classification.exclude
  } else if (Object.prototype.hasOwnProperty.call(publication, 'exclude')) {
    overlaid.exclude = publication.exclude
  }

  const excluded = isPublicationExcluded(overlaid)
  if (
    excluded ||
    typeof classification.exclude === 'boolean' ||
    Object.prototype.hasOwnProperty.call(publication, 'exclude')
  ) {
    overlaid.exclude = excluded
  }

  return overlaid
}
