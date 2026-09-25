import assert from 'node:assert/strict'
import test from 'node:test'

import {
  BUFFER_UNKNOWN_MESSAGE,
  DEFAULT_X_INTRO,
  NOT_IN_BUFFER_MESSAGE,
  X_MAX_WEIGHTED_LENGTH,
  buildSocialPostNotificationEmail,
  buildXPostText,
  canManageSocialPosts,
  createBufferClient,
  discardSocialPostDraft,
  dismissSocialPost,
  draftSocialPost,
  groupSocialPostsForPortal,
  normalizeSocialPostStatus,
  planSocialPostSync,
  queueSocialPost,
  refreshQueuedSocialPosts,
  resolveXChannel,
  restoreSocialPost,
  saveSocialPostDraft,
  selectSocialPostsToNotify,
  undoSocialPost,
  validateXPostText,
  xWeightedLength,
} from '../lib/socialPosting.js'
import {
  buildSocialPostNotificationIdempotencyKey,
  buildSocialPostRecord,
  dispatchSocialPostNotifications,
  socialPostDocumentId,
} from '../lib/socialPostingServer.js'
import { syncSocialPosts } from '../lib/socialPostingStore.js'
import { planSocialPostMigration } from '../scripts/migrate-social-posts-to-available.js'

const NOW = new Date('2026-09-25T12:00:00Z')
const LINK = 'https://doi.org/10.1000/xyz'
const API_KEY = 'buffer-secret-key-123'
const DRAFT_TEXT = `A new study from our team looks at kidney function after surgery. ${LINK}`
const LAY_SUMMARY = 'This study followed people after surgery to see how their kidney function changed.'
const STATUSES = ['available', 'draft', 'sending', 'queued', 'removing', 'published', 'dismissed', 'seeded']

function feedItem(guid, date, overrides = {}) {
  return {
    publication: { title: `Paper ${guid}`, journal: 'Kidney Journal', laySummary: `Summary of ${guid}`, ...overrides },
    date: new Date(date),
    identity: { guid, link: `https://doi.org/${guid.replace(/^doi:/, '')}` },
  }
}

function record(overrides = {}) {
  return {
    _id: 'socialPost-x-1',
    _rev: 'rev-1',
    status: 'available',
    title: 'A kidney paper',
    link: LINK,
    journal: 'Kidney Journal',
    laySummary: LAY_SUMMARY,
    teamMembers: ['Jane Smith'],
    publishedAt: '2026-09-20T00:00:00.000Z',
    createdAt: '2026-09-21T11:00:00.000Z',
    ...overrides,
  }
}

function draftRecord(overrides = {}) {
  return record({
    status: 'draft',
    text: DRAFT_TEXT,
    proposedText: DRAFT_TEXT,
    generatedBy: 'llm:test-model',
    draftedBy: 'admin@example.test',
    draftedAt: '2026-09-22T10:00:00.000Z',
    ...overrides,
  })
}

