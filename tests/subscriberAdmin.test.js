import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildNewSubscriberDocument,
  buildSubscriberPatch,
  getSubscriberStatus,
  validateSubscriberFields,
} from '../lib/subscriberAdmin.js'
import {
  createSubscriber,
  deleteSubscriber,
  mergeSubscriberRows,
  publishSubscriber,
  updateSubscriber,
} from '../lib/subscriberAdminStore.js'

const NOW = new Date('2026-09-27T12:00:00.000Z')
const CHOICES = { areaIds: ['area-ckd', 'area-dialysis'], siteIds: ['site-lhsc'] }
const NEW_SUBSCRIBER = {
  name: '  Jane Doe ',
  email: 'Jane.Doe@LHSC.on.ca',
  role: 'physician',
  specialty: 'nephrology',
  correspondencePreferences: ['newsletter', 'study_updates'],
  interestAreas: ['area-ckd', 'area-retired'],
  practiceSites: ['site-lhsc'],
  notes: 'Asked at rounds',
}

test('reads the stored status the way the send routes do', () => {
  assert.equal(getSubscriberStatus({ subscriptionStatus: 'subscribed', deliveryStatus: 'active' }), 'active')
  assert.equal(getSubscriberStatus({ subscriptionStatus: 'subscribed' }), 'active')
  assert.equal(getSubscriberStatus({ subscriptionStatus: 'subscribed', deliveryStatus: 'suppressed' }), 'suppressed')
  assert.equal(getSubscriberStatus({ subscriptionStatus: 'unsubscribed', deliveryStatus: 'active' }), 'unsubscribed')
  // Never delivered by the send routes, so it must not look active.
  assert.equal(getSubscriberStatus({}), 'unsubscribed')
})

test('validates only the fields that were sent unless all are required', () => {
  assert.deepEqual(validateSubscriberFields({ notes: ' x ' }), { ok: true, fields: { notes: 'x' } })
  assert.match(validateSubscriberFields({}, { required: true }).error, /email/)
  assert.match(validateSubscriberFields({ role: 'wizard' }).error, /role/)
  assert.match(validateSubscriberFields({ correspondencePreferences: ['spam'] }).error, /email types/)
  assert.match(validateSubscriberFields({ status: 'deleted' }).error, /status/)
})

test('a new subscriber needs confirmed consent and is stored like a signup made by an admin', () => {
  assert.equal(buildNewSubscriberDocument(NEW_SUBSCRIBER, { ...CHOICES }).code, 'consent_required')

  const result = buildNewSubscriberDocument(NEW_SUBSCRIBER, {
    ...CHOICES,
    consentConfirmed: true,
    now: NOW,
    manageToken: 'token-1',
    addedBy: 'Admin@LHSC.on.ca',
  })
  assert.equal(result.ok, true)
  assert.deepEqual(result.document, {
    _type: 'updateSubscriber',
    name: 'Jane Doe',
    email: 'jane.doe@lhsc.on.ca',
    role: 'physician',
    specialty: 'nephrology',
    correspondencePreferences: ['newsletter', 'study_updates'],
    allTherapeuticAreas: false,
    interestAreas: [{ _type: 'reference', _ref: 'area-ckd', _key: 'area-ckd' }],
    practiceSites: [{ _type: 'reference', _ref: 'site-lhsc', _key: 'site-lhsc' }],
    notes: 'Asked at rounds',
    subscriptionStatus: 'subscribed',
    deliveryStatus: 'active',
    source: 'admin',
    addedBy: 'admin@lhsc.on.ca',
    manageToken: 'token-1',
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    consent: { source: 'admin', timestamp: NOW.toISOString() },
  })
})

