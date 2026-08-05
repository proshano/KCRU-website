import { getAbstractByDoi as fetchOpenAlexAbstract } from './openalex.js'
import { browserFetchHtml, closeBrowser } from './browserFetch.js'
import { safeFetchText } from './outboundUrlSafety.js'

const DEFAULT_TIMEOUT_MS = Number(process.env.PUBMED_DOI_ABSTRACT_TIMEOUT_MS || 8000)
const BROWSER_FETCH_ENABLED =
  process.env.DOI_BROWSER_FETCH !== 'false' &&
  (!!process.env.VERCEL || process.env.DOI_BROWSER_FETCH === 'true')
const MIN_PUBLICATION_TEXT_LENGTH = 50
const MIN_ARTICLE_BODY_LENGTH = 500
const MAX_ARTICLE_BODY_CHARS = 20000
const MAX_PUBLISHER_HTML_BYTES = 2 * 1024 * 1024

const META_GROUPS = [
  {
    names: ['citation_abstract', 'dc.description', 'dc.description.abstract', 'dcterms.abstract'],
    minLength: 80,
  },
  {
    names: ['description', 'og:description', 'twitter:description'],
    minLength: 120,
  },
]

const NAMED_ENTITIES = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '-',
  mdash: '-',
  hellip: '...',
}

const IGNORE_PATTERNS = [
  /no abstract/i,
  /abstract not available/i,
]

