import assert from 'node:assert/strict'
import test from 'node:test'

import {
  DEFAULT_X_INTRO,
  MAX_NEW_POSTS_PER_SYNC,
  X_MAX_WEIGHTED_LENGTH,
  approveSocialPost,
  buildSocialPostApprovalEmail,
  buildXPostText,
  canManageSocialPosts,
  createBufferClient,
  planSocialPostSync,
  resolveXChannel,
  restoreSocialPost,
  selectSocialPostsToNotify,
  skipSocialPost,
  validateXPostText,
  xWeightedLength,
} from '../lib/socialPosting.js'
import {
  buildSocialPostNotificationIdempotencyKey,
  buildSocialPostRecord,
  dispatchSocialPostNotifications,
  socialPostDocumentId,
} from '../lib/socialPostingServer.js'

const NOW = new Date('2026-09-25T12:00:00Z')
const HOUR_MS = 60 * 60 * 1000
const LINK = 'https://doi.org/10.1000/xyz'
const API_KEY = 'buffer-secret-key-123'

function feedItem(guid, date, overrides = {}) {
  return {
    publication: { title: `Paper ${guid}`, journal: 'Kidney Journal', ...overrides },
    date: new Date(date),
    identity: { guid, link: `https://doi.org/${guid.replace(/^doi:/, '')}` },
  }
}

function pendingRecord(overrides = {}) {
  return {
    _id: 'socialPost-x-1',
    _rev: 'rev-1',
    status: 'pending',
    title: 'A kidney paper',
    text: `New publication: A kidney paper ${LINK}`,
    proposedText: `New publication: A kidney paper ${LINK}`,
    link: LINK,
    teamMembers: ['Jane Smith'],
    publishedAt: '2026-09-20T00:00:00.000Z',
    notificationCount: 0,
    ...overrides,
  }
}

function jsonResponse(body, { status = 200, headers = {} } = {}) {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  })
}

function fakeFetch(responses) {
  const calls = []
  const queue = [...responses]
  const fetchImpl = async (url, options) => {
    calls.push({ url, options, body: JSON.parse(options.body) })
    const next = queue.shift()
    if (next instanceof Error) throw next
    return typeof next === 'function' ? next() : next
  }
  return { calls, fetchImpl }
}

function fakeStore(initial) {
  const calls = []
  let document = initial ? { ...initial } : null
  const record = (name, ...args) => calls.push({ name, args })
  return {
    calls,
    get current() { return document },
    async get(id) {
      record('get', id)
      return document && document._id === id ? { ...document } : null
    },
    async markSending(id, rev, fields) {
      record('markSending', id, rev, fields)
      if (rev !== document._rev) {
        const error = new Error('Document has unexpected revision ID')
        error.conflict = true
        throw error
      }
      document = { ...document, ...fields, status: 'sending', _rev: `${rev}-next` }
    },
    async markQueued(id, fields) {
      record('markQueued', id, fields)
      document = { ...document, ...fields, status: 'queued' }
    },
    async returnToPending(id, fields) {
      record('returnToPending', id, fields)
      document = { ...document, ...fields, status: 'pending' }
    },
    async markUnknown(id, fields) {
      record('markUnknown', id, fields)
      document = { ...document, ...fields }
    },
    async skip(id, rev, fields) {
      record('skip', id, rev, fields)
      document = { ...document, ...fields, status: 'skipped' }
    },
    async restore(id, rev) {
      record('restore', id, rev)
      document = { ...document, status: 'pending', skippedBy: undefined, skippedAt: undefined }
    },
  }
}

function fakeBuffer({ channels, queue } = {}) {
  const calls = []
  return {
    calls,
    async listChannels() {
      calls.push('listChannels')
      if (channels instanceof Error) throw channels
      return channels || [{ id: 'chan-x', name: 'KCRU on X', service: 'twitter' }]
    },
    async queuePost(input) {
      calls.push({ queuePost: input })
      if (queue instanceof Error) throw queue
      return queue || { id: 'buffer-post-1', dueAt: '2026-09-26T14:00:00.000Z' }
    },
  }
}

