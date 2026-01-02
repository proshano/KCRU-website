const DEFAULT_TIMEOUT_MS = Number(process.env.PUBMED_DOI_ABSTRACT_TIMEOUT_MS || 8000)
const MIN_ABSTRACT_LENGTH = 50

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
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      headers: {
        'Accept': 'text/html,application/xhtml+xml',
        'User-Agent': 'KCRUWebsite/1.0 (+https://kcru.example)',
      },
      signal: controller.signal
    })
    if (!response.ok) return null
    return await response.text()
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

export async function fetchAbstractFromDoi(doi, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const normalized = normalizeDoi(doi)
  if (!normalized) return null
  const url = `https://doi.org/${encodeURI(normalized)}`
  const html = await fetchHtml(url, timeoutMs)
  if (!html) return null
  return pickAbstractFromMeta(parseMetaTags(html))
}

