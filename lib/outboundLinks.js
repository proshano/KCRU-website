const OUTBOUND_HOST_ALLOWLIST = [
  'pubmed.ncbi.nlm.nih.gov',
  'doi.org',
  'twitter.com',
  'x.com',
  'linkedin.com',
  'facebook.com',
]

function normalizeHostname(hostname) {
  return String(hostname || '').trim().toLowerCase()
}

function isAllowedHostname(hostname) {
  const normalized = normalizeHostname(hostname)
  if (!normalized) return false
  return OUTBOUND_HOST_ALLOWLIST.some((allowed) =>
    normalized === allowed || normalized.endsWith(`.${allowed}`)
  )
}

export function getAllowedOutboundUrl(rawUrl) {
  const cleaned = String(rawUrl || '').trim()
  if (!cleaned) return null
  let parsed
  try {
    parsed = new URL(cleaned)
  } catch (error) {
    return null
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
  if (!isAllowedHostname(parsed.hostname)) return null
  return parsed
}

export function buildOutboundRedirectUrl(rawUrl, { baseUrl } = {}) {
  const cleaned = String(rawUrl || '').trim()
  if (!cleaned) return ''
  let parsed
  try {
    parsed = new URL(cleaned)
  } catch (error) {
    return cleaned
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return cleaned
  if (!isAllowedHostname(parsed.hostname)) return cleaned
  const normalizedBaseUrl = String(baseUrl || '').trim().replace(/\/$/, '')
  const path = `/go?url=${encodeURIComponent(parsed.toString())}`
  return normalizedBaseUrl ? `${normalizedBaseUrl}${path}` : path
}