function bufferError(message, ambiguous) {
  const error = new Error(message)
  error.ambiguous = ambiguous
  return error
}

test('only approvals admins can manage social posts', () => {
  assert.equal(canManageSocialPosts({ approvals: true }), true)
  assert.equal(canManageSocialPosts({ updates: true }), false)
  assert.equal(canManageSocialPosts(null), false)
})

test('xWeightedLength counts ASCII once, CJK and emoji twice, and a URL as 23', () => {
  assert.equal(xWeightedLength('Hello'), 5)
  assert.equal(xWeightedLength('腎臓'), 4)
  assert.equal(xWeightedLength('🎉'), 2)
  assert.equal(xWeightedLength('“quoted” – dash'), 15)
  assert.equal(xWeightedLength(LINK), 23)
  assert.equal(xWeightedLength(`Read ${LINK} now https://example.org/a-very-long-path/that/keeps/going`), 5 + 23 + 5 + 23)
})

test('buildXPostText keeps a short post unchanged', () => {
  const text = buildXPostText({ intro: 'New from KCRU:', title: '  A  kidney\npaper ', link: LINK })
  assert.equal(text, `New from KCRU: A kidney paper ${LINK}`)
})

test('buildXPostText falls back to the default intro when it is blank', () => {
  assert.equal(buildXPostText({ intro: '   ', title: 'A paper', link: LINK }), `${DEFAULT_X_INTRO} A paper ${LINK}`)
  assert.equal(buildXPostText({ title: 'A paper', link: LINK }), `${DEFAULT_X_INTRO} A paper ${LINK}`)
})

test('buildXPostText truncates a long title at a word boundary to fit X', () => {
  const title = Array.from({ length: 60 }, (_, index) => `word${index}`).join(' ').slice(0, 300)
  assert.equal(title.length, 300)
  const text = buildXPostText({ title, link: LINK })
  assert.ok(xWeightedLength(text) <= X_MAX_WEIGHTED_LENGTH)
  assert.ok(text.startsWith(`${DEFAULT_X_INTRO} word0 word1`))
  assert.ok(text.endsWith(`… ${LINK}`))
  assert.match(text, /word\d+… https/)

  const withoutLink = buildXPostText({ title })
  assert.ok(xWeightedLength(withoutLink) <= X_MAX_WEIGHTED_LENGTH)
  assert.ok(withoutLink.endsWith('…'))
})

test('validateXPostText rejects empty and over-limit text', () => {
  assert.deepEqual(validateXPostText(`Hi ${LINK}`), { ok: true, weightedLength: 26, error: null })
  assert.equal(validateXPostText('   ').ok, false)
  const tooLong = validateXPostText('a'.repeat(281))
  assert.equal(tooLong.ok, false)
  assert.equal(tooLong.weightedLength, 281)
  assert.match(tooLong.error, /281/)
  assert.equal(validateXPostText('界'.repeat(141)).ok, false)
  assert.equal(validateXPostText('界'.repeat(140)).ok, true)
})

test('socialPostDocumentId is deterministic and Sanity-safe', () => {
  const id = socialPostDocumentId('x', 'doi:10.1000/abc.def(1)')
  assert.equal(id, socialPostDocumentId('x', 'doi:10.1000/abc.def(1)'))
  assert.notEqual(id, socialPostDocumentId('x', 'doi:10.1000/other'))
  assert.match(id, /^[A-Za-z0-9_-]+$/)
  assert.match(id, /^socialPost-x-[0-9a-f]{40}$/)
})

