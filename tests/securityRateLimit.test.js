import assert from 'node:assert/strict'
import test from 'node:test'

import {
  claimSecurityRateLimit,
  getRateLimitResponseDetails,
  SecurityRateLimitError,
} from '../lib/securityRateLimit.js'

function fakeClient({ count = 0, createError = null } = {}) {
  const created = []
  return {
    created,
    async fetch() {
      return count
    },
    async create(document) {
      if (createError) throw createError
      created.push(document)
      return document
    },
  }
}

test('stores only a hash of the protected rate-limit key', async () => {
  const client = fakeClient()
  await claimSecurityRateLimit({
    namespace: 'admin-login',
    key: 'Admin@Example.test',
    limit: 5,
    windowMs: 60_000,
    minimumIntervalMs: 1_000,
    client,
    now: 1_700_000_000_000,
  })

  assert.equal(client.created.length, 1)
  assert.equal(client.created[0]._type, 'securityRateLimit')
  assert.equal(client.created[0].keyHash.length, 64)
  assert.equal(JSON.stringify(client.created[0]).includes('Admin@Example.test'), false)
})

test('rejects requests after the durable window limit', async () => {
  const client = fakeClient({ count: 5 })
  await assert.rejects(
    claimSecurityRateLimit({
      namespace: 'admin-login',
      key: 'admin@example.test',
      limit: 5,
      windowMs: 60_000,
      minimumIntervalMs: 1_000,
      client,
    }),
    SecurityRateLimitError
  )
})

test('treats a duplicate time-bucket claim as a throttled request', async () => {
  const client = fakeClient({ createError: { statusCode: 409 } })
  await assert.rejects(
    claimSecurityRateLimit({
      namespace: 'admin-login',
      key: 'admin@example.test',
      limit: 5,
      windowMs: 60_000,
      minimumIntervalMs: 1_000,
      client,
    }),
    SecurityRateLimitError
  )
})

test('exposes a stable 429 response contract', () => {
  assert.deepEqual(getRateLimitResponseDetails(new SecurityRateLimitError('Wait.', 12)), {
    status: 429,
    message: 'Wait.',
    retryAfter: 12,
  })
  assert.equal(getRateLimitResponseDetails(new Error('no')), null)
})
