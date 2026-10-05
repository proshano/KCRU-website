import assert from 'node:assert/strict'
import test from 'node:test'

import { MAX_REQUESTS_PER_WINDOW, claimTrialMatchRateLimits } from '../lib/trialMatchApi.js'

function fakeRateLimitClient({ originCount = 0 } = {}) {
  const calls = { fetch: [], create: [] }
  return {
    calls,
    async fetch(query, params) {
      calls.fetch.push(params.namespace)
      return params.namespace === 'trial-match-origin' ? originCount : 0
    },
    async create(document) {
      calls.create.push(document.namespace)
      return document
    },
  }
}

function buildRequest() {
  return new Request('http://localhost/api/trials/match/chat', {
    method: 'POST',
    headers: { 'x-real-ip': '203.0.113.9' },
  })
}

test('a throttled origin never spends the shared aggregate budget', async () => {
  // The two claims once ran concurrently, so every attempt from an origin already over its
  // limit still created an aggregate claim, and one abusive origin could lock everyone out.
  const client = fakeRateLimitClient({ originCount: MAX_REQUESTS_PER_WINDOW })
  const response = await claimTrialMatchRateLimits(buildRequest(), { client })

  assert.equal(response.status, 429)
  assert.ok(response.headers.get('retry-after'))
  assert.deepEqual(client.calls.fetch, ['trial-match-origin'])
  assert.deepEqual(client.calls.create, [])
})

test('an allowed request claims the origin budget and then the aggregate one', async () => {
  const client = fakeRateLimitClient()
  const response = await claimTrialMatchRateLimits(buildRequest(), { client })

  assert.equal(response, null)
  assert.deepEqual(client.calls.fetch, ['trial-match-origin', 'trial-match-global'])
  assert.deepEqual(client.calls.create, ['trial-match-origin', 'trial-match-global'])
})