test('buildSocialPostRecord uses the feed identity and builds the suggested text', () => {
  const item = feedItem('doi:10.1000/xyz', '2026-09-20T00:00:00Z', { title: 'A kidney paper' })
  const record = buildSocialPostRecord({ item, network: 'x', intro: '', teamMembers: ['Jane Smith', 'Jane Smith'], status: 'pending', now: NOW })
  assert.equal(record._id, socialPostDocumentId('x', 'doi:10.1000/xyz'))
  assert.equal(record._type, 'socialPost')
  assert.equal(record.guid, 'doi:10.1000/xyz')
  assert.equal(record.link, LINK)
  assert.equal(record.journal, 'Kidney Journal')
  assert.equal(record.publishedAt, '2026-09-20T00:00:00.000Z')
  assert.deepEqual(record.teamMembers, ['Jane Smith'])
  assert.equal(record.text, `${DEFAULT_X_INTRO} A kidney paper ${LINK}`)
  assert.equal(record.proposedText, record.text)
  assert.equal(record.status, 'pending')
  assert.equal(record.createdAt, NOW.toISOString())
})

test('planSocialPostSync creates every feed item on the first sync, oldest first, even above maxNew', () => {
  const items = [feedItem('doi:b', '2026-09-20'), feedItem('doi:a', '2026-09-10')]
  const plan = planSocialPostSync({ items, records: [] })
  assert.equal(plan.mode, 'create')
  assert.deepEqual(plan.toCreate.map((item) => item.identity.guid), ['doi:a', 'doi:b'])

  const many = Array.from({ length: MAX_NEW_POSTS_PER_SYNC + 5 }, (_, index) => feedItem(`doi:${index}`, '2026-09-20'))
  const bigPlan = planSocialPostSync({ items: many, records: [] })
  assert.equal(bigPlan.mode, 'create')
  assert.equal(bigPlan.toCreate.length, many.length)
})

test('planSocialPostSync creates only unrecorded items, oldest first, never recreating any status', () => {
  const items = [
    feedItem('doi:new-late', '2026-09-22'),
    feedItem('doi:new-b', '2026-09-15'),
    feedItem('doi:new-a', '2026-09-15'),
    ...['seeded', 'pending', 'sending', 'queued', 'skipped'].map((status) => feedItem(`doi:${status}`, '2026-09-01')),
  ]
  const records = ['seeded', 'pending', 'sending', 'queued', 'skipped'].map((status) => ({ guid: `doi:${status}`, status }))
  const plan = planSocialPostSync({ items, records })
  assert.equal(plan.mode, 'create')
  assert.deepEqual(plan.toCreate.map((item) => item.identity.guid), ['doi:new-a', 'doi:new-b', 'doi:new-late'])
})

test('planSocialPostSync aborts when a sync finds too many new items', () => {
  const items = Array.from({ length: MAX_NEW_POSTS_PER_SYNC + 1 }, (_, index) => feedItem(`doi:${index}`, '2026-09-20'))
  const plan = planSocialPostSync({ items, records: [{ guid: 'doi:old', status: 'queued' }] })
  assert.equal(plan.mode, 'abort')
  assert.equal(plan.newCount, MAX_NEW_POSTS_PER_SYNC + 1)
  assert.match(plan.reason, /"seed": true/)

  const atLimit = planSocialPostSync({ items: items.slice(0, MAX_NEW_POSTS_PER_SYNC), records: [{ guid: 'doi:old' }] })
  assert.equal(atLimit.mode, 'create')
})

test('planSocialPostSync seed option marks unrecorded items as seeded instead of aborting', () => {
  const items = Array.from({ length: 12 }, (_, index) => feedItem(`doi:${index}`, '2026-09-20'))
  const plan = planSocialPostSync({ items, records: [{ guid: 'doi:0', status: 'queued' }], seed: true })
  assert.equal(plan.mode, 'seed')
  assert.equal(plan.toSeed.length, 11)
  assert.ok(!plan.toSeed.some((item) => item.identity.guid === 'doi:0'))
})

test('selectSocialPostsToNotify tags new posts and reminders', () => {
  const selected = selectSocialPostsToNotify([
    pendingRecord({ _id: 'new' }),
    pendingRecord({ _id: 'queued', status: 'queued' }),
  ], { now: NOW })
  assert.deepEqual(selected.map((post) => [post._id, post.notificationKind]), [['new', 'new']])
})

