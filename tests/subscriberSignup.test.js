import assert from 'node:assert/strict'
import test from 'node:test'

import { createOrRecoverSubscriber } from '../lib/subscriberSignup.js'

function headers() {
  return { get: () => null }
}

test('known subscriber recovery returns the token only for email delivery and does not change preferences', async () => {
  let patchCalled = false
  let createCalled = false
  const client = {
    config: () => ({ token: 'configured' }),
    fetch: async () => ({ _id: 'subscriber-1', manageToken: 'existing-token' }),
    patch: () => {
      patchCalled = true
      throw new Error('existing subscribers must not be overwritten')
    },
    create: async () => {
      createCalled = true
    },
  }

  const result = await createOrRecoverSubscriber({
    client,
    subscriber: { email: 'known@example.org', role: 'physician' },
    headers: headers(),
    recaptchaData: {},
    createToken: () => 'new-token',
  })

  assert.deepEqual(result, { manageToken: 'existing-token', created: false })
  assert.equal(patchCalled, false)
  assert.equal(createCalled, false)
})

test('a legacy subscriber missing a token receives only a token patch', async () => {
  let setValue = null
  const client = {
    config: () => ({ token: 'configured' }),
    fetch: async () => ({ _id: 'subscriber-1', manageToken: null }),
    patch: () => ({
      set(value) {
        setValue = value
        return this
      },
      async commit() {},
    }),
  }

  const result = await createOrRecoverSubscriber({
    client,
    subscriber: { email: 'known@example.org', role: 'physician' },
    headers: headers(),
    recaptchaData: {},
    createToken: () => 'new-token',
  })

  assert.deepEqual(result, { manageToken: 'new-token', created: false })
  assert.deepEqual(setValue, { manageToken: 'new-token' })
})

test('new subscriber creation stores preferences and keeps the token out of the caller contract', async () => {
  let createdDocument = null
  const client = {
    config: () => ({ token: 'configured' }),
    fetch: async () => null,
    create: async (document) => {
      createdDocument = document
    },
  }

  const result = await createOrRecoverSubscriber({
    client,
    subscriber: { email: 'new@example.org', role: 'physician' },
    headers: headers(),
    recaptchaData: { score: 0.9 },
    createToken: () => 'new-token',
  })

  assert.deepEqual(result, { manageToken: 'new-token', created: true })
  assert.equal(createdDocument.manageToken, 'new-token')
  assert.equal(createdDocument.email, 'new@example.org')
})
