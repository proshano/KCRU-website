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

// Studio drafts share the email and token of the record they edit, and drafts are never
// emailed, so the lookup must settle on the published record.
function draftAwareClient({ records, publishedIds = [] }) {
  const calls = { create: [], patch: [] }
  return {
    calls,
    config: () => ({ token: 'configured' }),
    fetch: async (query, params) => {
      if (query.includes('count(*[_id == $id]) > 0')) return publishedIds.includes(params.id)
      return records
    },
    patch: (id) => ({
      set(value) {
        calls.patch.push({ id, value })
        return this
      },
      async commit() {},
    }),
    create: async (document) => {
      calls.create.push(document)
    },
  }
}

test('recovery returns the published record even when a Studio draft of it matches too', async () => {
  const client = draftAwareClient({
    records: [
      { _id: 'drafts.subscriber-1', manageToken: 'shared-token' },
      { _id: 'subscriber-1', manageToken: 'shared-token' },
    ],
    publishedIds: ['subscriber-1'],
  })
  const result = await createOrRecoverSubscriber({
    client,
    subscriber: { email: 'known@example.org', role: 'physician' },
    headers: headers(),
    recaptchaData: {},
    createToken: () => 'new-token',
  })
  assert.deepEqual(result, { manageToken: 'shared-token', created: false })
  assert.equal(client.calls.create.length, 0)
})

test('an address held only by an unpublished draft is signed up under that draft id and token', async () => {
  const client = draftAwareClient({ records: [{ _id: 'drafts.studio-1', manageToken: 'studio-token' }] })
  const result = await createOrRecoverSubscriber({
    client,
    subscriber: { email: 'draft@example.org', role: 'nurse' },
    headers: headers(),
    recaptchaData: {},
    createToken: () => 'new-token',
  })
  assert.deepEqual(result, { manageToken: 'studio-token', created: true })
  assert.equal(client.calls.create[0]._id, 'studio-1')
  assert.equal(client.calls.create[0].subscriptionStatus, 'subscribed')
})

test('a draft that edits another published record never lends its id or token', async () => {
  const client = draftAwareClient({
    records: [{ _id: 'drafts.subscriber-2', manageToken: 'other-token' }],
    publishedIds: ['subscriber-2'],
  })
  const result = await createOrRecoverSubscriber({
    client,
    subscriber: { email: 'renamed@example.org', role: 'nurse' },
    headers: headers(),
    recaptchaData: {},
    createToken: () => 'new-token',
  })
  assert.deepEqual(result, { manageToken: 'new-token', created: true })
  assert.equal('_id' in client.calls.create[0], false)
})