test('selectSocialPostsToNotify waits 20 hours before a reminder-only email', () => {
  const recent = new Date(NOW.getTime() - 19 * HOUR_MS).toISOString()
  const old = new Date(NOW.getTime() - 20 * HOUR_MS).toISOString()
  assert.deepEqual(selectSocialPostsToNotify([pendingRecord({ lastNotifiedAt: recent })], { now: NOW }), [])

  const due = selectSocialPostsToNotify([
    pendingRecord({ _id: 'old', lastNotifiedAt: old }),
    pendingRecord({ _id: 'recent', lastNotifiedAt: recent }),
  ], { now: NOW })
  assert.deepEqual(due.map((post) => [post._id, post.notificationKind]), [['old', 'reminder'], ['recent', 'reminder']])

  const withNew = selectSocialPostsToNotify([
    pendingRecord({ _id: 'recent', lastNotifiedAt: recent }),
    pendingRecord({ _id: 'new' }),
  ], { now: NOW })
  assert.deepEqual(withNew.map((post) => [post._id, post.notificationKind]), [['recent', 'reminder'], ['new', 'new']])
})

test('approval email escapes HTML, shows the post text and portal, and has no decision links', () => {
  const posts = selectSocialPostsToNotify([
    pendingRecord({ title: '<script>alert(1)</script> & kidneys', text: 'Post <b>text</b> & more' }),
    pendingRecord({ _id: 'two', lastNotifiedAt: new Date(NOW.getTime() - 30 * HOUR_MS).toISOString() }),
  ], { now: NOW })
  const email = buildSocialPostApprovalEmail({ posts, portalUrl: 'https://example.test/admin/social' })
  assert.equal(email.subject, '2 social media posts waiting for approval')
  assert.equal(email.newCount, 1)
  assert.equal(email.waitingCount, 1)
  assert.ok(!email.html.includes('<script>'))
  assert.ok(email.html.includes('&lt;script&gt;'))
  assert.ok(email.html.includes('Post &lt;b&gt;text&lt;/b&gt; &amp; more'))
  assert.ok(email.text.includes('Post <b>text</b> & more'))
  assert.ok(email.html.includes('https://example.test/admin/social'))
  assert.ok(email.text.includes('https://example.test/admin/social'))
  assert.ok(email.text.includes('This email intentionally contains no decision links.'))
  assert.ok(email.text.includes('[NEW]'))
  assert.ok(email.text.includes('[Still waiting]'))
  assert.ok(email.text.includes('Jane Smith'))
  assert.ok(email.text.includes('September 20, 2026'))
  assert.ok(!email.html.includes('/api/'))
  assert.ok(!email.text.includes('/api/'))

  const single = buildSocialPostApprovalEmail({ posts: posts.slice(0, 1), portalUrl: 'https://example.test/admin/social' })
  assert.equal(single.subject, '1 social media post waiting for approval')
})

test('notification idempotency key is stable for the same posts on the same UTC day', () => {
  const key = buildSocialPostNotificationIdempotencyKey([{ _id: 'b' }, { _id: 'a' }], NOW)
  assert.equal(key, buildSocialPostNotificationIdempotencyKey([{ _id: 'a' }, { _id: 'b' }], new Date('2026-09-25T23:00:00Z')))
  assert.notEqual(key, buildSocialPostNotificationIdempotencyKey([{ _id: 'a' }, { _id: 'b' }], new Date('2026-09-26T01:00:00Z')))
  assert.match(key, /^social-post-approval:[0-9a-f]{40}$/)
})

test('dispatch sends one email and marks posts notified only after a confirmed send', async () => {
  let sent
  let marked
  const result = await dispatchSocialPostNotifications({
    records: [pendingRecord()],
    recipients: ['Admin@Example.test', 'admin@example.test'],
    portalUrl: 'https://example.test/admin/social',
    send: async (email) => { sent = email; return { id: 'email-1' } },
    markNotified: async (posts) => { marked = posts },
    now: NOW,
  })
  assert.equal(result.sent, true)
  assert.deepEqual(sent.to, ['admin@example.test'])
  assert.match(sent.idempotencyKey, /^social-post-approval:/)
  assert.deepEqual(marked.map((post) => post._id), ['socialPost-x-1'])
})