function queuedRecord(overrides = {}) {
  return draftRecord({
    status: 'queued',
    bufferPostId: 'buffer-post-1',
    bufferChannelId: 'chan-x',
    dueAt: '2026-09-26T14:00:00.000Z',
    queuedAt: '2026-09-24T10:00:00.000Z',
    queuedBy: 'admin@example.test',
    ...overrides,
  })
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

function conflictError() {
  const error = new Error('Document has unexpected revision ID')
  error.conflict = true
  return error
}

function applyFields(document, fields) {
  const next = { ...document }
  for (const [key, value] of Object.entries(fields)) {
    if (value === null || value === undefined) delete next[key]
    else next[key] = value
  }
  return next
}

// Mirrors createSanitySocialPostStore: transition() is revision-guarded,
// update() is the unguarded follow-up write, and null unsets a field.
function fakeStore(initial) {
  const calls = []
  let document = initial ? { ...initial } : null
  let revision = 1
  return {
    calls,
    get current() { return document },
    names() { return calls.map((call) => call.name) },
    async get(id) {
      calls.push({ name: 'get', args: [id] })
      return document && document._id === id ? { ...document } : null
    },
    async transition(id, rev, fields) {
      calls.push({ name: 'transition', args: [id, rev, fields] })
      if (!document || rev !== document._rev) throw conflictError()
      document = { ...applyFields(document, fields), _rev: `rev-${++revision}` }
    },
    async update(id, fields) {
      calls.push({ name: 'update', args: [id, fields] })
      document = { ...applyFields(document, fields), _rev: `rev-${++revision}` }
    },
  }
}

function outcome(value, fallback) {
  if (value instanceof Error) throw value
  return value === undefined ? fallback : value
}

function fakeBuffer({ channels, queue, post, remove } = {}) {
  const calls = []
  return {
    calls,
    async listChannels() {
      calls.push('listChannels')
      return outcome(channels, [{ id: 'chan-x', name: 'KCRU on X', service: 'twitter' }])
    },
    async queuePost(input) {
      calls.push({ queuePost: input })
      return outcome(queue, { id: 'buffer-post-1', dueAt: '2026-09-26T14:00:00.000Z' })
    },
    async getPost(id) {
      calls.push({ getPost: id })
      return outcome(typeof post === 'function' ? post(id) : post, { id, status: 'scheduled', dueAt: '2026-09-26T14:00:00.000Z' })
    },
    async deletePost(id) {
      calls.push({ deletePost: id })
      return outcome(remove, { id })
    },
  }
}

function bufferError(message, ambiguous, extra = {}) {
  return Object.assign(new Error(message), { ambiguous }, extra)
}

// --- Access, X length and the template -------------------------------------

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

// --- Records, sync and statuses ---------------------------------------------

test('socialPostDocumentId is deterministic and Sanity-safe', () => {
  const id = socialPostDocumentId('x', 'doi:10.1000/abc.def(1)')
  assert.equal(id, socialPostDocumentId('x', 'doi:10.1000/abc.def(1)'))
  assert.notEqual(id, socialPostDocumentId('x', 'doi:10.1000/other'))
  assert.match(id, /^[A-Za-z0-9_-]+$/)
  assert.match(id, /^socialPost-x-[0-9a-f]{40}$/)
})

test('buildSocialPostRecord creates an available record with the lay summary and no post text', () => {
  const item = feedItem('doi:10.1000/xyz', '2026-09-20T00:00:00Z', { title: 'A kidney paper', laySummary: `  ${LAY_SUMMARY}\n` })
  const built = buildSocialPostRecord({ item, network: 'x', teamMembers: ['Jane Smith', 'Jane Smith'], now: NOW })
  assert.equal(built._id, socialPostDocumentId('x', 'doi:10.1000/xyz'))
  assert.equal(built._type, 'socialPost')
  assert.equal(built.guid, 'doi:10.1000/xyz')
  assert.equal(built.link, LINK)
  assert.equal(built.journal, 'Kidney Journal')
  assert.equal(built.laySummary, LAY_SUMMARY)
  assert.equal(built.publishedAt, '2026-09-20T00:00:00.000Z')
  assert.deepEqual(built.teamMembers, ['Jane Smith'])
  assert.equal(built.status, 'available')
  assert.equal(built.createdAt, NOW.toISOString())
  assert.equal('text' in built, false)
  assert.equal('proposedText' in built, false)
})

test('planSocialPostSync offers every unrecorded item oldest first, with no size limit', () => {
  const items = [feedItem('doi:b', '2026-09-20'), feedItem('doi:a', '2026-09-10')]
  assert.deepEqual(planSocialPostSync({ items, records: [] }).toCreate.map((item) => item.identity.guid), ['doi:a', 'doi:b'])

  const many = Array.from({ length: 40 }, (_, index) => feedItem(`doi:${index}`, '2026-09-20'))
  const plan = planSocialPostSync({ items: many, records: [{ guid: 'doi:old', status: 'queued' }] })
  assert.equal(plan.mode, 'create')
  assert.equal(plan.toCreate.length, 40)
})

test('planSocialPostSync never recreates a recorded paper, whatever its status', () => {
  const statuses = [...STATUSES, 'pending', 'skipped']
  const items = [
    feedItem('doi:new-late', '2026-09-22'),
    feedItem('doi:new-b', '2026-09-15'),
    feedItem('doi:new-a', '2026-09-15'),
    ...statuses.map((status) => feedItem(`doi:${status}`, '2026-09-01')),
  ]
  const records = statuses.map((status) => ({ guid: `doi:${status}`, status }))
  const plan = planSocialPostSync({ items, records })
  assert.deepEqual(plan.toCreate.map((item) => item.identity.guid), ['doi:new-a', 'doi:new-b', 'doi:new-late'])
})

test('planSocialPostSync seed option marks unrecorded items as seeded', () => {
  const items = Array.from({ length: 12 }, (_, index) => feedItem(`doi:${index}`, '2026-09-20'))
  const plan = planSocialPostSync({ items, records: [{ guid: 'doi:0', status: 'queued' }], seed: true })
  assert.equal(plan.mode, 'seed')
  assert.equal(plan.toSeed.length, 11)
  assert.ok(!plan.toSeed.some((item) => item.identity.guid === 'doi:0'))
})

function cachePublication(doi, overrides = {}) {
  return {
    title: `Paper ${doi}`,
    journal: 'Kidney Journal',
    laySummary: `Lay summary of ${doi}.`,
    doi,
    publicationKey: `doi:${doi}`,
    publishedAt: '2026-09-20T00:00:00.000Z',
    ...overrides,
  }
}

function fakeSanity({ records = [], researchers = [] } = {}) {
  const created = []
  const client = {
    async fetch(query) {
      if (query.includes('"researcher"')) return researchers
      return records
    },
  }
  const writeClient = {
    transaction() {
      const transaction = {
        createIfNotExists(document) {
          created.push(document)
          return transaction
        },
        async commit() {},
      }
      return transaction
    },
  }
  return { client, writeClient, created }
}

test('syncSocialPosts offers new feed papers as available records with their lay summary', async () => {
  const { client, writeClient, created } = fakeSanity({
    records: [{ _id: 'existing', guid: 'doi:10.1000/old', status: 'queued' }],
    researchers: [{ _id: 'researcher-1', name: 'Jane Smith' }],
  })
  const cache = {
    publications: [cachePublication('10.1000/new'), cachePublication('10.1000/old'), cachePublication('10.1000/nosummary', { laySummary: '' })],
    provenance: { 'doi:10.1000/new': ['researcher-1'] },
  }
  const result = await syncSocialPosts({ client, writeClient, now: NOW, loadCache: async () => cache })
  assert.equal(result.mode, 'create')
  assert.equal(result.created, 1)
  assert.equal(created.length, 1)
  assert.equal(created[0].guid, 'doi:10.1000/new')
  assert.equal(created[0].status, 'available')
  assert.equal(created[0].laySummary, 'Lay summary of 10.1000/new.')
  assert.deepEqual(created[0].teamMembers, ['Jane Smith'])
  assert.equal('text' in created[0], false)
  assert.equal(result.records.length, 2)
})

test('syncSocialPosts seed marks new papers seeded, and dry runs write nothing', async () => {
  const cache = { publications: [cachePublication('10.1000/new')], provenance: {} }
  const seeded = fakeSanity({ records: [{ guid: 'doi:10.1000/old' }] })
  const result = await syncSocialPosts({ ...seeded, seed: true, now: NOW, loadCache: async () => cache })
  assert.equal(result.seeded, 1)
  assert.equal(seeded.created[0].status, 'seeded')

  const dry = fakeSanity()
  const preview = await syncSocialPosts({ ...dry, dryRun: true, now: NOW, loadCache: async () => cache })
  assert.equal(preview.created, 1)
  assert.equal(dry.created.length, 0)
  assert.equal(preview.records[0].status, 'available')
})

test('syncSocialPosts throws when the publication cache cannot be read', async () => {
  await assert.rejects(
    syncSocialPosts({ ...fakeSanity(), now: NOW, loadCache: async () => null }),
    /publication cache could not be read/
  )
})

test('legacy pending and skipped statuses read as available and dismissed', () => {
  assert.equal(normalizeSocialPostStatus('pending'), 'available')
  assert.equal(normalizeSocialPostStatus('skipped'), 'dismissed')
  for (const status of STATUSES) assert.equal(normalizeSocialPostStatus(status), status)
})

test('groupSocialPostsForPortal sorts each section and limits the history sections', () => {
  const records = [
    record({ _id: 'a-old', publishedAt: '2026-09-01T00:00:00.000Z' }),
    record({ _id: 'a-new', status: 'pending', publishedAt: '2026-09-20T00:00:00.000Z' }),
    draftRecord({ _id: 'd-1' }),
    queuedRecord({ _id: 'q-late', dueAt: '2026-09-30T14:00:00.000Z' }),
    queuedRecord({ _id: 'q-none', dueAt: undefined }),
    queuedRecord({ _id: 'q-soon', dueAt: '2026-09-26T14:00:00.000Z' }),
    record({ _id: 'sending', status: 'sending' }),
    record({ _id: 'removing', status: 'removing' }),
    record({ _id: 'seeded', status: 'seeded' }),
    record({ _id: 'legacy-skip', status: 'skipped', skippedBy: 'old@example.test', skippedAt: '2026-09-02T00:00:00.000Z' }),
    ...Array.from({ length: 35 }, (_, index) => record({
      _id: `p-${index}`,
      status: 'published',
      sentAt: new Date(NOW.getTime() - index * 3600000).toISOString(),
    })),
  ]
  const groups = groupSocialPostsForPortal(records)
  assert.deepEqual(groups.available.map((post) => post._id), ['a-new', 'a-old'])
  assert.equal(groups.available[0].status, 'available')
  assert.deepEqual(groups.drafts.map((post) => post._id), ['d-1'])
  assert.deepEqual(groups.queued.map((post) => post._id), ['q-soon', 'q-late', 'q-none'])
  assert.deepEqual(groups.needsChecking.map((post) => post._id).sort(), ['removing', 'sending'])
  assert.equal(groups.published.length, 30)
  assert.equal(groups.published[0]._id, 'p-0')
  assert.deepEqual(groups.dismissed.map((post) => [post._id, post.status, post.dismissedBy]), [['legacy-skip', 'dismissed', 'old@example.test']])
  assert.ok(!Object.values(groups).flat().some((post) => post._id === 'seeded'))
})

// --- Email ------------------------------------------------------------------

test('selectSocialPostsToNotify picks only available papers that were never in an email', () => {
  const selected = selectSocialPostsToNotify([
    record({ _id: 'new', publishedAt: '2026-09-10T00:00:00.000Z' }),
    record({ _id: 'legacy-new', status: 'pending', publishedAt: '2026-09-15T00:00:00.000Z' }),
    record({ _id: 'already-emailed', lastNotifiedAt: '2026-09-01T11:00:00.000Z' }),
    draftRecord({ _id: 'draft' }),
    queuedRecord({ _id: 'queued' }),
    record({ _id: 'dismissed', status: 'dismissed' }),
    record({ _id: 'seeded', status: 'seeded' }),
  ])
  assert.deepEqual(selected.map((post) => post._id), ['legacy-new', 'new'])
})

test('the email lists each paper with its lay summary, escapes HTML and has no decision links', () => {
  const posts = [
    record({ title: '<script>alert(1)</script> & kidneys', laySummary: 'Summary <b>bold</b> & more', journal: 'J <Kidney>' }),
    record({ _id: 'two', title: 'Second paper', journal: undefined, laySummary: undefined, teamMembers: [] }),
  ]
  const email = buildSocialPostNotificationEmail({ posts, portalUrl: 'https://example.test/admin/social' })
  assert.equal(email.subject, '2 new publications you could post about')
  assert.ok(!email.html.includes('<script>'))
  assert.ok(email.html.includes('&lt;script&gt;alert(1)&lt;/script&gt; &amp; kidneys'))
  assert.ok(email.html.includes('Summary &lt;b&gt;bold&lt;/b&gt; &amp; more'))
  assert.ok(email.html.includes('J &lt;Kidney&gt;'))
  assert.ok(email.text.includes('Summary <b>bold</b> & more'))
  assert.ok(email.text.includes('Journal: Not recorded'))
  assert.ok(email.text.includes('Lay summary: Not available'))
  assert.ok(email.text.includes('Jane Smith'))
  assert.ok(email.text.includes('September 20, 2026'))
  assert.ok(email.text.includes(`Paper: ${LINK}`))
  assert.ok(email.html.includes(`<a href="${LINK}">`))
  assert.ok(email.text.includes('Open the social media portal: https://example.test/admin/social'))
  assert.ok(email.html.includes('https://example.test/admin/social'))
  assert.ok(email.text.includes('Create, edit and queue posts only in the portal. This email intentionally contains no decision links.'))
  for (const body of [email.text, email.html]) {
    assert.ok(!body.includes('/api/'))
    assert.ok(!/approve|action=|token=/i.test(body))
  }

  const single = buildSocialPostNotificationEmail({ posts: posts.slice(0, 1), portalUrl: 'https://example.test/admin/social' })
  assert.equal(single.subject, '1 new publication you could post about')
})

test('notification idempotency key is stable for the same posts on the same UTC day', () => {
  const key = buildSocialPostNotificationIdempotencyKey([{ _id: 'b' }, { _id: 'a' }], NOW)
  assert.equal(key, buildSocialPostNotificationIdempotencyKey([{ _id: 'a' }, { _id: 'b' }], new Date('2026-09-25T23:00:00Z')))
  assert.notEqual(key, buildSocialPostNotificationIdempotencyKey([{ _id: 'a' }, { _id: 'b' }], new Date('2026-09-26T01:00:00Z')))
  assert.match(key, /^social-post-approval:[0-9a-f]{40}$/)
})

test('dispatch sends one email about new papers and marks them only after a confirmed send', async () => {
  let sent
  let marked
  const result = await dispatchSocialPostNotifications({
    records: [record(), record({ _id: 'emailed', lastNotifiedAt: '2026-09-24T11:00:00.000Z' })],
    recipients: ['Admin@Example.test', 'admin@example.test'],
    portalUrl: 'https://example.test/admin/social',
    send: async (email) => { sent = email; return { id: 'email-1' } },
    markNotified: async (posts) => { marked = posts },
    now: NOW,
  })
  assert.equal(result.sent, true)
  assert.equal(result.due, 1)
  assert.deepEqual(sent.to, ['admin@example.test'])
  assert.equal(sent.subject, '1 new publication you could post about')
  assert.match(sent.idempotencyKey, /^social-post-approval:/)
  assert.deepEqual(marked.map((post) => post._id), ['socialPost-x-1'])
})

test('dispatch does not mark papers notified when the email provider skips the send', async () => {
  let marked = false
  await assert.rejects(
    dispatchSocialPostNotifications({
      records: [record()],
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
      records: [record()],
      recipients: [],
      portalUrl: 'https://example.test/admin/social',
      send: async () => ({}),
      markNotified: async () => {},
      now: NOW,
    }),
    /No social media post approvers/
  )
})

test('dispatch skips the email when nothing is new, and dry runs send nothing', async () => {
  let sent = false
  const send = async () => { sent = true }
  const skipped = await dispatchSocialPostNotifications({
    records: [draftRecord(), queuedRecord(), record({ lastNotifiedAt: '2026-09-24T11:00:00.000Z' })],
    recipients: ['admin@example.test'],
    send,
    markNotified: async () => {},
    now: NOW,
  })
  assert.equal(skipped.skipped, true)
  assert.equal(sent, false)

  const dry = await dispatchSocialPostNotifications({
    records: [record()],
    recipients: [],
    send,
    markNotified: async () => {},
    dryRun: true,
    now: NOW,
  })
  assert.equal(dry.dryRun, true)
  assert.equal(dry.due, 1)
  assert.equal(sent, false)
})

// --- Buffer client ----------------------------------------------------------

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

async function clientError(method, response, ...args) {
  const { fetchImpl } = fakeFetch([response])
  const buffer = createBufferClient({ apiKey: API_KEY, fetchImpl })
  try {
    await buffer[method](...(args.length ? args : [{ channelId: 'chan-x', text: 'Hello' }]))
  } catch (error) {
    return error
  }
  throw new Error(`expected ${method} to fail`)
}

const queueError = (response) => clientError('queuePost', response)

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
    await clientError('deletePost', jsonResponse({ data: { deletePost: { message: `Key ${API_KEY} cannot delete` } } }), 'p1'),
  ]
  for (const error of errors) {
    assert.ok(!error.message.includes(API_KEY), error.message)
    assert.equal(typeof error.ambiguous, 'boolean')
  }
})

