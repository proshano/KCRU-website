export function extractBearerToken(request) {
  const header = request?.headers?.get?.('authorization') || ''
  if (!header) return ''
  if (header.startsWith('Bearer ')) return header.slice(7)
  return header
}

export function buildCorsHeaders(allowMethods = 'GET, POST, OPTIONS') {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': allowMethods,
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  }
}

export function getClientIp(headers) {
  const xfwd = headers?.get?.('x-forwarded-for')
  if (xfwd) return xfwd.split(',')[0]?.trim()
  return headers?.get?.('x-real-ip') || null
}
