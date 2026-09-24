import { getPublicationDate } from './publicationUtils.js'
import { isPublicationExcluded } from './publicationExclusions.js'

// Zapier ("RSS -> LinkedIn company update") and LinkedIn's native Page RSS
// import treat every new item as one social post, so keep this window/cap
// generous but bounded rather than shipping the whole publication history.
export const PUBLICATION_FEED_WINDOW_DAYS = 60
export const PUBLICATION_FEED_MAX_ITEMS = 50

const DOI_PATTERN = /10\.\d{4,9}\/[^\s"'<>]+/

// Characters not valid in XML 1.0 content, including the noncharacters
// U+FFFE / U+FFFF. Stripped before escaping the standard XML entities.
const INVALID_XML_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\ufffe\uffff]/g

function collapseWhitespace(value) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

/**
 * Find the first DOI-shaped substring anywhere in a value.
 *
 * Cached DOIs can be malformed junk like
 * "pii: s0008-4182(26)00244-9. 10.1016/j.jcjo.2026.07.001" or carry a
 * "https://doi.org/" prefix. Searching for the "10.xxxx/..." shape anywhere
 * in the string (rather than requiring the whole field to be a clean DOI)
 * handles both, while keeping parentheses that are legitimately part of the
 * DOI itself (e.g. "10.1016/s0140-6736(26)00123-4").
 */
export function extractDoi(value) {
  const text = String(value || '')
  const match = text.match(DOI_PATTERN)
  if (!match) return ''
  return match[0].replace(/[.,;]+$/, '').toLowerCase()
}

/**
 * Resolve the stable guid/link pair for a feed item.
 *
 * DOI wins over PMID even when both are present: a publication can start out
 * DOI-only (Crossref/OpenAlex) and later merge with a PubMed record that adds
 * a PMID. If PMID took priority, that merge would change the guid/link and
 * cause Zapier/LinkedIn to repost a paper that already went out.
 */
export function getFeedItemIdentity(pub) {
  if (!pub) return null

  const doi = extractDoi(pub.doi)
  if (doi) {
    return { guid: `doi:${doi}`, link: `https://doi.org/${doi}` }
  }

  const pmid = String(pub.pmid || '').trim()
  if (pmid) {
    return { guid: `pmid:${pmid}`, link: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/` }
  }

  const link = String(pub.url || '').trim()
  if (!link) return null

  const guid = String(pub.publicationKey || '').trim() || link
  return { guid, link }
}

export function selectFeedPublications(publications, {
  now = new Date(),
  windowDays = PUBLICATION_FEED_WINDOW_DAYS,
  maxItems = PUBLICATION_FEED_MAX_ITEMS,
} = {}) {
  const cutoff = now.getTime() - windowDays * 24 * 60 * 60 * 1000

  const candidates = []
  for (const pub of publications || []) {
    if (!pub) continue
    if (isPublicationExcluded(pub)) continue
    if (!String(pub.title || '').trim()) continue
    if (!String(pub.laySummary || '').trim()) continue

    const identity = getFeedItemIdentity(pub)
    if (!identity) continue

    const date = getPublicationDate(pub)
    if (!date || date.getTime() < cutoff) continue

    candidates.push({ publication: pub, date, identity })
  }

  candidates.sort((a, b) => {
    const diff = b.date.getTime() - a.date.getTime()
    if (diff !== 0) return diff
    return String(a.publication.title || '').localeCompare(String(b.publication.title || ''))
  })

  const seenGuids = new Set()
  const deduped = []
  for (const candidate of candidates) {
    if (seenGuids.has(candidate.identity.guid)) continue
    seenGuids.add(candidate.identity.guid)
    deduped.push(candidate)
  }

  return deduped.slice(0, maxItems)
}

export function escapeXml(value) {
  const text = String(value == null ? '' : value)
  return text
    .replace(INVALID_XML_CHARS, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function buildItemXml(item, { provenance, researcherNameById }) {
  const { publication, date, identity } = item
  const title = collapseWhitespace(publication.title)
  const description = collapseWhitespace(publication.laySummary)
  const pubDate = date instanceof Date && !Number.isNaN(date.getTime()) ? date.toUTCString() : null

  const researcherIds = provenance[publication.publicationKey] || []
  const seenNames = new Set()
  const creatorLines = []
  for (const researcherId of researcherIds) {
    const name = researcherNameById.get(researcherId)
    if (!name || seenNames.has(name)) continue
    seenNames.add(name)
    creatorLines.push(`      <dc:creator>${escapeXml(name)}</dc:creator>`)
  }

  return [
    '    <item>',
    `      <title>${escapeXml(title)}</title>`,
    `      <link>${escapeXml(identity.link)}</link>`,
    `      <guid isPermaLink="false">${escapeXml(identity.guid)}</guid>`,
    pubDate ? `      <pubDate>${escapeXml(pubDate)}</pubDate>` : null,
    `      <description>${escapeXml(description)}</description>`,
    ...creatorLines,
    '    </item>',
  ].filter((line) => line !== null).join('\n')
}

export function buildPublicationFeedXml({
  items = [],
  provenance = {},
  researchers = [],
  siteTitle,
  siteUrl,
  channelDescription,
  lastBuildDate,
} = {}) {
  const baseUrl = String(siteUrl || '').replace(/\/$/, '')
  const channelTitle = `${siteTitle} publications`
  const channelLink = `${baseUrl}/publications`
  const selfLink = `${baseUrl}/publications/feed.xml`

  const researcherNameById = new Map(
    (researchers || [])
      .filter((researcher) => researcher && researcher._id)
      .map((researcher) => [researcher._id, researcher.name])
  )

  const lastBuildDateValue = (() => {
    if (!lastBuildDate) return null
    const parsed = new Date(lastBuildDate)
    return Number.isNaN(parsed.getTime()) ? null : parsed.toUTCString()
  })()

  const itemsXml = items
    .map((item) => buildItemXml(item, { provenance, researcherNameById }))
    .join('\n')

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/elements/1.1/">',
    '  <channel>',
    `    <title>${escapeXml(channelTitle)}</title>`,
    `    <link>${escapeXml(channelLink)}</link>`,
    `    <description>${escapeXml(channelDescription || '')}</description>`,
    '    <language>en</language>',
    lastBuildDateValue ? `    <lastBuildDate>${escapeXml(lastBuildDateValue)}</lastBuildDate>` : null,
    `    <atom:link href="${escapeXml(selfLink)}" rel="self" type="application/rss+xml"/>`,
    itemsXml || null,
    '  </channel>',
    '</rss>',
  ].filter((line) => line !== null).join('\n')
}