test('Buffer client reads a post with the documented request shape', async () => {
  const remote = { id: 'post-9', status: 'sent', dueAt: '2026-09-26T14:00:00Z', sentAt: '2026-09-26T14:00:05Z', externalLink: 'https://x.com/kcru/status/1', error: null }
  const { calls, fetchImpl } = fakeFetch([jsonResponse({ data: { post: remote } })])
  const result = await createBufferClient({ apiKey: API_KEY, fetchImpl }).getPost('post-9')
  assert.deepEqual(result, remote)
  assert.equal(
    calls[0].body.query,
    'query Post($input: PostInput!) { post(input: $input) { id status dueAt sentAt externalLink error { message } } }'
  )
  assert.deepEqual(calls[0].body.variables, { input: { id: 'post-9' } })
})

test('Buffer client marks a missing post as notFound and definite', async () => {
  const byCode = await clientError('getPost', jsonResponse({ errors: [{ message: 'Resource missing', extensions: { code: 'NOT_FOUND' } }] }), 'p1')
  assert.equal(byCode.notFound, true)
  assert.equal(byCode.ambiguous, false)

  const byMessage = await clientError('getPost', jsonResponse({ errors: [{ message: 'Post not found' }] }), 'p1')
  assert.equal(byMessage.notFound, true)
  assert.equal(byMessage.ambiguous, false)

  const nullPost = await clientError('getPost', jsonResponse({ data: { post: null } }), 'p1')
  assert.equal(nullPost.notFound, true)
  assert.equal(nullPost.ambiguous, false)

  const otherError = await clientError('getPost', jsonResponse({ errors: [{ message: 'Forbidden', extensions: { code: 'FORBIDDEN' } }] }), 'p1')
  assert.equal(Boolean(otherError.notFound), false)
  assert.equal(otherError.ambiguous, false)

  const outage = await clientError('getPost', jsonResponse('Bad gateway', { status: 502 }), 'p1')
  assert.equal(Boolean(outage.notFound), false)
  assert.equal(outage.ambiguous, true)
})

