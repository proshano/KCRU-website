import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { evaluate, parse } from 'groq-js'

import {
  DELIVERABLE_SUBSCRIBER_FILTER,
  PUBLISHED_SUBSCRIBER_FILTER,
  pickPublishedSubscriber,
} from '../lib/updateSubscriberStatus.js'

const subscriber = (fields) => ({
  _type: 'updateSubscriber',
  correspondencePreferences: ['newsletter'],
  subscriptionStatus: 'subscribed',
  deliveryStatus: 'active',
  ...fields,
})

const DATASET = [
  subscriber({ _id: 'published', email: 'a@lhsc.on.ca' }),
  subscriber({ _id: 'drafts.published', email: 'a@lhsc.on.ca' }),
  subscriber({ _id: 'drafts.never-published', email: 'b@lhsc.on.ca' }),
  subscriber({ _id: 'versions.release.published', email: 'a@lhsc.on.ca' }),
  subscriber({ _id: 'suppressed', email: 'c@lhsc.on.ca', deliveryStatus: 'suppressed' }),
  subscriber({ _id: 'unsubscribed', email: 'd@lhsc.on.ca', subscriptionStatus: 'unsubscribed' }),
  subscriber({ _id: 'no-status', email: 'e@lhsc.on.ca', subscriptionStatus: undefined }),
  subscriber({ _id: 'no-delivery-status', email: 'f@lhsc.on.ca', deliveryStatus: undefined }),
  subscriber({ _id: 'no-email' }),
  subscriber({ _id: 'study-only', email: 'g@lhsc.on.ca', correspondencePreferences: ['study_updates'] }),
  { _id: 'settings', _type: 'siteSettings', email: 'x@lhsc.on.ca' },
]

async function ids(query) {
  return (await (await evaluate(parse(query), { dataset: DATASET })).get()).sort()
}

test('sends reach only published, subscribed, unsuppressed records with an address', async () => {
  assert.deepEqual(
    await ids(`*[${DELIVERABLE_SUBSCRIBER_FILTER} && "newsletter" in correspondencePreferences]._id`),
    ['no-delivery-status', 'published']
  )
})

test('counts and lookups see every published record and no Studio draft or release copy', async () => {
  assert.deepEqual(await ids(`*[${PUBLISHED_SUBSCRIBER_FILTER}]._id`), [
    'no-delivery-status',
    'no-email',
    'no-status',
    'published',
    'study-only',
    'suppressed',
    'unsubscribed',
  ])
})

test('a lookup that matches a record and its Studio draft settles on the published record', () => {
  assert.deepEqual(pickPublishedSubscriber([{ _id: 'drafts.a' }, { _id: 'a' }]), {
    subscriber: { _id: 'a' },
    draft: { _id: 'drafts.a' },
  })
  assert.deepEqual(pickPublishedSubscriber([{ _id: 'drafts.b' }]), { subscriber: { _id: 'drafts.b' }, draft: null })
  assert.deepEqual(pickPublishedSubscriber({ _id: 'c' }), { subscriber: { _id: 'c' }, draft: null })
  assert.deepEqual(pickPublishedSubscriber(null), { subscriber: null, draft: null })
})

// The raw perspective returns Studio drafts, so a subscriber query written without the filter
// quietly emails or counts them. New queries must use the filter, or be listed here with the
// reason they handle drafts themselves.
const HANDLES_DRAFTS_ITSELF = new Map([
  ['app/api/updates/admin/suppression/route.js', 'bulk patches keep drafts in step with their records'],
  ['app/api/updates/manage/route.js', 'reads both copies and picks the published record'],
  ['lib/subscriberSignup.js', 'reads both copies and picks the published record'],
  ['lib/subscriberAdminStore.js', 'lists and edits drafts deliberately for the admin page'],
  ['lib/updateSubscriberStatus.js', 'defines the filters'],
])

function sourceFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return sourceFiles(path)
    return /\.(js|jsx|ts|tsx)$/.test(name) ? [path] : []
  })
}

test('every other subscriber query goes through the published filter', () => {
  // fileURLToPath decodes the URL; .pathname keeps spaces as %20 and the scan fails.
  const root = fileURLToPath(new URL('..', import.meta.url))
  const offenders = [...sourceFiles(join(root, 'app')), ...sourceFiles(join(root, 'lib'))]
    .map((path) => relative(root, path))
    .filter((path) => !HANDLES_DRAFTS_ITSELF.has(path))
    .filter((path) => /_type\s*==\s*\\?"updateSubscriber\\?"/.test(readFileSync(join(root, path), 'utf8')))
  assert.deepEqual(offenders, [])
})
