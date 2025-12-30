import { readCache } from '@/lib/pubmedCache'
import { client as sanityClient } from '@/lib/sanity'
import { normalizeDescription } from '@/lib/seo'

const DEFAULT_SAMPLE_LIMIT = Number(process.env.SEO_PUBLICATION_SAMPLE_LIMIT || 250)
const DEFAULT_HIGHLIGHT_LIMIT = Number(process.env.SEO_PUBLICATION_HIGHLIGHTS_LIMIT || 12)
const DEFAULT_TOPIC_LIMIT = Number(process.env.SEO_PUBLICATION_TOPICS_LIMIT || 15)
const DEFAULT_SUMMARY_MAX_CHARS = Number(process.env.SEO_PUBLICATION_SUMMARY_MAX_CHARS || 220)
const DEFAULT_TAGS_PER_HIGHLIGHT = Number(process.env.SEO_PUBLICATION_TAGS_PER_HIGHLIGHT || 6)

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

function normalizeTag(value) {
  const cleaned = cleanText(value)
  if (!cleaned) return ''
  return cleaned
}

function parseNumber(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function sortPublications(publications) {
  return [...publications].sort((a, b) => {
    const yearDiff = parseNumber(b.year) - parseNumber(a.year)
    if (yearDiff !== 0) return yearDiff
    const pmidDiff = parseNumber(b.pmid) - parseNumber(a.pmid)
    if (pmidDiff !== 0) return pmidDiff
    return cleanText(a.title).localeCompare(cleanText(b.title))
  })
}

function uniqueTags(tags, limit) {
  const seen = new Set()
  const out = []
  ;(tags || []).forEach((tag) => {
    const cleaned = normalizeTag(tag)
    if (!cleaned) return
    const key = cleaned.toLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    out.push(cleaned)
  })
  if (Number.isFinite(limit) && limit > 0) return out.slice(0, limit)
  return out
}

function buildTagCounts(publications) {
  const counts = new Map()
  publications.forEach((pub) => {
    const tags = uniqueTags([
      ...(pub.topics || []),
      ...(pub.studyDesign || []),
      ...(pub.methodologicalFocus || [])
    ])
    tags.forEach((tag) => {
      counts.set(tag, (counts.get(tag) || 0) + 1)
    })
  })
  return counts
}

function topTags(counts, limit) {
  return [...counts.entries()]
    .sort((a, b) => {
      const diff = b[1] - a[1]
      if (diff !== 0) return diff
      return a[0].localeCompare(b[0])
    })
    .slice(0, Number.isFinite(limit) && limit > 0 ? limit : undefined)
    .map(([name]) => name)
}

async function fetchClassificationsByPmid(pmids = []) {
  if (!pmids.length) return new Map()
  const docs = await sanityClient.fetch(
    `*[_type == "pubmedClassification" && pmid in $pmids]{
      pmid,
      topics,
      studyDesign,
      methodologicalFocus,
      exclude
    }`,
    { pmids }
  )
  const map = new Map()
  for (const doc of docs || []) {
    if (!doc?.pmid) continue
    map.set(doc.pmid, {
      topics: doc.topics || [],
      studyDesign: doc.studyDesign || [],
      methodologicalFocus: doc.methodologicalFocus || [],
      exclude: typeof doc.exclude === 'boolean' ? doc.exclude : undefined
    })
  }
  return map
}

function mergeClassifications(publications, classMap) {
  if (!classMap || classMap.size === 0) return publications
  return publications.map((pub) => {
    const merged = classMap.get(pub.pmid)
    if (!merged) return pub
    return {
      ...pub,
      topics: merged.topics?.length ? merged.topics : pub.topics || [],
      studyDesign: merged.studyDesign?.length ? merged.studyDesign : pub.studyDesign || [],
      methodologicalFocus: merged.methodologicalFocus?.length ? merged.methodologicalFocus : pub.methodologicalFocus || [],
      exclude: typeof merged.exclude === 'boolean' ? merged.exclude : pub.exclude
    }
  })
}

function resolvePublicationUrl(pub) {
  const direct = cleanText(pub.pubmedUrl || pub.url || '')
  if (direct) return direct
  const pmid = cleanText(pub.pmid)
  if (!pmid) return ''
  return `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`
}

function buildHighlight(pub, summaryMaxChars, tagsPerHighlight) {
  const title = cleanText(pub.title)
  if (!title) return null
  const summarySource = pub.laySummary || pub.abstract || ''
  const summary = normalizeDescription(summarySource, summaryMaxChars)
  const tags = uniqueTags([
    ...(pub.topics || []),
    ...(pub.studyDesign || []),
    ...(pub.methodologicalFocus || [])
  ], tagsPerHighlight)

  return {
    title,
    summary,
    year: cleanText(pub.year),
    url: resolvePublicationUrl(pub),
    tags
  }
}

export async function getPublicationSeoSnapshot(options = {}) {
  const {
    sampleLimit = DEFAULT_SAMPLE_LIMIT,
    highlightLimit = DEFAULT_HIGHLIGHT_LIMIT,
    topicLimit = DEFAULT_TOPIC_LIMIT,
    summaryMaxChars = DEFAULT_SUMMARY_MAX_CHARS,
    tagsPerHighlight = DEFAULT_TAGS_PER_HIGHLIGHT
  } = options

  const cache = await readCache()
  const publicationsRaw = Array.isArray(cache?.publications) ? cache.publications : []
  if (!publicationsRaw.length) {
    return {
      topics: [],
      highlights: [],
      total: 0,
      generatedAt: cache?.generatedAt || null
    }
  }

  const sorted = sortPublications(publicationsRaw)
  const effectiveSampleLimit = Math.max(sampleLimit, highlightLimit)
  const sample = sorted.slice(0, effectiveSampleLimit)
  const pmids = sample.map((pub) => pub?.pmid).filter(Boolean)
  const classMap = await fetchClassificationsByPmid(pmids)
  const merged = mergeClassifications(sample, classMap)
  const filtered = merged.filter((pub) => pub?.exclude !== true)

  const highlights = filtered
    .slice(0, highlightLimit)
    .map((pub) => buildHighlight(pub, summaryMaxChars, tagsPerHighlight))
    .filter(Boolean)

  const tagCounts = buildTagCounts(filtered)
  const topics = topTags(tagCounts, topicLimit)

  return {
    topics,
    highlights,
    total: filtered.length,
    generatedAt: cache?.generatedAt || null
  }
}
