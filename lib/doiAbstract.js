import { getAbstractByDoi as fetchOpenAlexAbstract } from './openalex.js'
import { browserFetchHtml, closeBrowser } from './browserFetch.js'
import { safeFetchText } from './outboundUrlSafety.js'

const DEFAULT_TIMEOUT_MS = Number(process.env.PUBMED_DOI_ABSTRACT_TIMEOUT_MS || 8000)
const BROWSER_FETCH_ENABLED =
  process.env.DOI_BROWSER_FETCH !== 'false' &&
  (!!process.env.VERCEL || process.env.DOI_BROWSER_FETCH === 'true')
const MIN_ABSTRACT_LENGTH = 50
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

function normalizeAbstract(text) {
  if (!text) return null
  let s = decodeHtmlEntities(text)
  s = s.replace(/<[^>]+>/g, ' ')
  s = s.replace(/\s+/g, ' ').trim()
  if (!s || s.length < MIN_ABSTRACT_LENGTH) return null
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
    const cleaned = normalizeAbstract(tag.content)
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
  return best && best.length >= MIN_ABSTRACT_LENGTH ? best : null
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
    return normalizeAbstract(raw)
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

const BODY_PATTERNS = [
  [/class\s*=\s*["'][^"']*article-section__content[^"']*["'][^>]*>([\s\S]*?)(?=<\/(?:section|div)>)/i, 'article-section__content'],
  [/class\s*=\s*["'][^"']*\bfulltext\b[^"']*["'][^>]*>([\s\S]*?)(?=<\/(?:section|div|article)>)/i, 'fulltext'],
  [/class\s*=\s*["'][^"']*NLM_sec[^"']*["'][^>]*>([\s\S]*?)(?=<\/(?:section|div)>)/i, 'NLM_sec'],
  [/<article[^>]*>([\s\S]*?)(?=<\/article>)/i, 'article'],
]

function extractTextByPatterns(html, patterns) {
  for (const [re] of patterns) {
    const match = html.match(re)
    if (match?.[1]) {
      let text = match[1]
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
      text = decodeHtmlEntities(text)
      if (text.length >= MIN_ABSTRACT_LENGTH) return text
    }
  }
  return null
}

/**
 * Try headless Chromium to render a Cloudflare-protected publisher page
 * and extract the abstract or article body text.
 */
async function fetchWithBrowser(url) {
  if (!BROWSER_FETCH_ENABLED) return null

  console.info(`[doi-abstract] Attempting headless browser fetch for ${url}`)
  const html = await browserFetchHtml(url)
  if (!html) return null

  // Cloudflare challenge pages have this title — if we still see it, the challenge didn't resolve
  if (html.includes('<title>Just a moment...</title>') || html.includes('cf-browser-verification')) {
    console.warn(`[doi-abstract] Browser fetch hit unresolved Cloudflare challenge for ${url}`)
    return null
  }

  // Try meta tags first (browser-rendered pages often have them)
  const fromMeta = pickAbstractFromMeta(parseMetaTags(html))
  if (fromMeta) return fromMeta

  // Try structured abstract selectors in the DOM
  const fromAbstract = extractTextByPatterns(html, ABSTRACT_PATTERNS)
  if (fromAbstract) return fromAbstract

  // Fall back to article body — truncate to a reasonable length for summarization
  const MAX_BODY_CHARS = 8000
  const bodyText = extractTextByPatterns(html, BODY_PATTERNS)
  if (bodyText) {
    const truncated = bodyText.length > MAX_BODY_CHARS
      ? bodyText.slice(0, MAX_BODY_CHARS).replace(/\s\S*$/, '…')
      : bodyText
    if (truncated.length >= MIN_ABSTRACT_LENGTH) return truncated
  }

  return null
}

/**
 * Fetch an abstract (or article text) for a DOI using a four-tier fallback:
 *   1. Scrape publisher page meta tags via plain fetch (fast, works for most publishers)
 *   2. CrossRef API (has abstract for ~60% of articles)
 *   3. OpenAlex API (reconstructs abstract from inverted index)
 *   4. Headless Chromium (bypasses Cloudflare, extracts abstract or article body)
 *
 * After a batch of calls, the caller should invoke closeBrowserAfterBatch()
 * to release the shared browser instance.
 */
export async function fetchAbstractFromDoi(doi, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const normalized = normalizeDoi(doi)
  if (!normalized) return null

  // Tier 1 — scrape publisher landing page
  const url = `https://doi.org/${encodeURI(normalized)}`
  const html = await fetchHtml(url, timeoutMs)
  if (html) {
    const scraped = pickAbstractFromMeta(parseMetaTags(html))
    if (scraped) return scraped
  }

  // Tier 2 — CrossRef API
  const crossRef = await fetchCrossRefAbstract(normalized, timeoutMs)
  if (crossRef) {
    console.info(`[doi-abstract] CrossRef fallback succeeded for ${normalized}`)
    return crossRef
  }

  // Tier 3 — OpenAlex API (inverted-index abstract)
  try {
    const openAlex = await fetchOpenAlexAbstract(normalized, { timeoutMs })
    const cleaned = normalizeAbstract(openAlex)
    if (cleaned) {
      console.info(`[doi-abstract] OpenAlex fallback succeeded for ${normalized}`)
      return cleaned
    }
  } catch {
    // OpenAlex unavailable — not critical
  }

  // Tier 4 — Headless Chromium (Cloudflare bypass)
  try {
    const browserResult = await fetchWithBrowser(url)
    if (browserResult) {
      console.info(`[doi-abstract] Browser fallback succeeded for ${normalized}`)
      return browserResult
    }
  } catch (err) {
    console.warn(`[doi-abstract] Browser fallback error for ${normalized} — ${err?.message || 'unknown'}`)
  }

  console.warn(`[doi-abstract] All sources exhausted for ${normalized}`)
  return null
}

/**
 * Call after a batch of fetchAbstractFromDoi() calls to release the
 * shared headless browser instance.
 */
export { closeBrowser as closeBrowserAfterBatch } from './browserFetch.js'