test('study update emails need an interest area or all areas', () => {
  const noAreas = buildNewSubscriberDocument(
    { ...NEW_SUBSCRIBER, interestAreas: ['area-retired'] },
    { ...CHOICES, consentConfirmed: true, now: NOW }
  )
  assert.match(noAreas.error, /interest area/)

  const allAreas = buildNewSubscriberDocument(
    { ...NEW_SUBSCRIBER, interestAreas: [], allTherapeuticAreas: true },
    { ...CHOICES, consentConfirmed: true, now: NOW }
  )
  assert.equal(allAreas.ok, true)
  assert.deepEqual(allAreas.document.interestAreas, [])
})

test('unsubscribing touches only the status, even on an incomplete old record', () => {
  const patch = buildSubscriberPatch({ status: 'unsubscribed' }, { status: 'active', correspondencePreferences: ['study_updates'] }, { now: NOW })
  assert.deepEqual(patch.set, {
    subscriptionStatus: 'unsubscribed',
    unsubscribedAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
  })
  assert.deepEqual(patch.unset, [])

  // A stored document without the list's `status` is read like the send routes read it.
  const fromDocument = buildSubscriberPatch({ status: 'unsubscribed' }, { subscriptionStatus: 'subscribed' }, { now: NOW })
  assert.equal(fromDocument.set.subscriptionStatus, 'unsubscribed')
})

test('resubscribing someone who opted out needs their confirmed request', () => {
  const current = { status: 'unsubscribed' }
  assert.equal(buildSubscriberPatch({ status: 'active' }, current, { now: NOW }).code, 'consent_required')

  const patch = buildSubscriberPatch({ status: 'active' }, current, { now: NOW, consentConfirmed: true })
  assert.deepEqual(patch.set, { subscriptionStatus: 'subscribed', deliveryStatus: 'active', updatedAt: NOW.toISOString() })
  assert.deepEqual(patch.unset, ['unsubscribedAt'])

  // Pausing and resuming delivery for someone still subscribed needs no confirmation.
  const suppress = buildSubscriberPatch({ status: 'suppressed' }, { status: 'active' }, { now: NOW })
  assert.equal(suppress.set.deliveryStatus, 'suppressed')
})

test('an edit clears blank optional fields and checks interest areas against the stored ones', () => {
  const patch = buildSubscriberPatch(
    { name: '', specialty: '', notes: '', correspondencePreferences: ['newsletter', 'study_updates'], ignored: 'x' },
    { status: 'active', correspondencePreferences: ['newsletter'], interestAreaIds: ['area-ckd'] },
    { ...CHOICES, now: NOW }
  )
  assert.equal(patch.ok, true)
  assert.deepEqual(patch.unset, ['name', 'notes', 'specialty'])
  assert.equal('ignored' in patch.set, false)

  const missing = buildSubscriberPatch(
    { correspondencePreferences: ['study_updates'] },
    { status: 'active', interestAreaIds: [] },
    { ...CHOICES, now: NOW }
  )
  assert.match(missing.error, /interest area/)
  assert.match(buildSubscriberPatch({ unknown: 1 }, {}, { now: NOW }).error, /Nothing to change/)
})

test('lists one row per person, preferring the published record, and marks never-published drafts', () => {
  const rows = mergeSubscriberRows([
    { _id: 'a', _rev: 'r1', email: 'a@x.ca', subscriptionStatus: 'subscribed', updatedAt: '2026-01-01T00:00:00Z' },
    { _id: 'drafts.a', _rev: 'r2', email: 'a-draft@x.ca', subscriptionStatus: 'subscribed', updatedAt: '2026-09-01T00:00:00Z' },
    { _id: 'drafts.b', _rev: 'r3', email: 'b@x.ca', subscriptionStatus: 'subscribed', deliveryStatus: 'suppressed', updatedAt: '2026-05-01T00:00:00Z', interestAreaIds: ['area-ckd', null] },
  ])
  assert.deepEqual(rows.map((row) => [row._id, row.email, row.status, row.draftOnly]), [
    ['drafts.b', 'b@x.ca', 'unpublished', true],
    ['a', 'a@x.ca', 'active', false],
  ])
  assert.deepEqual(rows[0].interestAreaIds, ['area-ckd'])
})