test('Buffer client deletes a post with the documented request shape', async () => {
  const { calls, fetchImpl } = fakeFetch([jsonResponse({ data: { deletePost: { id: 'post-9' } } })])
  const result = await createBufferClient({ apiKey: API_KEY, fetchImpl }).deletePost('post-9')
  assert.deepEqual(result, { id: 'post-9' })
  assert.equal(
    calls[0].body.query,
    'mutation DeletePost($input: DeletePostInput!) { deletePost(input: $input) { ... on DeletePostSuccess { id } ... on MutationError { message } } }'
  )
  assert.deepEqual(calls[0].body.variables, { input: { id: 'post-9' } })
})

test('Buffer client classifies delete failures', async () => {
  const mutation = await clientError('deletePost', jsonResponse({ data: { deletePost: { message: 'Post already sent' } } }), 'p1')
  assert.equal(mutation.ambiguous, false)
  assert.match(mutation.message, /Post already sent/)

  const unconfirmed = await clientError('deletePost', jsonResponse({ data: { deletePost: {} } }), 'p1')
  assert.equal(unconfirmed.ambiguous, false)

  const network = await clientError('deletePost', new TypeError('fetch failed'), 'p1')
  assert.equal(network.ambiguous, true)
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

// --- Draft, save, discard, dismiss, restore ---------------------------------

function fakeCompose(result = { text: DRAFT_TEXT, generatedBy: 'llm:test-model' }) {
  const calls = []
  const compose = async (post) => {
    calls.push(post)
    return result
  }
  return { calls, compose }
}

function draft(store, overrides = {}) {
  const { compose } = fakeCompose()
  return draftSocialPost({ id: 'socialPost-x-1', actorEmail: 'Admin@Example.test', enabled: true, store, compose, now: NOW, ...overrides })
}

test('Create post drafts an available paper and records who drafted it', async () => {
  const store = fakeStore(record())
  const { calls, compose } = fakeCompose()
  const result = await draft(store, { compose })
  assert.equal(result.ok, true)
  assert.equal(result.status, 200)
  assert.match(result.message, /Draft created/)
  assert.equal(calls[0].laySummary, LAY_SUMMARY)
  assert.deepEqual(store.names(), ['get', 'transition'])
  assert.equal(store.calls[1].args[1], 'rev-1')
  assert.equal(store.current.status, 'draft')
  assert.equal(store.current.text, DRAFT_TEXT)
  assert.equal(store.current.proposedText, DRAFT_TEXT)
  assert.equal(store.current.generatedBy, 'llm:test-model')
  assert.equal(store.current.draftedBy, 'admin@example.test')
  assert.equal(store.current.draftedAt, NOW.toISOString())
})

test('Create post works on a legacy pending record and says when the template was used', async () => {
  const store = fakeStore(record({ status: 'pending', text: 'Old suggested text', lastError: 'old failure' }))
  const { compose } = fakeCompose({ text: `${DEFAULT_X_INTRO} A kidney paper ${LINK}`, generatedBy: 'template' })
  const result = await draft(store, { compose })
  assert.equal(result.ok, true)
  assert.match(result.message, /standard template/)
  assert.equal(store.current.status, 'draft')
  assert.equal(store.current.generatedBy, 'template')
  assert.equal(store.current.lastError, undefined)
})

test('Create post and Regenerate are refused while offering is switched off, and for the wrong status', async () => {
  const off = fakeStore(record())
  const { calls, compose } = fakeCompose()
  assert.equal((await draft(off, { enabled: false, compose })).status, 409)
  assert.equal(off.calls.length, 0)
  assert.equal(calls.length, 0)

  assert.equal((await draft(fakeStore(null))).status, 404)
  for (const status of STATUSES.filter((value) => value !== 'available')) {
    const refused = await draft(fakeStore(record({ status })), { compose })
    assert.equal(refused.status, 409, status)
    assert.equal(refused.ok, false)
    assert.equal(refused.error, refused.message)
  }
  for (const status of STATUSES.filter((value) => value !== 'draft')) {
    assert.equal((await draft(fakeStore(record({ status })), { regenerate: true, compose })).status, 409, status)
  }
  assert.equal(calls.length, 0)
})

test('Regenerate replaces the text and the generated text of a draft', async () => {
  const store = fakeStore(draftRecord({ text: 'My edited text', proposedText: 'Old AI text' }))
  const { compose } = fakeCompose({ text: `Fresh AI text ${LINK}`, generatedBy: 'llm:test-model' })
  const result = await draft(store, { regenerate: true, compose })
  assert.equal(result.ok, true)
  assert.match(result.message, /New draft written/)
  assert.equal(store.current.text, `Fresh AI text ${LINK}`)
  assert.equal(store.current.proposedText, `Fresh AI text ${LINK}`)
})

test('a change made while the draft was being written is reported as a conflict', async () => {
  const store = fakeStore(record())
  const compose = async () => {
    store.current._rev = 'rev-changed-meanwhile'
    return { text: DRAFT_TEXT, generatedBy: 'template' }
  }
  const result = await draft(store, { compose })
  assert.equal(result.status, 409)
  assert.match(result.message, /already being changed by someone else. Reload/)
  assert.equal(store.current.status, 'available')
})

test('Save stores validated text on a draft only', async () => {
  const store = fakeStore(draftRecord())
  const result = await saveSocialPostDraft({ id: 'socialPost-x-1', text: `  Edited ${LINK}  `, store })
  assert.equal(result.ok, true)
  assert.deepEqual(store.calls[1].args, ['socialPost-x-1', 'rev-1', { text: `Edited ${LINK}` }])
  assert.equal(store.current.proposedText, DRAFT_TEXT)

  assert.equal((await saveSocialPostDraft({ id: 'socialPost-x-1', text: 'a'.repeat(300), store: fakeStore(draftRecord()) })).status, 400)
  assert.equal((await saveSocialPostDraft({ id: 'socialPost-x-1', text: '   ', store: fakeStore(draftRecord()) })).status, 400)
  for (const status of STATUSES.filter((value) => value !== 'draft')) {
    assert.equal((await saveSocialPostDraft({ id: 'socialPost-x-1', text: 'Hi', store: fakeStore(record({ status })) })).status, 409, status)
  }
})

test('Discard returns a draft to new publications without its text', async () => {
  const store = fakeStore(draftRecord({ lastError: 'Queue limit reached' }))
  const result = await discardSocialPostDraft({ id: 'socialPost-x-1', store })
  assert.equal(result.ok, true)
  assert.equal(store.current.status, 'available')
  for (const field of ['text', 'proposedText', 'generatedBy', 'draftedBy', 'draftedAt', 'lastError']) {
    assert.equal(field in store.current, false, field)
  }
  assert.equal(store.current.laySummary, LAY_SUMMARY)
  for (const status of STATUSES.filter((value) => value !== 'draft')) {
    assert.equal((await discardSocialPostDraft({ id: 'socialPost-x-1', store: fakeStore(record({ status })) })).status, 409, status)
  }
})

test('Not posting dismisses available papers and drafts, discarding draft text', async () => {
  const available = fakeStore(record())
  const result = await dismissSocialPost({ id: 'socialPost-x-1', actorEmail: 'Admin@Example.test', store: available, now: NOW })
  assert.equal(result.ok, true)
  assert.equal(available.current.status, 'dismissed')
  assert.equal(available.current.dismissedBy, 'admin@example.test')
  assert.equal(available.current.dismissedAt, NOW.toISOString())

  const drafted = fakeStore(draftRecord())
  const fromDraft = await dismissSocialPost({ id: 'socialPost-x-1', actorEmail: 'admin@example.test', store: drafted, now: NOW })
  assert.match(fromDraft.message, /Draft discarded/)
  assert.equal(drafted.current.status, 'dismissed')
  assert.equal('text' in drafted.current, false)
  assert.equal('proposedText' in drafted.current, false)

  assert.equal((await dismissSocialPost({ id: 'socialPost-x-1', store: fakeStore(record({ status: 'pending' })), now: NOW })).ok, true)
  for (const status of ['sending', 'queued', 'removing', 'published', 'dismissed', 'seeded']) {
    assert.equal((await dismissSocialPost({ id: 'socialPost-x-1', store: fakeStore(record({ status })), now: NOW })).status, 409, status)
  }
})

test('Restore returns dismissed and legacy skipped papers to new publications', async () => {
  const store = fakeStore(record({ status: 'dismissed', dismissedBy: 'admin@example.test', dismissedAt: NOW.toISOString() }))
  const result = await restoreSocialPost({ id: 'socialPost-x-1', store })
  assert.equal(result.ok, true)
  assert.equal(store.current.status, 'available')
  assert.equal('dismissedBy' in store.current, false)

  const legacy = fakeStore(record({ status: 'skipped', skippedBy: 'old@example.test', text: 'Old suggested text' }))
  await restoreSocialPost({ id: 'socialPost-x-1', store: legacy })
  assert.equal(legacy.current.status, 'available')
  assert.equal('skippedBy' in legacy.current, false)
  assert.equal('text' in legacy.current, false)

  for (const status of STATUSES.filter((value) => value !== 'dismissed')) {
    assert.equal((await restoreSocialPost({ id: 'socialPost-x-1', store: fakeStore(record({ status })) })).status, 409, status)
  }
})

test('save, discard, dismiss and restore report a revision conflict as 409', async () => {
  const conflicted = (initial) => {
    const store = fakeStore(initial)
    store.transition = async () => { throw conflictError() }
    return store
  }
  const results = [
    await saveSocialPostDraft({ id: 'socialPost-x-1', text: 'Hi', store: conflicted(draftRecord()) }),
    await discardSocialPostDraft({ id: 'socialPost-x-1', store: conflicted(draftRecord()) }),
    await dismissSocialPost({ id: 'socialPost-x-1', store: conflicted(record()) }),
    await restoreSocialPost({ id: 'socialPost-x-1', store: conflicted(record({ status: 'dismissed' })) }),
  ]
  for (const result of results) {
    assert.equal(result.status, 409)
    assert.match(result.message, /already being changed/)
  }
})

// --- Queue ------------------------------------------------------------------

function queue(store, buffer, overrides = {}) {
  return queueSocialPost({
    id: 'socialPost-x-1',
    actorEmail: 'Admin@Example.test',
    enabled: true,
    store,
    buffer,
    now: NOW,
    ...overrides,
  })
}

test('queueing is refused while offering is switched off and for anything but a draft', async () => {
  const off = fakeStore(draftRecord())
  const buffer = fakeBuffer()
  assert.equal((await queue(off, buffer, { enabled: false })).status, 409)
  assert.equal(off.calls.length, 0)
  assert.equal((await queue(fakeStore(null), buffer)).status, 404)
  for (const status of [...STATUSES.filter((value) => value !== 'draft'), 'pending', 'skipped']) {
    assert.equal((await queue(fakeStore(record({ status, text: DRAFT_TEXT })), buffer)).status, 409, status)
  }
  assert.equal(buffer.calls.length, 0)
})

test('queueing rejects invalid text before locking the post', async () => {
  const store = fakeStore(draftRecord())
  assert.equal((await queue(store, fakeBuffer(), { text: 'a'.repeat(300) })).status, 400)
  assert.ok(!store.calls.some((call) => call.name === 'transition'))
  assert.equal((await queue(fakeStore(draftRecord()), fakeBuffer(), { text: '  ' })).status, 400)
})

test('queueing returns 409 when someone else already holds the post', async () => {
  const store = fakeStore(draftRecord())
  store.transition = async () => { throw conflictError() }
  const buffer = fakeBuffer()
  const result = await queue(store, buffer)
  assert.equal(result.status, 409)
  assert.match(result.message, /already being changed/)
  assert.equal(buffer.calls.length, 0)
})

test('queueing locks the draft, queues it in Buffer and records the queued post', async () => {
  const store = fakeStore(draftRecord())
  const buffer = fakeBuffer()
  const result = await queue(store, buffer, { text: `  Edited post text ${LINK}  ` })
  assert.equal(result.ok, true)
  assert.match(result.message, /Queued in Buffer/)
  assert.deepEqual(store.names(), ['get', 'transition', 'update'])
  const [, rev, lockFields] = store.calls[1].args
  assert.equal(rev, 'rev-1')
  assert.deepEqual(lockFields, {
    status: 'sending',
    text: `Edited post text ${LINK}`,
    queuedBy: 'admin@example.test',
    lastError: null,
    lastErrorAt: null,
  })
  assert.deepEqual(buffer.calls, ['listChannels', { queuePost: { channelId: 'chan-x', text: `Edited post text ${LINK}` } }])
  assert.deepEqual(store.calls[2].args[1], {
    status: 'queued',
    bufferPostId: 'buffer-post-1',
    bufferChannelId: 'chan-x',
    dueAt: '2026-09-26T14:00:00.000Z',
    queuedAt: NOW.toISOString(),
  })
  assert.equal(store.current.status, 'queued')
  assert.equal(store.current.queuedBy, 'admin@example.test')
})

test('queueing uses the stored text when none is supplied', async () => {
  const buffer = fakeBuffer()
  await queue(fakeStore(draftRecord({ text: 'Stored text' })), buffer)
  assert.deepEqual(buffer.calls[1], { queuePost: { channelId: 'chan-x', text: 'Stored text' } })
})

test('a definite Buffer rejection returns the post to drafts with the error', async () => {
  const store = fakeStore(draftRecord())
  const result = await queue(store, fakeBuffer({ queue: bufferError('Buffer did not accept the post: Queue limit reached.', false) }))
  assert.equal(result.ok, false)
  assert.equal(result.status, 502)
  assert.match(result.message, /Queue limit reached/)
  assert.match(result.message, /back in your drafts/)
  assert.equal(result.error, result.message)
  assert.deepEqual(store.names(), ['get', 'transition', 'update'])
  assert.equal(store.current.status, 'draft')
  assert.equal('queuedBy' in store.current, false)
  assert.match(store.current.lastError, /Queue limit reached/)
})

test('an ambiguous Buffer result keeps the post in sending and is never retried', async () => {
  const store = fakeStore(draftRecord())
  const result = await queue(store, fakeBuffer({ queue: bufferError('Buffer returned HTTP 503.', true) }))
  assert.equal(result.status, 502)
  assert.ok(result.message.startsWith(BUFFER_UNKNOWN_MESSAGE))
  assert.equal(store.current.status, 'sending')
  assert.match(store.current.lastError, /503/)

  const retry = await queue(store, fakeBuffer())
  assert.equal(retry.status, 409)

  const untyped = fakeStore(draftRecord())
  await queue(untyped, fakeBuffer({ queue: new TypeError('boom') }))
  assert.equal(untyped.current.status, 'sending')
})

test('a channel lookup failure returns the post to drafts without queueing', async () => {
  const store = fakeStore(draftRecord())
  const buffer = fakeBuffer({ channels: [{ id: 'li', name: 'LinkedIn', service: 'linkedin' }] })
  const result = await queue(store, buffer)
  assert.equal(result.status, 502)
  assert.match(result.message, /No X channel is connected in Buffer/)
  assert.deepEqual(buffer.calls, ['listChannels'])
  assert.equal(store.current.status, 'draft')
})

test('a failed save after Buffer accepted the post keeps it in sending', async () => {
  const store = fakeStore(draftRecord())
  const update = store.update
  store.update = async (id, fields) => {
    if (fields.status === 'queued') throw new Error('Sanity unavailable')
    return update(id, fields)
  }
  const result = await queue(store, fakeBuffer())
  assert.equal(result.ok, false)
  assert.match(result.message, /Do not queue it again/)
  assert.equal(store.current.status, 'sending')
  assert.match(store.current.lastError, /buffer-post-1/)
})

// --- Undo -------------------------------------------------------------------

function undo(store, buffer) {
  return undoSocialPost({ id: 'socialPost-x-1', actorEmail: 'Admin@Example.test', store, buffer, now: NOW })
}

test('undo is refused for anything but a queued post, and without a Buffer post id', async () => {
  const buffer = fakeBuffer()
  assert.equal((await undo(fakeStore(null), buffer)).status, 404)
  for (const status of STATUSES.filter((value) => value !== 'queued')) {
    assert.equal((await undo(fakeStore(queuedRecord({ status })), buffer)).status, 409, status)
  }
  const noId = fakeStore(queuedRecord({ bufferPostId: undefined }))
  const result = await undo(noId, buffer)
  assert.equal(result.status, 409)
  assert.match(result.message, /no Buffer post id/)
  assert.equal(noId.current.status, 'queued')
  assert.equal(buffer.calls.length, 0)
})

test('undo returns 409 when someone else already holds the post', async () => {
  const store = fakeStore(queuedRecord())
  store.transition = async () => { throw conflictError() }
  const buffer = fakeBuffer()
  assert.equal((await undo(store, buffer)).status, 409)
  assert.equal(buffer.calls.length, 0)
})

test('undo removes a scheduled post from Buffer and returns it to drafts with its text', async () => {
  const store = fakeStore(queuedRecord())
  const buffer = fakeBuffer()
  const result = await undo(store, buffer)
  assert.equal(result.ok, true)
  assert.match(result.message, /Removed from the Buffer queue/)
  assert.deepEqual(buffer.calls, [{ getPost: 'buffer-post-1' }, { deletePost: 'buffer-post-1' }])
  assert.deepEqual(store.calls[1].args, ['socialPost-x-1', 'rev-1', { status: 'removing', lastError: null, lastErrorAt: null }])
  assert.equal(store.current.status, 'draft')
  assert.equal(store.current.text, DRAFT_TEXT)
  assert.equal(store.current.unqueuedBy, 'admin@example.test')
  assert.equal(store.current.unqueuedAt, NOW.toISOString())
  for (const field of ['bufferPostId', 'bufferChannelId', 'dueAt', 'queuedAt', 'queuedBy']) {
    assert.equal(field in store.current, false, field)
  }
})

test('undo deletes posts in every other Buffer status', async () => {
  for (const status of ['draft', 'needs_approval', 'error']) {
    const store = fakeStore(queuedRecord())
    const buffer = fakeBuffer({ post: { id: 'buffer-post-1', status } })
    await undo(store, buffer)
    assert.deepEqual(buffer.calls.at(-1), { deletePost: 'buffer-post-1' }, status)
    assert.equal(store.current.status, 'draft', status)
  }
})

test('undo of a post Buffer already sent marks it published and explains it cannot be undone', async () => {
  const store = fakeStore(queuedRecord())
  const buffer = fakeBuffer({ post: { id: 'buffer-post-1', status: 'sent', sentAt: '2026-09-26T14:00:05.000Z', externalLink: 'https://x.com/kcru/status/1' } })
  const result = await undo(store, buffer)
  assert.equal(result.ok, false)
  assert.equal(result.status, 409)
  assert.match(result.message, /Already published on X, so it can't be undone here\. Delete it on X if needed/)
  assert.match(result.message, /https:\/\/x\.com\/kcru\/status\/1/)
  assert.ok(!buffer.calls.some((call) => call.deletePost))
  assert.equal(store.current.status, 'published')
  assert.equal(store.current.sentAt, '2026-09-26T14:00:05.000Z')
  assert.equal(store.current.externalLink, 'https://x.com/kcru/status/1')
})

test('undo while Buffer is publishing leaves the post queued', async () => {
  const store = fakeStore(queuedRecord())
  const buffer = fakeBuffer({ post: { id: 'buffer-post-1', status: 'sending' } })
  const result = await undo(store, buffer)
  assert.equal(result.status, 409)
  assert.match(result.message, /Buffer is publishing it right now; check again in a minute/)
  assert.ok(!buffer.calls.some((call) => call.deletePost))
  assert.equal(store.current.status, 'queued')
  assert.equal(store.current.bufferPostId, 'buffer-post-1')
})

test('undo of a post Buffer no longer has returns it to drafts', async () => {
  const store = fakeStore(queuedRecord())
  const buffer = fakeBuffer({ post: bufferError('Buffer returned an error: Post not found.', false, { notFound: true }) })
  const result = await undo(store, buffer)
  assert.equal(result.ok, true)
  assert.match(result.message, /It was no longer in Buffer/)
  assert.ok(!buffer.calls.some((call) => call.deletePost))
  assert.equal(store.current.status, 'draft')
  assert.equal('bufferPostId' in store.current, false)
  assert.equal(store.current.text, DRAFT_TEXT)
})

test('a definite error from either Buffer call leaves the post queued with the error', async () => {
  const deleteRefused = fakeStore(queuedRecord())
  const result = await undo(deleteRefused, fakeBuffer({ remove: bufferError('Buffer did not delete the post: Not allowed.', false) }))
  assert.equal(result.status, 502)
  assert.match(result.message, /still queued/)
  assert.equal(deleteRefused.current.status, 'queued')
  assert.match(deleteRefused.current.lastError, /Not allowed/)
  assert.equal(deleteRefused.current.bufferPostId, 'buffer-post-1')

  const lookupRefused = fakeStore(queuedRecord())
  const buffer = fakeBuffer({ post: bufferError('Buffer rate limit reached (HTTP 429). Try again later.', false) })
  await undo(lookupRefused, buffer)
  assert.equal(lookupRefused.current.status, 'queued')
  assert.match(lookupRefused.current.lastError, /429/)
  assert.ok(!buffer.calls.some((call) => call.deletePost))
})

test('an ambiguous delete leaves the post in removing for someone to check', async () => {
  const store = fakeStore(queuedRecord())
  const result = await undo(store, fakeBuffer({ remove: bufferError('Buffer did not respond within 30 seconds.', true) }))
  assert.equal(result.status, 502)
  assert.ok(result.message.startsWith(BUFFER_UNKNOWN_MESSAGE))
  assert.equal(store.current.status, 'removing')
  assert.match(store.current.lastError, /did not respond/)
  assert.equal((await undo(store, fakeBuffer())).status, 409)
})

test('an unclear status lookup changes nothing in Buffer, so the post stays queued', async () => {
  const store = fakeStore(queuedRecord())
  const buffer = fakeBuffer({ post: bufferError('Buffer returned HTTP 503.', true) })
  const result = await undo(store, buffer)
  assert.equal(result.status, 502)
  assert.equal(store.current.status, 'queued')
  assert.match(store.current.lastError, /503/)
  assert.ok(!buffer.calls.some((call) => call.deletePost))
})

// --- Buffer status refresh --------------------------------------------------

function storeForRecords(records) {
  const calls = []
  return {
    calls,
    async transition(id, rev, fields) {
      calls.push({ id, rev, fields })
    },
  }
}

test('the status refresh marks sent posts published and records Buffer errors and missing posts', async () => {
  const records = [
    queuedRecord({ _id: 'sent', bufferPostId: 'b-sent', dueAt: '2026-09-24T14:00:00.000Z' }),
    queuedRecord({ _id: 'failed', bufferPostId: 'b-failed', dueAt: '2026-09-25T14:00:00.000Z' }),
    queuedRecord({ _id: 'missing', bufferPostId: 'b-missing', dueAt: '2026-09-26T14:00:00.000Z' }),
    queuedRecord({ _id: 'fine', bufferPostId: 'b-fine', dueAt: '2026-09-27T14:00:00.000Z' }),
    draftRecord({ _id: 'draft' }),
  ]
  const store = storeForRecords(records)
  const buffer = fakeBuffer({
    post: (id) => {
      if (id === 'b-sent') return { id, status: 'sent', sentAt: '2026-09-24T14:00:03.000Z', externalLink: 'https://x.com/kcru/status/9' }
      if (id === 'b-failed') return { id, status: 'error', error: { message: 'X rejected the post' } }
      if (id === 'b-missing') throw bufferError('Buffer returned an error: Post not found.', false, { notFound: true })
      return { id, status: 'scheduled', dueAt: '2026-09-27T14:00:00.000Z' }
    },
  })
  const result = await refreshQueuedSocialPosts({ records, store, buffer, now: NOW })
  assert.equal(result.warning, null)
  assert.equal(result.checked, 4)
  assert.deepEqual(buffer.calls.map((call) => call.getPost), ['b-sent', 'b-failed', 'b-missing', 'b-fine'])
  assert.deepEqual(store.calls.map((call) => [call.id, call.rev]), [['sent', 'rev-1'], ['failed', 'rev-1'], ['missing', 'rev-1']])
  assert.deepEqual(store.calls[0].fields, {
    status: 'published',
    sentAt: '2026-09-24T14:00:03.000Z',
    externalLink: 'https://x.com/kcru/status/9',
    lastError: null,
    lastErrorAt: null,
  })
  const byId = Object.fromEntries(result.records.map((post) => [post._id, post]))
  assert.equal(byId.sent.status, 'published')
  assert.equal(byId.failed.status, 'queued')
  assert.equal(byId.failed.lastError, 'X rejected the post')
  assert.equal(byId.missing.status, 'queued')
  assert.equal(byId.missing.lastError, NOT_IN_BUFFER_MESSAGE)
  assert.equal(byId.fine.lastError, undefined)
})

test('the status refresh checks at most ten queued posts and does not rewrite an unchanged error', async () => {
  const records = Array.from({ length: 12 }, (_, index) => queuedRecord({ _id: `q-${index}`, bufferPostId: `b-${index}`, lastError: NOT_IN_BUFFER_MESSAGE }))
  const store = storeForRecords(records)
  const buffer = fakeBuffer({ post: bufferError('Post not found', false, { notFound: true }) })
  const result = await refreshQueuedSocialPosts({ records, store, buffer, now: NOW })
  assert.equal(buffer.calls.length, 10)
  assert.equal(store.calls.length, 0)
  assert.equal(result.updated, 0)
})

test('the status refresh returns a warning instead of failing, and ignores conflicts', async () => {
  const records = [queuedRecord({ _id: 'a', bufferPostId: 'b-a' }), queuedRecord({ _id: 'b', bufferPostId: 'b-b' })]
  const outage = await refreshQueuedSocialPosts({
    records,
    store: storeForRecords(records),
    buffer: fakeBuffer({ post: bufferError('Buffer returned HTTP 503.', true) }),
    now: NOW,
  })
  assert.match(outage.warning, /Could not check Buffer/)
  assert.deepEqual(outage.records, records)

  const conflictStore = { async transition() { throw conflictError() } }
  const conflicted = await refreshQueuedSocialPosts({
    records,
    store: conflictStore,
    buffer: fakeBuffer({ post: { status: 'sent', externalLink: 'https://x.com/kcru/status/1' } }),
    now: NOW,
  })
  assert.equal(conflicted.warning, null)
  assert.equal(conflicted.updated, 0)
  assert.ok(conflicted.records.every((post) => post.status === 'queued'))
})

// --- Migration --------------------------------------------------------------

test('the migration turns pending into available with the lay summary and skipped into dismissed', () => {
  const { patches, counts } = planSocialPostMigration({
    records: [
      { _id: 'p1', _rev: 'r1', status: 'pending', guid: 'doi:10.1000/a' },
      { _id: 'p2', _rev: 'r2', status: 'pending', guid: 'doi:10.1000/gone' },
      { _id: 's1', _rev: 'r3', status: 'skipped', skippedBy: 'admin@example.test', skippedAt: '2026-09-20T00:00:00.000Z' },
      { _id: 'q1', _rev: 'r4', status: 'queued' },
    ],
    publications: [cachePublication('10.1000/a', { publishedAt: '2025-01-01T00:00:00.000Z' })],
  })
  assert.deepEqual(counts, {
    socialPosts: 4,
    pendingToAvailable: 2,
    laySummaryFilled: 1,
    laySummaryMissing: 1,
    skippedToDismissed: 1,
    unchanged: 1,
  })
  assert.deepEqual(patches[0], {
    id: 'p1',
    rev: 'r1',
    set: { status: 'available', laySummary: 'Lay summary of 10.1000/a.' },
    unset: ['text', 'proposedText', 'lastError', 'lastErrorAt', 'approvedBy', 'approvedAt'],
  })
  assert.deepEqual(patches[1].set, { status: 'available' })
  assert.deepEqual(patches[2], {
    id: 's1',
    rev: 'r3',
    set: { status: 'dismissed', dismissedBy: 'admin@example.test', dismissedAt: '2026-09-20T00:00:00.000Z' },
    unset: [],
  })
})