test('dispatch does not mark posts notified when the email provider skips the send', async () => {
  let marked = false
  await assert.rejects(
    dispatchSocialPostNotifications({
      records: [pendingRecord()],
      recipients: ['admin@example.test'],
      portalUrl: 'https://example.test/admin/social',
      send: async () => ({ skipped: true, reason: 'missing_provider' }),
      markNotified: async () => { marked = true },
      now: NOW,
    }),
    /missing_provider/
  )
  assert.equal(marked, false)
})

test('dispatch throws when no approvers are configured', async () => {
  await assert.rejects(
    dispatchSocialPostNotifications({
      records: [pendingRecord()],
      recipients: [],
      portalUrl: 'https://example.test/admin/social',
      send: async () => ({}),
      markNotified: async () => {},
      now: NOW,
    }),
    /No social media post approvers/
  )
})

test('dispatch skips when nothing is due and dry runs send nothing', async () => {
  const skipped = await dispatchSocialPostNotifications({ records: [pendingRecord({ status: 'queued' })], now: NOW })
  assert.equal(skipped.skipped, true)
  let sent = false
  const dry = await dispatchSocialPostNotifications({
    records: [pendingRecord()],
    recipients: [],
    send: async () => { sent = true },
    markNotified: async () => {},
    dryRun: true,
    now: NOW,
  })
  assert.equal(dry.dryRun, true)
  assert.equal(dry.due, 1)
  assert.equal(sent, false)
})

test('Buffer client queues a post with the documented request shape', async () => {
  const { calls, fetchImpl } = fakeFetch([
    jsonResponse({ data: { createPost: { post: { id: 'post-9', dueAt: '2026-09-26T14:00:00Z' } } } }),
  ])
  const buffer = createBufferClient({ apiKey: API_KEY, fetchImpl })
  const result = await buffer.queuePost({ channelId: 'chan-x', text: 'Hello X' })
  assert.deepEqual(result, { id: 'post-9', dueAt: '2026-09-26T14:00:00Z' })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, 'https://api.buffer.com')
  assert.equal(calls[0].options.method, 'POST')
  assert.equal(calls[0].options.headers.Authorization, `Bearer ${API_KEY}`)
  assert.equal(calls[0].options.headers['Content-Type'], 'application/json')
  assert.match(calls[0].body.query, /mutation CreatePost\(\$input: CreatePostInput!\)/)
  assert.match(calls[0].body.query, /\.\.\. on PostActionSuccess \{ post \{ id dueAt \} \}/)
  assert.match(calls[0].body.query, /\.\.\. on MutationError \{ message \}/)
  assert.deepEqual(calls[0].body.variables, {
    input: { text: 'Hello X', channelId: 'chan-x', schedulingType: 'automatic', mode: 'addToQueue' },
  })
})

test('Buffer client lists channels across all organizations', async () => {
  const { calls, fetchImpl } = fakeFetch([
    jsonResponse({ data: { account: { organizations: [{ id: 'org-1', name: 'One' }, { id: 'org-2', name: 'Two' }] } } }),
    jsonResponse({ data: { channels: [{ id: 'c1', name: 'KCRU X', service: 'twitter' }] } }),
    jsonResponse({ data: { channels: [{ id: 'c2', name: 'KCRU LinkedIn', service: 'linkedin' }] } }),
  ])
  const channels = await createBufferClient({ apiKey: API_KEY, fetchImpl }).listChannels()
  assert.deepEqual(channels.map((channel) => channel.id), ['c1', 'c2'])
  assert.match(calls[0].body.query, /account \{ organizations \{ id name \} \}/)
  assert.deepEqual(calls[1].body.variables, { input: { organizationId: 'org-1' } })
  assert.deepEqual(calls[2].body.variables, { input: { organizationId: 'org-2' } })
})

async function queueError(response) {
  const { fetchImpl } = fakeFetch([response])
  const buffer = createBufferClient({ apiKey: API_KEY, fetchImpl })
  try {
    await buffer.queuePost({ channelId: 'chan-x', text: 'Hello' })
  } catch (error) {
    return error
  }
  throw new Error('expected queuePost to fail')
}

