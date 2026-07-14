import dns from 'node:dns/promises'
import net from 'node:net'

const DEFAULT_MAX_REDIRECTS = 5
const DEFAULT_MAX_BYTES = 2 * 1024 * 1024
const BLOCKED_HOSTNAMES = new Set(['localhost', 'metadata.google.internal', 'metadata'])

function isBlockedIpv4(address) {
  const parts = address.split('.').map(Number)
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true
  const [a, b, c] = parts
  return a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 192 && b === 0 && c === 2) ||
    (a === 192 && b === 88 && c === 99) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224
}

function isBlockedIpv6(address) {
  const normalized = address.toLowerCase().split('%')[0]
  if (normalized === '::' || normalized === '::1') return true
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true
  if (/^fe[89ab]/.test(normalized) || normalized.startsWith('ff')) return true
  if (normalized.startsWith('2001:db8')) return true
  const mappedIpv4 = normalized.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1]
  if (mappedIpv4) return isBlockedIpv4(mappedIpv4)
  const mappedHex = normalized.match(/::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/)
  if (mappedHex) {
    const high = Number.parseInt(mappedHex[1], 16)
    const low = Number.parseInt(mappedHex[2], 16)
    return isBlockedIpv4(`${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`)
  }
  return false
}

export function isBlockedNetworkAddress(address) {
  const normalized = String(address || '').trim()
  const family = net.isIP(normalized)
  if (family === 4) return isBlockedIpv4(normalized)
  if (family === 6) return isBlockedIpv6(normalized)
  return true
}

function isBlockedHostname(hostname) {
  const normalized = String(hostname || '').toLowerCase().replace(/\.$/, '')
  return BLOCKED_HOSTNAMES.has(normalized) ||
    normalized.endsWith('.localhost') ||
    normalized.endsWith('.local') ||
    normalized.endsWith('.internal')
}

export async function validatePublicOutboundUrl(value, {
  allowedProtocols = ['https:'],
  lookup = dns.lookup,
  resolveDns = true,
} = {}) {
  let url
  try {
    url = value instanceof URL ? new URL(value.toString()) : new URL(String(value || ''))
  } catch {
    throw new Error('Outbound URL is invalid.')
  }

  if (!allowedProtocols.includes(url.protocol)) {
    throw new Error(`Outbound URL protocol is not allowed: ${url.protocol || '(missing)'}.`)
  }
  if (url.username || url.password) throw new Error('Outbound URL credentials are not allowed.')
  if (!url.hostname || isBlockedHostname(url.hostname)) throw new Error('Outbound URL host is not allowed.')

  const hostnameForIp = url.hostname.replace(/^\[|\]$/g, '')
  const literalFamily = net.isIP(hostnameForIp)
  if (literalFamily && isBlockedNetworkAddress(hostnameForIp)) {
    throw new Error('Outbound URL resolves to a non-public network address.')
  }

  if (resolveDns && !literalFamily) {
    const addresses = await lookup(url.hostname, { all: true, verbatim: true })
    if (!Array.isArray(addresses) || !addresses.length) throw new Error('Outbound URL host did not resolve.')
    if (addresses.some(({ address }) => isBlockedNetworkAddress(address))) {
      throw new Error('Outbound URL resolves to a non-public network address.')
    }
  }

  url.hash = ''
  return url
}

async function readTextWithLimit(response, maxBytes) {
  const contentLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new Error(`Outbound response exceeds the ${maxBytes}-byte limit.`)
  }

  if (!response.body?.getReader) {
    const text = await response.text()
    if (Buffer.byteLength(text, 'utf8') > maxBytes) {
      throw new Error(`Outbound response exceeds the ${maxBytes}-byte limit.`)
    }
    return text
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  const chunks = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maxBytes) {
        await reader.cancel()
        throw new Error(`Outbound response exceeds the ${maxBytes}-byte limit.`)
      }
      chunks.push(decoder.decode(value, { stream: true }))
    }
    chunks.push(decoder.decode())
    return chunks.join('')
  } finally {
    reader.releaseLock()
  }
}

export async function safeFetchText(value, {
  timeoutMs = 8000,
  maxBytes = DEFAULT_MAX_BYTES,
  maxRedirects = DEFAULT_MAX_REDIRECTS,
  headers,
  allowedProtocols = ['https:'],
  allowedContentTypes = [],
  fetchImpl = fetch,
  lookup = dns.lookup,
} = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    let current = await validatePublicOutboundUrl(value, { allowedProtocols, lookup })
    for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
      const response = await fetchImpl(current, {
        method: 'GET',
        redirect: 'manual',
        headers,
        signal: controller.signal,
      })

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location')
        if (!location) throw new Error('Outbound redirect did not include a location.')
        if (redirectCount === maxRedirects) throw new Error('Outbound request exceeded the redirect limit.')
        current = await validatePublicOutboundUrl(new URL(location, current), { allowedProtocols, lookup })
        continue
      }

      if (!response.ok) throw new Error(`Outbound request failed (${response.status}).`)
      const contentType = String(response.headers.get('content-type') || '').toLowerCase()
      if (allowedContentTypes.length && !allowedContentTypes.some((type) => contentType.startsWith(type))) {
        throw new Error(`Outbound response content type is not allowed: ${contentType || '(missing)'}.`)
      }
      const text = await readTextWithLimit(response, maxBytes)
      return { response, text, finalUrl: current.toString() }
    }
  } finally {
    clearTimeout(timer)
  }

  throw new Error('Outbound request failed.')
}
