import assert from 'node:assert/strict'
import test from 'node:test'

import { isCronAuthorized } from '../lib/cronUtils.js'

function requestWith(headers = {}) {
  const normalized = new Map(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]))
  return { headers: { get: (name) => normalized.get(name.toLowerCase()) || null } }
}

test('cron authorization fails closed when the secret is missing', () => {
  assert.equal(isCronAuthorized(requestWith({ 'x-vercel-cron': '1' }), ''), false)
  assert.equal(isCronAuthorized(requestWith({ authorization: 'Bearer anything' }), undefined), false)
})

test('cron authorization requires the configured bearer secret', () => {
  assert.equal(isCronAuthorized(requestWith({ authorization: 'Bearer expected' }), 'expected'), true)
  assert.equal(isCronAuthorized(requestWith({ authorization: 'Bearer wrong', 'x-vercel-cron': '1' }), 'expected'), false)
})