test('Buffer client treats MutationError, GraphQL errors and a missing id as definite', async () => {
  const mutation = await queueError(jsonResponse({ data: { createPost: { message: 'Queue limit reached' } } }))
  assert.equal(mutation.ambiguous, false)
  assert.match(mutation.message, /Queue limit reached/)

  const graphql = await queueError(jsonResponse({ errors: [{ message: 'Invalid channel' }] }))
  assert.equal(graphql.ambiguous, false)
  assert.match(graphql.message, /Invalid channel/)

  const missing = await queueError(jsonResponse({ data: { createPost: {} } }))
  assert.equal(missing.ambiguous, false)

  const unauthorized = await queueError(jsonResponse({ error: 'Unauthorized' }, { status: 401 }))
  assert.equal(unauthorized.ambiguous, false)
  assert.match(unauthorized.message, /401/)
})

test('Buffer client treats 429 as definite and reports Retry-After', async () => {
  const error = await queueError(jsonResponse({ errors: [{ message: 'Too many requests' }] }, {
    status: 429,
    headers: { 'Retry-After': '120' },
  }))
  assert.equal(error.ambiguous, false)
  assert.match(error.message, /429/)
  assert.match(error.message, /120 seconds/)
})

test('Buffer client treats 5xx, network failures, timeouts and unreadable bodies as ambiguous', async () => {
  const unavailable = await queueError(jsonResponse('Service unavailable', { status: 503 }))
  assert.equal(unavailable.ambiguous, true)

  const network = await queueError(new TypeError('fetch failed'))
  assert.equal(network.ambiguous, true)

  const unreadable = await queueError(jsonResponse('<html>not json</html>'))
  assert.equal(unreadable.ambiguous, true)

  const slowFetch = (url, options) => new Promise((resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(new Error('The operation was aborted')))
  })
  const buffer = createBufferClient({ apiKey: API_KEY, fetchImpl: slowFetch, timeoutMs: 10 })
  await assert.rejects(buffer.queuePost({ channelId: 'chan-x', text: 'Hello' }), (error) => {
    assert.equal(error.ambiguous, true)
    assert.match(error.message, /did not respond/)
    return true
  })
})

test('Buffer client never includes the API key in an error', async () => {
  const errors = [
    await queueError(new Error(`connect failed with Bearer ${API_KEY}`)),
    await queueError(jsonResponse({ errors: [{ message: `Bad token ${API_KEY}` }] })),
    await queueError(jsonResponse({ data: { createPost: { message: `Key ${API_KEY} is over its limit` } } })),
    await queueError(jsonResponse({ message: `Rejected ${API_KEY}` }, { status: 403 })),
  ]
  for (const error of errors) {
    assert.ok(!error.message.includes(API_KEY), error.message)
    assert.equal(typeof error.ambiguous, 'boolean')
  }
})

test('resolveXChannel picks the X channel or explains what is wrong', () => {
  const x = { id: 'x1', name: 'KCRU X', service: 'twitter' }
  const x2 = { id: 'x2', name: 'Lab X', service: 'twitter' }
  const linkedin = { id: 'li', name: 'KCRU LinkedIn', service: 'linkedin' }
  assert.equal(resolveXChannel([linkedin, x]), x)
  assert.throws(() => resolveXChannel([linkedin]), /No X channel is connected in Buffer/)
  assert.throws(() => resolveXChannel([x, x2]), (error) => {
    assert.match(error.message, /KCRU X, Lab X/)
    assert.match(error.message, /BUFFER_X_CHANNEL_ID/)
    return true
  })
  assert.equal(resolveXChannel([x, x2], 'x2'), x2)
  assert.throws(() => resolveXChannel([x, linkedin], 'li'), /BUFFER_X_CHANNEL_ID/)
  assert.throws(() => resolveXChannel([x], 'missing'), /BUFFER_X_CHANNEL_ID/)
})