// A fake Sanity client holding documents by id; fetches answer by the query's intent.
function createClient(documents = {}, { mutateError } = {}) {
  const docs = new Map(Object.entries(documents))
  const calls = { mutate: [], create: [] }
  const withList = (doc) => doc && ({
    ...doc,
    interestAreaIds: (doc.interestAreas || []).map((ref) => ref._ref),
    practiceSiteIds: (doc.practiceSites || []).map((ref) => ref._ref),
  })
  return {
    calls,
    async fetch(query, params = {}) {
      if (query.includes('lower(email) == $email')) {
        return [...docs.values()].filter(
          (doc) => doc._type === 'updateSubscriber' && doc.email.toLowerCase() === params.email && !(params.excludeIds || []).includes(doc._id)
        )
      }
      if (query.includes('count(*[_id == $id]) > 0')) return docs.has(params.id)
      if (query.includes('*[_id == $id]')) {
        const doc = docs.get(params.id)
        if (!doc) return null
        const draft = docs.get(`drafts.${params.id}`)
        return { ...withList(doc), draft: draft ? { _id: draft._id, _rev: draft._rev } : null }
      }
      throw new Error(`Unexpected query: ${query}`)
    },
    async create(document) {
      calls.create.push(document)
      const created = { ...document, _id: 'new-1', _rev: 'rev-new' }
      docs.set(created._id, created)
      return created
    },
    async mutate(mutations) {
      calls.mutate.push(mutations)
      if (mutateError) throw mutateError
      for (const mutation of mutations) {
        if (mutation.create) docs.set(mutation.create._id, { ...mutation.create, _rev: 'rev-created' })
        if (mutation.delete) docs.delete(mutation.delete.id)
        if (mutation.patch) {
          const doc = docs.get(mutation.patch.id)
          const next = { ...doc, ...(mutation.patch.set || {}), _rev: `${doc._rev}+` }
          for (const key of mutation.patch.unset || []) delete next[key]
          docs.set(doc._id, next)
        }
      }
      return {}
    },
  }
}

const existing = () => ({
  'sub-1': {
    _id: 'sub-1',
    _rev: 'rev-1',
    _type: 'updateSubscriber',
    email: 'Jane.Doe@lhsc.on.ca',
    role: 'physician',
    correspondencePreferences: ['newsletter'],
    subscriptionStatus: 'subscribed',
    deliveryStatus: 'active',
  },
  'drafts.sub-1': {
    _id: 'drafts.sub-1',
    _rev: 'rev-draft',
    _type: 'updateSubscriber',
    email: 'Jane.Doe@lhsc.on.ca',
    subscriptionStatus: 'subscribed',
  },
  'settings': { _id: 'settings', _rev: 'rev-s', _type: 'siteSettings' },
})

test('refuses to add an address that is already on the list, whatever its case', async () => {
  const client = createClient(existing())
  await assert.rejects(
    createSubscriber(client, {
      input: { ...NEW_SUBSCRIBER, email: 'JANE.DOE@lhsc.on.ca' },
      consentConfirmed: true,
      ...CHOICES,
      now: NOW,
      createToken: () => 'token',
    }),
    (error) => error.statusCode === 409 && error.code === 'duplicate' && error.existingId === 'sub-1'
  )
  assert.equal(client.calls.create.length, 0)
})

test('creates a subscriber and returns it as a list row', async () => {
  const client = createClient({})
  const subscriber = await createSubscriber(client, {
    input: NEW_SUBSCRIBER,
    consentConfirmed: true,
    adminEmail: 'admin@lhsc.on.ca',
    ...CHOICES,
    now: NOW,
    createToken: () => 'token-9',
  })
  assert.equal(client.calls.create[0].manageToken, 'token-9')
  assert.equal(subscriber._id, 'new-1')
  assert.equal(subscriber.status, 'active')
  assert.deepEqual(subscriber.interestAreaIds, ['area-ckd'])
  assert.equal(subscriber.addedBy, 'admin@lhsc.on.ca')
})

