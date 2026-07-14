import assert from 'node:assert/strict'
import test from 'node:test'

import {
  isBlockedNetworkAddress,
  safeFetchText,
  validatePublicOutboundUrl,
} from '../lib/outboundUrlSafety.js'

const publicLookup = async () => [{ address: '93.184.216.34', family: 4 }]

test('blocks local, private, link-local, and mapped network addresses', () => {
  for (const address of [
    '127.0.0.1',
    '10.1.2.3',
    '169.254.169.254',
    '172.16.0.1',
    '192.168.1.1',
    '::1',
    'fd00::1',
    'fe80::1',
    '::ffff:7f00:1',
  ]) {
    assert.equal(isBlockedNetworkAddress(address), true, address)
  }
  assert.equal(isBlockedNetworkAddress('93.184.216.34'), false)
  assert.equal(isBlockedNetworkAddress('2606:2800:220:1:248:1893:25c8:1946'), false)
})

test('requires HTTPS and rejects URL credentials and local hostnames', async () => {
  await assert.rejects(validatePublicOutboundUrl('http://example.com/feed', { lookup: publicLookup }), /protocol/i)
  await assert.rejects(validatePublicOutboundUrl('https://user:pass@example.com/feed', { lookup: publicLookup }), /credentials/i)
  await assert.rejects(validatePublicOutboundUrl('https://localhost/feed'), /host/i)
  await assert.rejects(validatePublicOutboundUrl('https://[::1]/feed'), /non-public/i)
})

test('validates each redirect target before following it', async () => {
  let calls = 0
  const fetchImpl = async () => {
    calls += 1
    return new Response(null, {
      status: 302,
      headers: { location: 'https://169.254.169.254/latest/meta-data/' },
    })
  }

  await assert.rejects(
    safeFetchText('https://example.com/start', { fetchImpl, lookup: publicLookup }),
    /non-public/i
  )
  assert.equal(calls, 1)
})

test('bounds streamed response bodies', async () => {
  const fetchImpl = async () => new Response('0123456789', {
    status: 200,
    headers: { 'content-type': 'text/plain' },
  })

  await assert.rejects(
    safeFetchText('https://example.com/feed', {
      fetchImpl,
      lookup: publicLookup,
      maxBytes: 5,
      allowedContentTypes: ['text/plain'],
    }),
    /byte limit/i
  )
})

test('returns bounded content from a public HTTPS endpoint', async () => {
  const fetchImpl = async () => new Response('<rss />', {
    status: 200,
    headers: { 'content-type': 'application/rss+xml' },
  })
  const result = await safeFetchText('https://example.com/feed', {
    fetchImpl,
    lookup: publicLookup,
    allowedContentTypes: ['application/rss+xml'],
  })
  assert.equal(result.text, '<rss />')
})