function approve(store, buffer, overrides = {}) {
  return approveSocialPost({
    id: 'socialPost-x-1',
    approverEmail: 'Admin@Example.test',
    enabled: true,
    store,
    buffer,
    now: NOW,
    ...overrides,
  })
}

test('approval is refused while posting is switched off', async () => {
  const store = fakeStore(pendingRecord())
  const buffer = fakeBuffer()
  const result = await approve(store, buffer, { enabled: false })
  assert.equal(result.status, 409)
  assert.equal(store.calls.length, 0)
  assert.equal(buffer.calls.length, 0)
})

test('approval is refused for missing and non-pending posts', async () => {
  assert.equal((await approve(fakeStore(null), fakeBuffer())).status, 404)
  for (const status of ['seeded', 'sending', 'queued', 'skipped']) {
    const buffer = fakeBuffer()
    const result = await approve(fakeStore(pendingRecord({ status })), buffer)
    assert.equal(result.status, 409, status)
    assert.equal(buffer.calls.length, 0)
  }
})

test('approval rejects invalid text before locking the post', async () => {
  const store = fakeStore(pendingRecord())
  const result = await approve(store, fakeBuffer(), { text: 'a'.repeat(300) })
  assert.equal(result.status, 400)
  assert.ok(!store.calls.some((call) => call.name === 'markSending'))
  assert.equal((await approve(fakeStore(pendingRecord()), fakeBuffer(), { text: '  ' })).status, 400)
})

test('approval returns 409 when someone else already holds the post', async () => {
  const store = fakeStore(pendingRecord())
  store.markSending = async () => {
    const error = new Error('revision mismatch')
    error.conflict = true
    throw error
  }
  const buffer = fakeBuffer()
  const result = await approve(store, buffer)
  assert.equal(result.status, 409)
  assert.match(result.message, /already being processed/)
  assert.equal(buffer.calls.length, 0)
})

test('approval locks, queues in Buffer, then records the queued post', async () => {
  const store = fakeStore(pendingRecord())
  const buffer = fakeBuffer()
  const result = await approve(store, buffer, { text: '  Edited post text  ' })
  assert.equal(result.ok, true)
  assert.equal(result.status, 200)
  assert.deepEqual(store.calls.map((call) => call.name), ['get', 'markSending', 'markQueued'])
  const [, rev, sendingFields] = store.calls[1].args
  assert.equal(rev, 'rev-1')
  assert.deepEqual(sendingFields, { text: 'Edited post text', approvedBy: 'admin@example.test', approvedAt: NOW.toISOString() })
  assert.deepEqual(buffer.calls, ['listChannels', { queuePost: { channelId: 'chan-x', text: 'Edited post text' } }])
  assert.deepEqual(store.calls[2].args[1], {
    bufferPostId: 'buffer-post-1',
    bufferChannelId: 'chan-x',
    dueAt: '2026-09-26T14:00:00.000Z',
    queuedAt: NOW.toISOString(),
    lastError: null,
  })
  assert.equal(store.current.status, 'queued')
})

test('approval uses the stored text when none is supplied', async () => {
  const buffer = fakeBuffer()
  await approve(fakeStore(pendingRecord({ text: 'Stored text' })), buffer)
  assert.deepEqual(buffer.calls[1], { queuePost: { channelId: 'chan-x', text: 'Stored text' } })
})

test('a definite Buffer rejection returns the post to pending with the error', async () => {
  const store = fakeStore(pendingRecord())
  const result = await approve(store, fakeBuffer({ queue: bufferError('Buffer did not accept the post: Queue limit reached.', false) }))
  assert.equal(result.ok, false)
  assert.equal(result.status, 502)
  assert.match(result.message, /Queue limit reached/)
  assert.deepEqual(store.calls.map((call) => call.name), ['get', 'markSending', 'returnToPending'])
  assert.equal(store.current.status, 'pending')
  assert.match(store.current.lastError, /Queue limit reached/)
})