test('edits the published record and its Studio draft, each guarded by its revision', async () => {
  const client = createClient(existing())
  const result = await updateSubscriber(client, {
    id: 'sub-1',
    rev: 'rev-1',
    changes: { status: 'unsubscribed' },
    now: NOW,
    ...CHOICES,
  })
  assert.equal(result.subscriber.status, 'unsubscribed')
  assert.equal(result.draftUpdated, true)
  assert.deepEqual(client.calls.mutate[0].map((mutation) => [mutation.patch.id, mutation.patch.ifRevisionID]), [
    ['sub-1', 'rev-1'],
    ['drafts.sub-1', 'rev-draft'],
  ])
})

test('reports a conflict when the subscriber changed after the list loaded', async () => {
  const client = createClient(existing())
  await assert.rejects(
    updateSubscriber(client, { id: 'sub-1', rev: 'stale', changes: { notes: 'x' }, now: NOW }),
    (error) => error.statusCode === 409
  )
  const racing = createClient(existing(), { mutateError: Object.assign(new Error('revision mismatch'), { statusCode: 409 }) })
  await assert.rejects(
    updateSubscriber(racing, { id: 'sub-1', rev: 'rev-1', changes: { notes: 'x' }, now: NOW }),
    (error) => error.statusCode === 409
  )
})

test('refuses ids that are not mailing list subscribers', async () => {
  const client = createClient(existing())
  await assert.rejects(
    updateSubscriber(client, { id: 'settings', rev: 'rev-s', changes: { notes: 'x' }, now: NOW }),
    (error) => error.statusCode === 400
  )
  await assert.rejects(deleteSubscriber(client, { id: 'settings' }), (error) => error.statusCode === 400)
  await assert.rejects(deleteSubscriber(client, { id: 'bad id!' }), (error) => error.statusCode === 400)
  await assert.rejects(deleteSubscriber(client, { id: 'missing' }), (error) => error.statusCode === 404)
  assert.equal(client.calls.mutate.length, 0)
})

test('changing an email to one already on the list is refused', async () => {
  const docs = existing()
  docs['sub-2'] = { _id: 'sub-2', _rev: 'rev-2', _type: 'updateSubscriber', email: 'other@lhsc.on.ca', subscriptionStatus: 'subscribed' }
  const client = createClient(docs)
  await assert.rejects(
    updateSubscriber(client, { id: 'sub-2', rev: 'rev-2', changes: { email: 'jane.doe@LHSC.on.ca' }, now: NOW }),
    (error) => error.statusCode === 409 && error.existingId === 'sub-1'
  )
  // Keeping your own address (in any case) is not a duplicate.
  await updateSubscriber(client, { id: 'sub-1', rev: 'rev-1', changes: { email: 'JANE.DOE@lhsc.on.ca' }, now: NOW })
})

test('deleting removes the published record and its Studio draft', async () => {
  const client = createClient(existing())
  await deleteSubscriber(client, { id: 'sub-1' })
  assert.deepEqual(client.calls.mutate[0], [{ delete: { id: 'sub-1' } }, { delete: { id: 'drafts.sub-1' } }])
})

const unpublished = () => ({
  ...existing(),
  'drafts.sub-9': {
    _id: 'drafts.sub-9',
    _rev: 'rev-9',
    _type: 'updateSubscriber',
    email: 'Studio.Only@lhsc.on.ca',
    role: 'nurse',
    correspondencePreferences: ['newsletter'],
    subscriptionStatus: 'subscribed',
    manageToken: 'token-from-studio',
    createdAt: '2026-01-01T00:00:00.000Z',
    lastNewsletterSentAt: '2026-06-01T00:00:00.000Z',
  },
})
const PUBLISH_FORM = { email: 'studio.only@lhsc.on.ca', role: 'nurse', correspondencePreferences: ['newsletter'], status: 'unpublished' }

