import crypto from 'crypto'

const CLEANUP_INTERVAL_MS = 5 * 60 * 1000
let lastCleanupAt = 0

export class SecurityRateLimitError extends Error {
  constructor(message = 'Too many attempts. Please try again later.', retryAfter = 60) {
    super(message)
    this.name = 'SecurityRateLimitError'
    this.statusCode = 429
    this.retryAfter = Math.max(1, Math.ceil(Number(retryAfter) || 60))
  }
}

function hashRateLimitKey(value) {
  return crypto.createHash('sha256').update(String(value || '').trim().toLowerCase()).digest('hex')
}

function safeNamespace(value) {
  const normalized = String(value || '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '')
  if (!normalized) throw new Error('Rate-limit namespace is required.')
  return normalized.slice(0, 40)
}

function isConflict(error) {
  return error?.statusCode === 409 || error?.response?.statusCode === 409 || error?.response?.status === 409
}

async function pruneExpiredClaims(client, now) {
  if (typeof client?.delete !== 'function' || now - lastCleanupAt < CLEANUP_INTERVAL_MS) return
  lastCleanupAt = now
  try {
    await client.delete({
      query: '*[_type == "securityRateLimit" && expiresAt < $now]._id',
      params: { now: new Date(now).toISOString() },
    })
  } catch (error) {
    console.warn('[security-rate-limit] cleanup failed', error?.message || error)
  }
}

export async function claimSecurityRateLimit({
  namespace,
  key,
  limit,
  windowMs,
  minimumIntervalMs,
  client,
  now = Date.now(),
}) {
  const rateLimitClient = client || (await import('./sanity.js')).writeClient
  const normalizedNamespace = safeNamespace(namespace)
  const keyHash = hashRateLimitKey(key)
  const normalizedLimit = Math.max(1, Math.floor(Number(limit) || 1))
  const normalizedWindowMs = Math.max(1000, Math.floor(Number(windowMs) || 1000))
  const normalizedIntervalMs = Math.max(250, Math.floor(Number(minimumIntervalMs) || 1000))
  const windowStart = new Date(now - normalizedWindowMs).toISOString()

  const count = await rateLimitClient.fetch(
    `count(*[_type == "securityRateLimit" && namespace == $namespace && keyHash == $keyHash && occurredAt > $windowStart])`,
    { namespace: normalizedNamespace, keyHash, windowStart }
  )
  if (Number(count) >= normalizedLimit) {
    throw new SecurityRateLimitError('Too many attempts. Please try again later.', normalizedWindowMs / 1000)
  }

  const bucket = Math.floor(now / normalizedIntervalMs)
  const id = `securityRateLimit.${normalizedNamespace}.${keyHash.slice(0, 40)}.${bucket}`
  try {
    await rateLimitClient.create({
      _id: id,
      _type: 'securityRateLimit',
      namespace: normalizedNamespace,
      keyHash,
      occurredAt: new Date(now).toISOString(),
      expiresAt: new Date(now + normalizedWindowMs * 2).toISOString(),
    })
    await pruneExpiredClaims(rateLimitClient, now)
  } catch (error) {
    if (isConflict(error)) {
      throw new SecurityRateLimitError(
        'Please wait before trying again.',
        normalizedIntervalMs / 1000
      )
    }
    throw error
  }
}

export function getRateLimitResponseDetails(error) {
  if (!(error instanceof SecurityRateLimitError) && error?.statusCode !== 429) return null
  return {
    status: 429,
    message: error?.message || 'Too many attempts. Please try again later.',
    retryAfter: Math.max(1, Math.ceil(Number(error?.retryAfter) || 60)),
  }
}
