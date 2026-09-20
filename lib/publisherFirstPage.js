/**
 * Publisher first-page preview images.
 *
 * Editorials, commentaries and research letters are often indexed with no abstract, and a
 * paywalled publisher page shows their opening page only as an image above the purchase
 * prompt (SAGE's Peritoneal Dialysis International editorials are one example). Every
 * text source the DOI backfill knows misses those records, so this module locates that
 * preview image in the publisher HTML and fetches it for transcription.
 */

import { PUBLISHER_FIRST_PAGE_SOURCE } from './publicationIdentity.js'
import { safeFetchBytes } from './outboundUrlSafety.js'

export { PUBLISHER_FIRST_PAGE_SOURCE }

export const FIRST_PAGE_IMAGE_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']

const MAX_FIRST_PAGE_IMAGE_BYTES = Number(process.env.PUBMED_FIRST_PAGE_IMAGE_MAX_BYTES || 8 * 1024 * 1024)
const DEFAULT_TIMEOUT_MS = Number(process.env.PUBMED_FIRST_PAGE_IMAGE_TIMEOUT_MS || 15000)

// How far back from an <img> tag to look for the element that frames it.
const CONTAINER_LOOKBEHIND_CHARS = 2500

// Names publishers give the preview: "first-page", "firstPage", "page preview", ...
const FIRST_PAGE_HINT = /first[-_ ]?page|page[-_ ]?preview|preview[-_ ]?(?:image|page)/i