test('publishing a never-published record creates it under the same id and removes the draft', async () => {
  const client = createClient(unpublished())
  const subscriber = await publishSubscriber(client, {
    id: 'drafts.sub-9',
    rev: 'rev-9',
    input: PUBLISH_FORM,
    consentConfirmed: true,
    adminEmail: 'admin@lhsc.on.ca',
    ...CHOICES,
    now: NOW,
    createToken: () => 'unused',
  })
  const [[create, remove]] = client.calls.mutate
  assert.equal(create.create._id, 'sub-9')
  assert.equal(create.create.subscriptionStatus, 'subscribed')
  assert.equal(create.create.deliveryStatus, 'active')
  // Links already sent with the Studio record's token keep working, and its history carries over.
  assert.equal(create.create.manageToken, 'token-from-studio')
  assert.equal(create.create.createdAt, '2026-01-01T00:00:00.000Z')
  assert.equal(create.create.lastNewsletterSentAt, '2026-06-01T00:00:00.000Z')
  assert.equal(create.create.addedBy, 'admin@lhsc.on.ca')
  assert.deepEqual(remove, { delete: { id: 'drafts.sub-9' } })
  assert.equal(subscriber._id, 'sub-9')
  assert.equal(subscriber.status, 'active')
})

test('publishing needs consent, a current revision, and an address nobody else has', async () => {
  const input = { id: 'drafts.sub-9', rev: 'rev-9', input: PUBLISH_FORM, ...CHOICES, now: NOW }
  await assert.rejects(
    publishSubscriber(createClient(unpublished()), input),
    (error) => error.statusCode === 400 && error.code === 'consent_required'
  )
  await assert.rejects(
    publishSubscriber(createClient(unpublished()), { ...input, rev: 'stale', consentConfirmed: true }),
    (error) => error.statusCode === 409
  )
  await assert.rejects(
    publishSubscriber(createClient(unpublished()), { ...input, id: 'sub-1', rev: 'rev-1', consentConfirmed: true }),
    (error) => error.statusCode === 400 && /already published/.test(error.message)
  )
  const taken = createClient(unpublished())
  await assert.rejects(
    publishSubscriber(taken, { ...input, input: { ...PUBLISH_FORM, email: 'jane.doe@lhsc.on.ca' }, consentConfirmed: true }),
    (error) => error.statusCode === 409 && error.code === 'duplicate'
  )
  assert.equal(taken.calls.mutate.length, 0)
})

test('a never-published record is published, not edited in place', async () => {
  await assert.rejects(
    updateSubscriber(createClient(unpublished()), { id: 'drafts.sub-9', rev: 'rev-9', changes: { notes: 'x' }, now: NOW }),
    (error) => error.statusCode === 400 && /never published/.test(error.message)
  )
})

test('adding an address held only by an unpublished record points staff to that record', async () => {
  await assert.rejects(
    createSubscriber(createClient(unpublished()), {
      input: { ...NEW_SUBSCRIBER, email: 'studio.only@LHSC.on.ca' },
      consentConfirmed: true,
      ...CHOICES,
      now: NOW,
      createToken: () => 'token',
    }),
    (error) => error.statusCode === 409 && error.code === 'duplicate' && /never published/.test(error.message)
  )
  // A draft that edits another, published subscriber's address is a different case.
  const docs = existing()
  docs['drafts.sub-1'].email = 'renamed@lhsc.on.ca'
  await assert.rejects(
    createSubscriber(createClient(docs), {
      input: { ...NEW_SUBSCRIBER, email: 'renamed@lhsc.on.ca' },
      consentConfirmed: true,
      ...CHOICES,
      now: NOW,
      createToken: () => 'token',
    }),
    (error) => error.statusCode === 409 && /unpublished change to another subscriber/.test(error.message)
  )
})