test('an ambiguous Buffer result keeps the post in sending and is never retried', async () => {
  const store = fakeStore(pendingRecord())
  const result = await approve(store, fakeBuffer({ queue: bufferError('Buffer returned HTTP 503.', true) }))
  assert.equal(result.status, 502)
  assert.match(result.message, /Buffer result unknown; check the Buffer queue before retrying/)
  assert.deepEqual(store.calls.map((call) => call.name), ['get', 'markSending', 'markUnknown'])
  assert.equal(store.current.status, 'sending')
  assert.match(store.current.lastError, /503/)

  const retry = await approve(store, fakeBuffer())
  assert.equal(retry.status, 409)
})

test('an error without an ambiguity flag is treated as ambiguous', async () => {
  const store = fakeStore(pendingRecord())
  await approve(store, fakeBuffer({ queue: new TypeError('boom') }))
  assert.equal(store.current.status, 'sending')
})

test('a channel lookup failure returns the post to pending without queueing', async () => {
  const store = fakeStore(pendingRecord())
  const buffer = fakeBuffer({ channels: [{ id: 'li', name: 'LinkedIn', service: 'linkedin' }] })
  const result = await approve(store, buffer)
  assert.equal(result.status, 502)
  assert.match(result.message, /No X channel is connected in Buffer/)
  assert.deepEqual(store.calls.map((call) => call.name), ['get', 'markSending', 'returnToPending'])
  assert.deepEqual(buffer.calls, ['listChannels'])
  assert.equal(store.current.status, 'pending')
})

test('a failed save after Buffer accepted the post keeps it in sending', async () => {
  const store = fakeStore(pendingRecord())
  store.markQueued = async () => { throw new Error('Sanity unavailable') }
  const result = await approve(store, fakeBuffer())
  assert.equal(result.ok, false)
  assert.match(result.message, /Do not approve it again/)
  assert.equal(store.current.status, 'sending')
})

test('skip moves pending posts to skipped and refuses other states', async () => {
  const store = fakeStore(pendingRecord())
  const result = await skipSocialPost({ id: 'socialPost-x-1', actorEmail: 'Admin@Example.test', store, now: NOW })
  assert.equal(result.ok, true)
  assert.deepEqual(store.calls[1].args, ['socialPost-x-1', 'rev-1', { skippedBy: 'admin@example.test', skippedAt: NOW.toISOString() }])
  assert.equal(store.current.status, 'skipped')

  for (const status of ['seeded', 'sending', 'queued', 'skipped']) {
    const refused = await skipSocialPost({ id: 'socialPost-x-1', store: fakeStore(pendingRecord({ status })), now: NOW })
    assert.equal(refused.status, 409, status)
  }
  assert.equal((await skipSocialPost({ id: 'missing', store: fakeStore(null) })).status, 404)
})

test('restore moves skipped posts back to pending and refuses other states', async () => {
  const store = fakeStore(pendingRecord({ status: 'skipped', skippedBy: 'admin@example.test' }))
  const result = await restoreSocialPost({ id: 'socialPost-x-1', actorEmail: 'admin@example.test', store })
  assert.equal(result.ok, true)
  assert.deepEqual(store.calls[1].args, ['socialPost-x-1', 'rev-1'])
  assert.equal(store.current.status, 'pending')

  for (const status of ['seeded', 'pending', 'sending', 'queued']) {
    const refused = await restoreSocialPost({ id: 'socialPost-x-1', store: fakeStore(pendingRecord({ status })) })
    assert.equal(refused.status, 409, status)
  }
})

test('skip and restore report a revision conflict as 409', async () => {
  const conflict = async () => {
    const error = new Error('revision mismatch')
    error.conflict = true
    throw error
  }
  const skipStore = fakeStore(pendingRecord())
  skipStore.skip = conflict
  assert.equal((await skipSocialPost({ id: 'socialPost-x-1', store: skipStore })).status, 409)

  const restoreStore = fakeStore(pendingRecord({ status: 'skipped' }))
  restoreStore.restore = conflict
  assert.equal((await restoreSocialPost({ id: 'socialPost-x-1', store: restoreStore })).status, 409)
})