// Abstract containers across the common publisher platforms. A record with no abstract
// text usually shows its first-page image inside this block.
const ABSTRACT_CONTAINER_HINT = /(?:class|id)\s*=\s*["'][^"']*(?:abstractSection|article-section__abstract|hlFld-Abstract|abstract-section|abstract-content|\babstract\b)[^"']*["']/i

// Page chrome that also sits near the abstract: logos, icons, covers, ORCID badges.
const DECORATIVE_IMAGE = /(?:^|[^a-z])(?:icon|logo|cover|badge|orcid|avatar|sprite|button|banner|arrow|loader|spinner|social|share|advert|pixel|tracking|blank|placeholder|spacer)(?:[^a-z]|$)/i

const IMAGE_TAG = /<img\b[^>]*>/gi
const ATTRIBUTE = /([a-zA-Z:_-]+)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/g

function parseAttributes(tag) {
  const attrs = {}
  let match
  ATTRIBUTE.lastIndex = 0
  while ((match = ATTRIBUTE.exec(tag)) !== null) {
    const key = String(match[1] || '').toLowerCase()
    const value = String(match[2] || '').replace(/^['"]|['"]$/g, '')
    if (key) attrs[key] = value
  }
  return attrs
}

function decodeUrlEntities(value) {
  return String(value || '').replace(/&amp;/gi, '&').replace(/&#38;/g, '&').trim()
}

function isUsableImageReference(value) {
  const url = String(value || '').trim()
  if (!url) return false
  if (/^data:/i.test(url)) return false
  if (/\.svg(?:[?#]|$)/i.test(url)) return false
  return true
}

function pickLargestFromSrcset(srcset) {
  const candidates = String(srcset || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [url, descriptor] = entry.split(/\s+/)
      return { url, size: Number.parseFloat(descriptor) || 0 }
    })
    .filter((candidate) => isUsableImageReference(candidate.url))
  if (!candidates.length) return null
  candidates.sort((a, b) => b.size - a.size)
  return candidates[0].url
}

function pickImageReference(attrs) {
  // Lazy loaders keep the real image in a data attribute and a placeholder in src.
  for (const key of ['data-src', 'data-original', 'data-lazy-src', 'src']) {
    if (isUsableImageReference(attrs[key])) return attrs[key]
  }
  return pickLargestFromSrcset(attrs.srcset || attrs['data-srcset'])
}

function toAbsoluteImageUrl(reference, baseUrl) {
  const raw = decodeUrlEntities(reference)
  if (!raw) return null
  try {
    const url = baseUrl ? new URL(raw, baseUrl) : new URL(raw)
    if (url.protocol === 'http:') url.protocol = 'https:'
    if (url.protocol !== 'https:') return null
    url.hash = ''
    return url.toString()
  } catch {
    return null
  }
}

function pickHttpUrl(...values) {
  for (const value of values) {
    const candidate = decodeUrlEntities(value)
    if (!candidate) continue
    try {
      const url = new URL(candidate)
      if (url.protocol === 'https:' || url.protocol === 'http:') return url.toString()
    } catch {
      // not absolute; try the next candidate
    }
  }
  return null
}

/**
 * The URL relative image references on a publisher page resolve against. Rendered HTML
 * from the headless browser carries no request URL, so the page's own canonical link,
 * og:url or <base> is preferred, then whatever URL the caller fetched.
 */
export function resolvePublisherBaseUrl(html, fallbackUrl) {
  const text = String(html || '')
  const base = text.match(/<base\b[^>]*\bhref\s*=\s*["']([^"']+)["']/i)?.[1]
  const canonical = text.match(/<link\b[^>]*\brel\s*=\s*["']canonical["'][^>]*\bhref\s*=\s*["']([^"']+)["']/i)?.[1]
    || text.match(/<link\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*\brel\s*=\s*["']canonical["']/i)?.[1]
  const ogUrl = text.match(/<meta\b[^>]*\bproperty\s*=\s*["']og:url["'][^>]*\bcontent\s*=\s*["']([^"']+)["']/i)?.[1]
    || text.match(/<meta\b[^>]*\bcontent\s*=\s*["']([^"']+)["'][^>]*\bproperty\s*=\s*["']og:url["']/i)?.[1]
  return pickHttpUrl(base, canonical, ogUrl, fallbackUrl)
}

function scoreImageCandidate(attrs, context) {
  const own = ['src', 'data-src', 'data-original', 'data-lazy-src', 'alt', 'title', 'class', 'id']
    .map((key) => attrs[key])
    .filter(Boolean)
    .join(' ')

  const namedFirstPage = FIRST_PAGE_HINT.test(own)
  let score = 0
  if (namedFirstPage) score += 100
  if (FIRST_PAGE_HINT.test(context)) score += 60
  if (ABSTRACT_CONTAINER_HINT.test(context)) score += 30
  if (!namedFirstPage && DECORATIVE_IMAGE.test(own)) score -= 1000
  return score
}

/**
 * Find the first-page preview image on a publisher page, or null when there is none.
 *
 * Candidates are the page's <img> elements, ranked by how they are named (a src, alt
 * or class mentioning the first page), by the element that frames them (a first-page
 * or abstract container) and against a list of decorative images that also sit near
 * the abstract. Only an https URL is returned.
 */
export function extractFirstPageImageUrl(html, { baseUrl } = {}) {
  const text = String(html || '')
  if (!text) return null

  const resolvedBase = resolvePublisherBaseUrl(text, baseUrl)
  let best = null
  let match
  IMAGE_TAG.lastIndex = 0
  while ((match = IMAGE_TAG.exec(text)) !== null) {
    const attrs = parseAttributes(match[0])
    const reference = pickImageReference(attrs)
    if (!reference) continue

    const context = text.slice(Math.max(0, match.index - CONTAINER_LOOKBEHIND_CHARS), match.index)
    const score = scoreImageCandidate(attrs, context)
    if (score <= 0) continue

    const url = toAbsoluteImageUrl(reference, resolvedBase)
    if (!url) continue
    if (!best || score > best.score) best = { score, url }
  }

  return best?.url || null
}

export function normalizeImageMimeType(contentType) {
  const type = String(contentType || '').split(';')[0].trim().toLowerCase()
  if (!type) return null
  const normalized = type === 'image/jpg' ? 'image/jpeg' : type
  return FIRST_PAGE_IMAGE_CONTENT_TYPES.includes(normalized) ? normalized : null
}

/**
 * Download the preview image, plain fetch first and the headless browser second when a
 * fetcher is supplied. Returns { bytes, mimeType } or null.
 */
export async function fetchPublisherFirstPageImage(url, {
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxBytes = MAX_FIRST_PAGE_IMAGE_BYTES,
  fetchImpl,
  lookup,
  browserFetch,
} = {}) {
  const failures = []

  try {
    const { response, bytes } = await safeFetchBytes(url, {
      timeoutMs,
      maxBytes,
      allowedContentTypes: FIRST_PAGE_IMAGE_CONTENT_TYPES,
      headers: {
        Accept: 'image/jpeg,image/png,image/webp,image/gif,image/*;q=0.8',
        'User-Agent': 'KCRUWebsite/1.0 (+https://kcru.example)',
      },
      fetchImpl,
      lookup,
    })
    const mimeType = normalizeImageMimeType(response.headers.get('content-type'))
    if (bytes?.byteLength && mimeType) return { bytes, mimeType }
    failures.push('unsupported image type')
  } catch (err) {
    failures.push(err?.name === 'AbortError' ? 'timeout' : (err?.message || 'unknown'))
  }

  if (typeof browserFetch === 'function') {
    const result = await browserFetch(url, { maxBytes, allowedContentTypes: FIRST_PAGE_IMAGE_CONTENT_TYPES })
    const mimeType = normalizeImageMimeType(result?.contentType)
    if (result?.bytes?.byteLength && mimeType) return { bytes: result.bytes, mimeType }
    failures.push('browser fetch failed')
  }

  console.warn(`[first-page] Image fetch failed for ${url} — ${failures.join('; ')}`)
  return null
}