function normalizeDoi(value) {
  if (!value) return null
  let doi = String(value).trim()
  doi = doi.replace(/^https?:\/\/(dx\.)?doi\.org\//i, '')
  doi = doi.replace(/^doi:\s*/i, '')
  return doi || null
}

function decodeHtmlEntities(value) {
  const text = String(value || '')
  if (!text.includes('&')) return text
  return text.replace(/&(#x[0-9a-fA-F]+|#\d+|[A-Za-z]+);/g, (match, entity) => {
    const key = entity.toLowerCase()
    if (NAMED_ENTITIES[key]) return NAMED_ENTITIES[key]

    let codePoint = null
    if (key.startsWith('#x')) {
      codePoint = Number.parseInt(key.slice(2), 16)
    } else if (key.startsWith('#')) {
      codePoint = Number.parseInt(key.slice(1), 10)
    }

    if (!Number.isFinite(codePoint)) return match
    try {
      return String.fromCodePoint(codePoint)
    } catch {
      return match
    }
  })
}

function normalizePublicationText(text) {
  if (!text) return null
  let s = decodeHtmlEntities(text)
  s = s.replace(/<[^>]+>/g, ' ')
  s = s.replace(/\s+/g, ' ').trim()
  if (!s || s.length < MIN_PUBLICATION_TEXT_LENGTH) return null
  if (IGNORE_PATTERNS.some((re) => re.test(s))) return null
  return s
}

function parseMetaTags(html) {
  const tags = []
  const metaRe = /<meta\b[^>]*>/gi
  const attrRe = /([a-zA-Z:_-]+)\s*=\s*(\"[^\"]*\"|'[^']*'|[^\s>]+)/g

  const metaMatches = html.match(metaRe) || []
  for (const tag of metaMatches) {
    const attrs = {}
    let attrMatch
    while ((attrMatch = attrRe.exec(tag)) !== null) {
      const key = String(attrMatch[1] || '').toLowerCase()
      const raw = attrMatch[2] || ''
      const value = raw.replace(/^['"]|['"]$/g, '')
      if (key) attrs[key] = value
    }
    const name = attrs.name || attrs.property
    const content = attrs.content
    if (name && content) {
      tags.push({ name: String(name).toLowerCase(), content })
    }
  }
  return tags
}

function pickAbstractFromMeta(tags) {
  if (!tags.length) return null

  const byName = new Map()
  for (const tag of tags) {
    const name = tag.name
    if (!name) continue
    const cleaned = normalizePublicationText(tag.content)
    if (!cleaned) continue
    const existing = byName.get(name)
    if (!existing || cleaned.length > existing.length) {
      byName.set(name, cleaned)
    }
  }

  if (byName.size === 0) return null

  for (const group of META_GROUPS) {
    for (const name of group.names) {
      const value = byName.get(name)
      if (value && value.length >= group.minLength) {
        return value
      }
    }
  }

  let best = null
  for (const value of byName.values()) {
    if (!best || value.length > best.length) {
      best = value
    }
  }
  return best && best.length >= MIN_PUBLICATION_TEXT_LENGTH ? best : null
}

async function fetchHtml(url, timeoutMs) {
  try {
    const { text } = await safeFetchText(url, {
      timeoutMs,
      maxBytes: MAX_PUBLISHER_HTML_BYTES,
      headers: {
        'Accept': 'text/html,application/xhtml+xml',
        'User-Agent': 'KCRUWebsite/1.0 (+https://kcru.example)',
      },
      allowedContentTypes: ['text/html', 'application/xhtml+xml'],
    })
    return text
  } catch (err) {
    const reason = err?.name === 'AbortError' ? 'timeout' : (err?.message || 'unknown')
    console.warn(`[doi-abstract] DOI scrape error for ${url} — ${reason}`)
    return null
  }
}

async function fetchCrossRefAbstract(doi, timeoutMs) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(
      `https://api.crossref.org/works/${encodeURIComponent(doi)}`,
      {
        headers: {
          'User-Agent': 'KCRUWebsite/1.0 (mailto:contact@kcru.example)',
          Accept: 'application/json',
        },
        signal: controller.signal,
      }
    )
    if (!response.ok) return null
    const data = await response.json()
    const raw = data?.message?.abstract
    return normalizePublicationText(raw)
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

async function fetchEuropePmcAbstract(doi, timeoutMs) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const params = new URLSearchParams({
    query: `DOI:"${doi}"`,
    resultType: 'core',
    format: 'json',
    pageSize: '5',
  })
  try {
    const response = await fetch(
      `https://www.ebi.ac.uk/europepmc/webservices/rest/search?${params}`,
      { signal: controller.signal }
    )
    if (!response.ok) return null
    const data = await response.json()
    const exactMatch = (data?.resultList?.result || []).find((item) => {
      return normalizeDoi(item?.doi) === doi
    })
    return normalizePublicationText(exactMatch?.abstractText)
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

// Patterns to search in browser-rendered HTML.
// Each entry: [regex to locate the opening tag, human label for logging].
const ABSTRACT_PATTERNS = [
  [/class\s*=\s*["'][^"']*article-section__abstract[^"']*["'][^>]*>([\s\S]*?)(?=<\/(?:section|div)>)/i, 'article-section__abstract'],
  [/id\s*=\s*["']abstract["'][^>]*>([\s\S]*?)(?=<\/(?:section|div)>)/i, 'id=abstract'],
  [/class\s*=\s*["'][^"']*\babstract\b[^"']*["'][^>]*>([\s\S]*?)(?=<\/(?:section|div)>)/i, 'class=abstract'],
  [/class\s*=\s*["'][^"']*ArticleAbstract[^"']*["'][^>]*>([\s\S]*?)(?=<\/(?:section|div)>)/i, 'ArticleAbstract'],
]

const ARTICLE_BODY_PATTERNS = [
  [/<article\b[^>]*>([\s\S]*?)<\/article>/i, 'article'],
  [/class\s*=\s*["'][^"']*article-section__content[^"']*["'][^>]*>([\s\S]*?)(?=<\/(?:section|div)>)/i, 'article-section__content'],
  [/class\s*=\s*["'][^"']*\bfulltext\b[^"']*["'][^>]*>([\s\S]*?)(?=<\/(?:section|div|article)>)/i, 'fulltext'],
  [/class\s*=\s*["'][^"']*NLM_sec[^"']*["'][^>]*>([\s\S]*?)(?=<\/(?:section|div)>)/i, 'NLM_sec'],
]

function removeNonArticleElements(html) {
  return String(html || '')
    .replace(/<(?:script|style|noscript|svg|nav|aside|footer|form)\b[\s\S]*?<\/(?:script|style|noscript|svg|nav|aside|footer|form)>/gi, ' ')
}

function extractTextByPatterns(html, patterns) {
  // Callers pass rendered HTML that may be missing (browser fetch blocked, plain fetch
  // refused). Returning null keeps the caller's source loop moving; throwing here used
  // to abort it on the first empty candidate and skip the remaining fallbacks.
  if (!html) return null
  for (const [re] of patterns) {
    const match = html.match(re)
    if (match?.[1]) {
      let text = removeNonArticleElements(match[1])
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
      text = decodeHtmlEntities(text)
      if (text.length >= MIN_PUBLICATION_TEXT_LENGTH) return text
    }
  }
  return null
}

function truncateArticleBody(text) {
  if (text.length <= MAX_ARTICLE_BODY_CHARS) return text
  const prefix = text.slice(0, MAX_ARTICLE_BODY_CHARS)
  const sentenceBoundary = prefix.lastIndexOf('. ')
  const cutoff = sentenceBoundary >= MAX_ARTICLE_BODY_CHARS * 0.8
    ? sentenceBoundary + 1
    : prefix.lastIndexOf(' ')
  return `${prefix.slice(0, Math.max(cutoff, 1)).trim()}…`
}

export function extractArticleBodyText(html) {
  const bodyText = extractTextByPatterns(html, ARTICLE_BODY_PATTERNS)
  if (!bodyText || bodyText.length < MIN_ARTICLE_BODY_LENGTH) return null
  return truncateArticleBody(bodyText)
}

/**
 * Use rendered publisher HTML when available, while retaining the plain-fetch HTML
 * as a body-text fallback when Chromium is disabled or cannot load the page.
 */
async function fetchPublisherPageContent(url, plainHtml) {
  let renderedHtml = null
  if (BROWSER_FETCH_ENABLED) {
    console.info(`[doi-abstract] Attempting headless browser fetch for ${url}`)
    renderedHtml = await browserFetchHtml(url)
    if (
      renderedHtml?.includes('<title>Just a moment...</title>') ||
      renderedHtml?.includes('cf-browser-verification')
    ) {
      console.warn(`[doi-abstract] Browser fetch hit unresolved Cloudflare challenge for ${url}`)
      renderedHtml = null
    }
  }

  if (renderedHtml) {
    const fromMeta = pickAbstractFromMeta(parseMetaTags(renderedHtml))
    if (fromMeta) {
      return { text: fromMeta, contentType: 'abstract', source: 'publisher browser' }
    }

    const fromAbstract = extractTextByPatterns(renderedHtml, ABSTRACT_PATTERNS)
    if (fromAbstract) {
      return { text: fromAbstract, contentType: 'abstract', source: 'publisher browser' }
    }
  }

  for (const [html, source] of [
    [renderedHtml, 'publisher browser'],
    [plainHtml, 'publisher HTML'],
  ]) {
    const fromArticleBody = extractArticleBodyText(html)
    if (fromArticleBody) {
      return { text: fromArticleBody, contentType: 'article_body', source }
    }
  }

  return null
}

function normalizeSourceResult(value, source) {
  const result = typeof value === 'string' ? { text: value } : value
  const text = normalizePublicationText(result?.text)
  if (!text) return null
  return {
    text,
    contentType: result?.contentType === 'article_body' || source.contentType === 'article_body'
      ? 'article_body'
      : 'abstract',
    source: result?.source || source.name,
  }
}

/**
 * Fetch the best available publication text for a DOI. Abstract sources are exhausted
 * in order before rendered article body text is accepted as the final fallback.
 *
 * After a batch of calls, the caller should invoke closeBrowserAfterBatch()
 * to release the shared browser instance.
 */
export async function fetchPublicationTextFromDoi(doi, {
  timeoutMs = DEFAULT_TIMEOUT_MS,
  sourceFetchers,
} = {}) {
  const normalized = normalizeDoi(doi)
  if (!normalized) return null

  const url = `https://doi.org/${encodeURI(normalized)}`
  let publisherHtml = null
  const sources = sourceFetchers || [
    {
      name: 'publisher metadata',
      fetch: async () => {
        publisherHtml = await fetchHtml(url, timeoutMs)
        return publisherHtml ? pickAbstractFromMeta(parseMetaTags(publisherHtml)) : null
      },
    },
    { name: 'Crossref', fetch: () => fetchCrossRefAbstract(normalized, timeoutMs) },
    { name: 'OpenAlex', fetch: () => fetchOpenAlexAbstract(normalized, { timeoutMs }) },
    { name: 'Europe PMC', fetch: () => fetchEuropePmcAbstract(normalized, timeoutMs) },
    { name: 'publisher page', fetch: () => fetchPublisherPageContent(url, publisherHtml) },
  ]

  for (const source of sources) {
    try {
      const result = normalizeSourceResult(await source.fetch(), source)
      if (!result) continue
      console.info(`[doi-abstract] ${source.name} succeeded for ${normalized}`, {
        contentType: result.contentType,
      })
      return result
    } catch (error) {
      console.warn(`[doi-abstract] ${source.name} failed for ${normalized} — ${error?.message || 'unknown'}`)
    }
  }

  console.warn(`[doi-abstract] All sources exhausted for ${normalized}`)
  return null
}

// Backward-compatible convenience for callers that only need the text.
export async function fetchAbstractFromDoi(doi, options = {}) {
  const result = await fetchPublicationTextFromDoi(doi, options)
  return result?.text || null
}

/**
 * Call after a batch of fetchAbstractFromDoi() calls to release the
 * shared headless browser instance.
 */
export { closeBrowser as closeBrowserAfterBatch } from './browserFetch.js'
