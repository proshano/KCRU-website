import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import test from 'node:test'

import {
  passcodeMatches,
  verifyAdminPasscodeChallenge,
} from '../lib/adminPasscodeVerification.js'
import { SecurityRateLimitError } from '../lib/securityRateLimit.js'

const NOW = Date.parse('2026-07-14T12:00:00.000Z')
const EMAIL = 'approvals-admin@example.test'
const CORRECT_CODE = '123456'
const CODE_HASH = crypto.createHash('sha256').update(CORRECT_CODE).digest('hex')

function createFakeClient({
  failedAttempts = 0,
  firstFetchBarrierCount = 0,
  ...overrides
} = {}) {
  let revision = 1
  let firstFetches = 0
  let releaseFirstFetches
  const firstFetchBarrier = new Promise((resolve) => {
    releaseFirstFetches = resolve
  })
  const fetchQueries = []
  const document = {
    _id: 'admin-session-1',
    _rev: `rev-${revision}`,
    _type: 'adminSession',
    email: EMAIL,
    codeHash: CODE_HASH,
    codeExpiresAt: new Date(NOW + 10 * 60 * 1000).toISOString(),
    failedAttempts,
    revoked: false,
    ...overrides,
  }

  function bumpRevision() {
    revision += 1
    document._rev = `rev-${revision}`
  }

  return {
    document,
    fetchQueries,
    mutate(fields) {
      Object.assign(document, fields)
      bumpRevision()
    },
    async fetch(query) {
      fetchQueries.push(query)
      const snapshot = structuredClone(document)
      if (firstFetchBarrierCount > 0 && firstFetches < firstFetchBarrierCount) {
        firstFetches += 1
        if (firstFetches === firstFetchBarrierCount) releaseFirstFetches()
        await firstFetchBarrier
      }
      return snapshot
    },
    patch(id) {
      let expectedRevision = null
      let fields = {}
      const patch = {
        ifRevisionId(value) {
          expectedRevision = value
          return patch
        },
        set(value) {
          fields = { ...fields, ...value }
          return patch
        },
        async commit(options = {}) {
          if (id !== document._id || expectedRevision !== document._rev) {
            throw { statusCode: 409 }
          }
          Object.assign(document, fields)
          bumpRevision()
          return options.returnDocuments === false ? null : structuredClone(document)
        },
      }
      return patch
    },
  }
}

function verify(client, overrides = {}) {
  return verifyAdminPasscodeChallenge({
    client,
    email: EMAIL,
    code: '000000',
    sessionTtlHours: 72,
    now: NOW,
    createToken: () => 'fixed-token',
    ...overrides,
  })
}

test('approvals verification reserves the final attempt before comparison', async () => {
  const client = createFakeClient({
    failedAttempts: 4,
    firstFetchBarrierCount: 2,
  })
  let comparisons = 0
  const compare = () => {
    comparisons += 1
    return false
  }

  const results = await Promise.allSettled([
    verify(client, { compare }),
    verify(client, { compare }),
  ])

  assert.equal(comparisons, 1)
  assert.equal(client.document.failedAttempts, 5)
  assert.ok(client.document.passcodeLockedAt)
  assert.equal(results.filter((result) => result.reason?.message === 'Invalid passcode.').length, 1)
  assert.equal(results.filter((result) => result.reason instanceof SecurityRateLimitError).length, 1)
  assert.ok(client.fetchQueries.every((query) => query.includes('_rev')))
})

test('approvals verification permits at most five concurrent comparisons', async () => {
  const requestCount = 8
  const client = createFakeClient({ firstFetchBarrierCount: requestCount })
  let comparisons = 0
  const compare = () => {
    comparisons += 1
    return false
  }

  const results = await Promise.allSettled(
    Array.from({ length: requestCount }, () => verify(client, { compare }))
  )

  assert.equal(comparisons, 5)
  assert.equal(client.document.failedAttempts, 5)
  assert.equal(results.filter((result) => result.reason?.message === 'Invalid passcode.').length, 5)
  assert.equal(results.filter((result) => result.reason instanceof SecurityRateLimitError).length, 3)
})

test('the owner of the fifth reservation can consume the passcode once', async () => {
  const client = createFakeClient({ failedAttempts: 4 })

  const result = await verify(client, {
    code: CORRECT_CODE,
    compare: passcodeMatches,
  })

  assert.equal(result.token, 'fixed-token')
  assert.equal(result.email, EMAIL)
  assert.equal(client.document.failedAttempts, 5)
  assert.equal(client.document.token, 'fixed-token')
  assert.ok(client.document.codeUsedAt)
  assert.ok(client.document.passcodeLockedAt)
})

test('success fails closed when challenge state changes after reservation', async () => {
  const client = createFakeClient()

  await assert.rejects(
    verify(client, {
      code: CORRECT_CODE,
      compare(code, hash) {
        client.mutate({ concurrentChange: true })
        return passcodeMatches(code, hash)
      },
    }),
    /Passcode state changed/
  )

  assert.equal(client.document.token, undefined)
  assert.equal(client.document.codeUsedAt, undefined)
})

test('sequential valid, used, expired, and locked challenge behavior is preserved', async (t) => {
  await t.test('valid', async () => {
    const client = createFakeClient()
    const result = await verify(client, { code: CORRECT_CODE })
    assert.equal(result.token, 'fixed-token')
  })

  await t.test('used', async () => {
    const client = createFakeClient({ codeUsedAt: new Date(NOW - 1000).toISOString() })
    await assert.rejects(verify(client), /Passcode already used/)
    assert.equal(client.document.failedAttempts, 0)
  })

  await t.test('expired', async () => {
    const client = createFakeClient({ codeExpiresAt: new Date(NOW - 1000).toISOString() })
    await assert.rejects(verify(client), /Passcode expired/)
    assert.equal(client.document.failedAttempts, 0)
  })

  await t.test('locked', async () => {
    const client = createFakeClient({ passcodeLockedAt: new Date(NOW - 1000).toISOString() })
    await assert.rejects(verify(client), SecurityRateLimitError)
    assert.equal(client.document.failedAttempts, 0)
  })
})
