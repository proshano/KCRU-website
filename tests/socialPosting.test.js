import assert from 'node:assert/strict'
import test from 'node:test'

import {
  BUFFER_UNKNOWN_MESSAGE,
  DEFAULT_TEAM_LABEL,
  NOT_IN_BUFFER_MESSAGE,
  SOCIAL_POST_PROMPT_MAX_LENGTH,
  SOCIAL_POST_SPOTLIGHT_WINDOW_DAYS,
  X_MAX_WEIGHTED_LENGTH,
  buildProfilePaperLink,
  buildSocialPostNotificationEmail,
  buildXPostText,
  canManageSocialPosts,
  chooseSpotlightResearcher,
  collectRecentSpotlights,
  computeHasOtherAuthors,
  createBufferClient,
  describeSpotlightReason,
  discardSocialPostDraft,
  dismissSocialPost,
  draftSocialPost,
  findProfileSlugs,
  formatNameList,
  groupSocialPostsForPortal,
  normalizeSocialPostStatus,
  planSocialPostSync,
  postLinksToProfile,
  queueSocialPost,
  refreshQueuedSocialPosts,
  resolveSocialPostSystemPrompt,
  resolveXChannel,
  restoreSocialPost,
  saveSocialPostDraft,
  selectSocialPostsToNotify,
  undoSocialPost,
  validateSocialPostPrompt,
  validateXPostText,
  xWeightedLength,
} from '../lib/socialPosting.js'
import {
  buildSocialPostNotificationIdempotencyKey,
  buildSocialPostRecord,
  buildSocialPostTeamFields,
  dispatchSocialPostNotifications,
  socialPostDocumentId,
} from '../lib/socialPostingServer.js'
import {
  fetchSocialPostPrompt,
  resetSocialPostPrompt,
  resolveSocialPostSpotlight,
  saveSocialPostPrompt,
  syncSocialPosts,
} from '../lib/socialPostingStore.js'
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

test('formatNameList dedupes and formats 0, 1, 2 and 3+ names', () => {
  assert.equal(formatNameList([]), '')
  assert.equal(formatNameList(['  Jane Smith  ', '']), 'Jane Smith')
  assert.equal(formatNameList(['Jane Smith', 'Jane Smith']), 'Jane Smith')
  assert.equal(formatNameList(['Jane Smith', 'Raj Patel']), 'Jane Smith and Raj Patel')
  assert.equal(formatNameList(['Jane Smith', 'Raj Patel', 'Amit Garg']), 'Jane Smith, Raj Patel and Amit Garg')
})

test('buildXPostText names every investigator using the team label', () => {
  const text = buildXPostText({ title: '  A  kidney\npaper ', link: LINK, teamMembers: ['Amit Garg', 'Arsh Jain'] })
  assert.equal(text, `New from ${DEFAULT_TEAM_LABEL} investigators Amit Garg and Arsh Jain: A kidney paper ${LINK}`)
})

test('buildXPostText falls back to the default team label and drops the byline when no names are listed', () => {
  assert.equal(
    buildXPostText({ title: 'A paper', link: LINK, teamLabel: '   ' }),
    `New from ${DEFAULT_TEAM_LABEL} investigators: A paper ${LINK}`
  )
  assert.equal(
    buildXPostText({ title: 'A paper', link: LINK, teamMembers: [], teamLabel: 'KCRU' }),
    `New from KCRU investigators: A paper ${LINK}`
  )
})

test('buildXPostText truncates a long title at a word boundary to fit X', () => {
  const title = Array.from({ length: 60 }, (_, index) => `word${index}`).join(' ').slice(0, 300)
  assert.equal(title.length, 300)
  const text = buildXPostText({ title, link: LINK, teamMembers: ['Amit Garg'] })
  assert.ok(xWeightedLength(text) <= X_MAX_WEIGHTED_LENGTH)
  assert.ok(text.startsWith(`New from ${DEFAULT_TEAM_LABEL} investigators Amit Garg: word0 word1`))
  assert.ok(text.endsWith(`… ${LINK}`))
  assert.match(text, /word\d+… https/)

  const withoutLink = buildXPostText({ title })
  assert.ok(xWeightedLength(withoutLink) <= X_MAX_WEIGHTED_LENGTH)
  assert.ok(withoutLink.endsWith('…'))
})

test('buildXPostText shortens a long byline to first three plus "and colleagues" to leave room for the title', () => {
  const teamMembers = [
    'Alexandra Montgomery-Whitfield',
    'Bartholomew Fitzgerald-Huntington',
    'Constance Featherstonehaugh-Radcliffe',
    'Demetrius Kowalczyk-Abernathy',
    'Evangeline Radcliffe-Sinclair',
    'Frederick Abernathy-Wentworth',
    'Gwendolyn Chesterfield',
  ]
  const title = 'A moderately long study title about kidney outcomes after transplantation surgery in adults'
  const text = buildXPostText({ title, link: LINK, teamMembers })
  assert.ok(xWeightedLength(text) <= X_MAX_WEIGHTED_LENGTH)
  assert.ok(text.includes(
    `${teamMembers[0]}, ${teamMembers[1]}, ${teamMembers[2]} and colleagues`
  ))
  assert.ok(text.includes(title))
})

test('computeHasOtherAuthors returns null for missing, empty or blank authors, and compares lengths otherwise', () => {
  assert.equal(computeHasOtherAuthors(undefined, ['Amit Garg']), null)
  assert.equal(computeHasOtherAuthors([], ['Amit Garg']), null)
  assert.equal(computeHasOtherAuthors(['', '   '], ['Amit Garg']), null)
  assert.equal(computeHasOtherAuthors(['House AA', 'Garg A', 'Other X'], ['Amit Garg']), true)
  assert.equal(computeHasOtherAuthors(['Garg A', 'Jain A'], ['Amit Garg', 'Arsh Jain']), false)
  assert.equal(computeHasOtherAuthors(['Garg A'], ['Amit Garg', 'Arsh Jain']), false)
})

test('buildXPostText adds "and colleagues" when hasOtherAuthors is true, with or without names, and never doubles it up', () => {
  const withNames = buildXPostText({ title: 'A kidney paper', link: LINK, teamMembers: ['Amit Garg', 'Arsh Jain'], hasOtherAuthors: true })
  assert.equal(withNames, `New from ${DEFAULT_TEAM_LABEL} investigators Amit Garg and Arsh Jain and colleagues: A kidney paper ${LINK}`)

  const withoutFlag = buildXPostText({ title: 'A kidney paper', link: LINK, teamMembers: ['Amit Garg', 'Arsh Jain'], hasOtherAuthors: false })
  assert.equal(withoutFlag, `New from ${DEFAULT_TEAM_LABEL} investigators Amit Garg and Arsh Jain: A kidney paper ${LINK}`)
  assert.equal(
    buildXPostText({ title: 'A kidney paper', link: LINK, teamMembers: ['Amit Garg', 'Arsh Jain'] }),
    withoutFlag
  )

  const noNames = buildXPostText({ title: 'A kidney paper', link: LINK, hasOtherAuthors: true })
  assert.equal(noNames, `New from ${DEFAULT_TEAM_LABEL} investigators and colleagues: A kidney paper ${LINK}`)

  const teamMembers = [
    'Alexandra Montgomery-Whitfield',
    'Bartholomew Fitzgerald-Huntington',
    'Constance Featherstonehaugh-Radcliffe',
    'Demetrius Kowalczyk-Abernathy',
    'Evangeline Radcliffe-Sinclair',
    'Frederick Abernathy-Wentworth',
    'Gwendolyn Chesterfield',
  ]
  const title = 'A moderately long study title about kidney outcomes after transplantation surgery in adults'
  const shortened = buildXPostText({ title, link: LINK, teamMembers, hasOtherAuthors: true })
  assert.ok(xWeightedLength(shortened) <= X_MAX_WEIGHTED_LENGTH)
  assert.ok(shortened.includes(`${teamMembers[0]}, ${teamMembers[1]}, ${teamMembers[2]} and colleagues:`))
  assert.equal(shortened.match(/and colleagues/g).length, 1)
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

// --- Drafting prompt (pure helpers) -----------------------------------------

test('validateSocialPostPrompt rejects empty, whitespace-only and over-limit text', () => {
  assert.deepEqual(validateSocialPostPrompt('Name every investigator.'), { ok: true, error: null })
  assert.equal(validateSocialPostPrompt('').ok, false)
  assert.equal(validateSocialPostPrompt('   ').ok, false)
  assert.equal(validateSocialPostPrompt(undefined).ok, false)
  const tooLong = validateSocialPostPrompt('a'.repeat(SOCIAL_POST_PROMPT_MAX_LENGTH + 1))
  assert.equal(tooLong.ok, false)
  assert.match(tooLong.error, new RegExp(String(SOCIAL_POST_PROMPT_MAX_LENGTH)))
  assert.equal(validateSocialPostPrompt('a'.repeat(SOCIAL_POST_PROMPT_MAX_LENGTH)).ok, true)
})

test('resolveSocialPostSystemPrompt prefers a trimmed custom prompt over the default', () => {
  assert.equal(resolveSocialPostSystemPrompt('  Custom rules.  ', 'Default rules.'), 'Custom rules.')
  assert.equal(resolveSocialPostSystemPrompt('', 'Default rules.'), 'Default rules.')
  assert.equal(resolveSocialPostSystemPrompt('   ', 'Default rules.'), 'Default rules.')
  assert.equal(resolveSocialPostSystemPrompt(null, 'Default rules.'), 'Default rules.')
  assert.equal(resolveSocialPostSystemPrompt(undefined, 'Default rules.'), 'Default rules.')
})

// --- Drafting prompt (store) -------------------------------------------------

function fakePromptWriteClient(initialDoc = null) {
  const calls = []
  let doc = initialDoc ? { ...initialDoc } : null
  let revCounter = 0
  const nextRev = () => `prompt-rev-${++revCounter}`
  return {
    calls,
    get current() { return doc },
    async getDocument(id) {
      calls.push({ name: 'getDocument', args: [id] })
      return doc ? { ...doc } : null
    },
    async createIfNotExists(newDoc) {
      calls.push({ name: 'createIfNotExists', args: [newDoc] })
      // Mirrors Sanity: this bumps _rev even on a no-op, which is exactly why production
      // code must never call it ahead of an ifRevisionId-guarded patch on the same doc.
      if (!doc) doc = { ...newDoc, _rev: nextRev() }
      else doc = { ...doc, _rev: nextRev() }
      return doc
    },
    async create(newDoc) {
      calls.push({ name: 'create', args: [newDoc] })
      if (doc) {
        const error = new Error(`Document with ID "${newDoc._id}" already exists`)
        error.statusCode = 409
        throw error
      }
      doc = { ...newDoc, _rev: nextRev() }
      return doc
    },
    patch(id) {
      let ifRev
      const patch = {
        ifRevisionId(rev) {
          ifRev = rev
          return patch
        },
        set(fields) {
          patch._set = fields
          return patch
        },
        unset(fields) {
          patch._unset = fields
          return patch
        },
        async commit() {
          calls.push({ name: 'commit', args: [id, ifRev, patch._set, patch._unset] })
          if (!doc || doc._id !== id) {
            const error = new Error('Document not found')
            error.statusCode = 404
            throw error
          }
          if (ifRev && doc._rev !== ifRev) {
            const error = new Error('The document has been changed since you started editing (revision mismatch)')
            error.statusCode = 409
            throw error
          }
          for (const key of patch._unset || []) delete doc[key]
          doc = { ...doc, ...(patch._set || {}), _rev: nextRev() }
          return doc
        },
      }
      return patch
    },
  }
}

function fakePromptClient(doc) {
  return { fetch: async () => doc }
}

test('fetchSocialPostPrompt reads the published doc and reports no custom prompt when unset', async () => {
  const withCustom = await fetchSocialPostPrompt(fakePromptClient({
    systemPrompt: '  Name every investigator.  ',
    updatedBy: 'admin@example.test',
    updatedAt: '2026-09-20T00:00:00.000Z',
    _rev: 'rev-1',
  }))
  assert.deepEqual(withCustom, {
    custom: 'Name every investigator.',
    updatedBy: 'admin@example.test',
    updatedAt: '2026-09-20T00:00:00.000Z',
    rev: 'rev-1',
  })

  assert.deepEqual(await fetchSocialPostPrompt(fakePromptClient(null)), {
    custom: null,
    updatedBy: null,
    updatedAt: null,
    rev: null,
  })

  assert.deepEqual(await fetchSocialPostPrompt(fakePromptClient({ systemPrompt: '   ', _rev: 'rev-1' })), {
    custom: null,
    updatedBy: null,
    updatedAt: null,
    rev: 'rev-1',
  })
})

test('saveSocialPostPrompt creates the singleton on first use and sets the fields', async () => {
  const client = fakePromptWriteClient(null)
  await saveSocialPostPrompt(client, { text: '  Name every investigator.  ', actorEmail: 'Admin@Example.test', now: NOW })
  assert.equal(client.current._type, 'socialPostingPrompt')
  assert.equal(client.current._id, 'socialPostingPrompt')
  assert.equal(client.current.systemPrompt, 'Name every investigator.')
  assert.equal(client.current.updatedBy, 'admin@example.test')
  assert.equal(client.current.updatedAt, NOW.toISOString())
})

test('saveSocialPostPrompt with a matching rev overwrites an existing custom prompt', async () => {
  const client = fakePromptWriteClient({
    _id: 'socialPostingPrompt',
    _type: 'socialPostingPrompt',
    _rev: 'rev-1',
    systemPrompt: 'Old rules.',
    updatedBy: 'first@example.test',
  })
  await saveSocialPostPrompt(client, { text: 'New rules.', actorEmail: 'second@example.test', rev: 'rev-1', now: NOW })
  assert.equal(client.current.systemPrompt, 'New rules.')
  assert.equal(client.current.updatedBy, 'second@example.test')
})

test('saveSocialPostPrompt reports a conflict on a stale rev, and when a doc already exists without one', async () => {
  const stale = fakePromptWriteClient({ _id: 'socialPostingPrompt', _type: 'socialPostingPrompt', _rev: 'rev-2', systemPrompt: 'Current rules.' })
  await assert.rejects(
    saveSocialPostPrompt(stale, { text: 'New rules.', actorEmail: 'a@example.test', rev: 'rev-1', now: NOW }),
    (error) => { assert.equal(error.conflict, true); return true }
  )
  assert.equal(stale.current.systemPrompt, 'Current rules.')

  const noRev = fakePromptWriteClient({ _id: 'socialPostingPrompt', _type: 'socialPostingPrompt', _rev: 'rev-2', systemPrompt: 'Current rules.' })
  await assert.rejects(
    saveSocialPostPrompt(noRev, { text: 'New rules.', actorEmail: 'a@example.test', now: NOW }),
    (error) => { assert.equal(error.conflict, true); return true }
  )
  assert.equal(noRev.current.systemPrompt, 'Current rules.')
})

test('saveSocialPostPrompt without a rev succeeds when the document does not exist yet', async () => {
  const client = fakePromptWriteClient(null)
  await saveSocialPostPrompt(client, { text: 'First custom rules.', actorEmail: 'a@example.test', now: NOW })
  assert.equal(client.current.systemPrompt, 'First custom rules.')
})

// Regression test: Sanity's createIfNotExists bumps _rev even when the document already
// exists, so calling it ahead of an ifRevisionId-guarded patch turned every save after the
// first into a spurious 409 conflict. This exercises the exact save-fetch-save sequence that
// broke: only the very first save worked, and every later save from /admin/social failed.
test('saveSocialPostPrompt: a second save using the rev from the first save succeeds', async () => {
  const client = fakePromptWriteClient(null)
  await saveSocialPostPrompt(client, { text: 'First rules.', actorEmail: 'a@example.test', now: NOW })
  const { rev } = await fetchSocialPostPrompt(fakePromptClient({ ...client.current }))

  await saveSocialPostPrompt(client, { text: 'Second rules.', actorEmail: 'b@example.test', rev, now: NOW })

  assert.equal(client.current.systemPrompt, 'Second rules.')
  assert.equal(client.current.updatedBy, 'b@example.test')
  assert.ok(!client.calls.some((call) => call.name === 'createIfNotExists'))
})

test('resetSocialPostPrompt unsets the custom prompt and records who reset it', async () => {
  const client = fakePromptWriteClient({
    _id: 'socialPostingPrompt',
    _type: 'socialPostingPrompt',
    _rev: 'rev-1',
    systemPrompt: 'Custom rules.',
    updatedBy: 'first@example.test',
  })
  await resetSocialPostPrompt(client, { actorEmail: 'second@example.test', rev: 'rev-1', now: NOW })
  assert.equal('systemPrompt' in client.current, false)
  assert.equal(client.current.updatedBy, 'second@example.test')
  assert.equal(client.current.updatedAt, NOW.toISOString())
})

test('resetSocialPostPrompt also reports a conflict on a stale rev', async () => {
  const client = fakePromptWriteClient({ _id: 'socialPostingPrompt', _type: 'socialPostingPrompt', _rev: 'rev-2', systemPrompt: 'Custom rules.' })
  await assert.rejects(
    resetSocialPostPrompt(client, { actorEmail: 'a@example.test', rev: 'rev-1', now: NOW }),
    (error) => { assert.equal(error.conflict, true); return true }
  )
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
  assert.equal('hasOtherAuthors' in built, false)
})

test('buildSocialPostRecord sets hasOtherAuthors from the publication authors and team members, and omits it when unknown', () => {
  const withOthers = feedItem('doi:10.1000/others', '2026-09-20T00:00:00Z', { authors: ['House AA', 'Garg A', 'Other X'] })
  const built = buildSocialPostRecord({ item: withOthers, network: 'x', teamMembers: ['Amit Garg'], now: NOW })
  assert.equal(built.hasOtherAuthors, true)

  const noOthers = feedItem('doi:10.1000/none', '2026-09-20T00:00:00Z', { authors: ['Garg A', 'Jain A'] })
  const same = buildSocialPostRecord({ item: noOthers, network: 'x', teamMembers: ['Amit Garg', 'Arsh Jain'], now: NOW })
  assert.equal(same.hasOtherAuthors, false)

  const unknown = feedItem('doi:10.1000/unknown', '2026-09-20T00:00:00Z')
  const built2 = buildSocialPostRecord({ item: unknown, network: 'x', teamMembers: ['Amit Garg'], now: NOW })
  assert.equal('hasOtherAuthors' in built2, false)
})

const PAVEL = { _id: 'r-pavel', name: 'Pavel Roshanov' }
const AMIT = { _id: 'r-amit', name: 'Amit Garg' }

function recordFor(publication, researchers) {
  const item = feedItem('doi:10.1000/xyz', '2026-09-20T00:00:00Z', { doi: '10.1000/xyz', source: 'pubmed', ...publication })
  return buildSocialPostRecord({ item, network: 'x', teamMembers: researchers.map((researcher) => researcher.name), researchers, now: NOW })
}

test('buildSocialPostRecord stores the team researcher ids, the paper anchor and the first author researcher', () => {
  const built = recordFor({ authors: ['Roshanov PS', 'Garg AX', 'Other X'] }, [PAVEL, AMIT, PAVEL])
  assert.deepEqual(built.teamMemberIds, ['r-pavel', 'r-amit'])
  assert.equal(built.firstAuthorId, 'r-pavel')
  assert.equal(built.paperAnchor, 'paper-doi-10-1000-xyz')
  assert.deepEqual(built.teamMembers, ['Pavel Roshanov', 'Amit Garg'])
  assert.equal(built.hasOtherAuthors, true)

  // Publication names and aliases count, as they do for attribution.
  const alias = recordFor({ authors: ['Smith RJ', 'Garg AX'] }, [{ _id: 'r-bob', name: 'Bob Smith', publicationAuthorAliases: ['Robert J Smith'] }, AMIT])
  assert.equal(alias.firstAuthorId, 'r-bob')
  const displayOrder = recordFor({ authors: ['Amit X Garg', 'Pavel S Roshanov'], source: 'crossref' }, [PAVEL, AMIT])
  assert.equal(displayOrder.firstAuthorId, 'r-amit')
})

test('buildSocialPostRecord omits firstAuthorId for a consortium, non-team or ambiguous first author', () => {
  const consortium = recordFor({ authors: ['CKD Prognosis Consortium', 'Roshanov PS'] }, [PAVEL, AMIT])
  assert.equal('firstAuthorId' in consortium, false)
  assert.deepEqual(consortium.teamMemberIds, ['r-pavel', 'r-amit'])

  const outsider = recordFor({ authors: ['Smith J', 'Roshanov PS', 'Garg AX'] }, [PAVEL, AMIT])
  assert.equal('firstAuthorId' in outsider, false)

  const ambiguous = recordFor({ authors: ['Garg A', 'Roshanov PS'] }, [AMIT, { _id: 'r-amber', name: 'Amber Garg' }])
  assert.equal('firstAuthorId' in ambiguous, false)

  const noAuthors = recordFor({}, [PAVEL])
  assert.equal('firstAuthorId' in noAuthors, false)
})

test('buildSocialPostRecord omits teamMemberIds and paperAnchor when unknown', () => {
  const item = feedItem('https://example.test/paper', '2026-09-20T00:00:00Z', { authors: ['Roshanov PS'] })
  const built = buildSocialPostRecord({ item, network: 'x', teamMembers: ['Pavel Roshanov'], now: NOW })
  for (const field of ['teamMemberIds', 'firstAuthorId', 'paperAnchor']) assert.equal(field in built, false, field)
})

test('buildSocialPostRecord writes the complete record for a paper with team researchers', () => {
  const built = recordFor({ authors: ['Roshanov PS', 'Garg AX', 'Other X'] }, [PAVEL, AMIT])
  assert.deepEqual(built, {
    _id: socialPostDocumentId('x', 'doi:10.1000/xyz'),
    _type: 'socialPost',
    network: 'x',
    guid: 'doi:10.1000/xyz',
    link: LINK,
    title: 'Paper doi:10.1000/xyz',
    journal: 'Kidney Journal',
    publishedAt: '2026-09-20T00:00:00.000Z',
    teamMembers: ['Pavel Roshanov', 'Amit Garg'],
    hasOtherAuthors: true,
    teamMemberIds: ['r-pavel', 'r-amit'],
    firstAuthorId: 'r-pavel',
    paperAnchor: 'paper-doi-10-1000-xyz',
    laySummary: 'Summary of doi:10.1000/xyz',
    status: 'available',
    createdAt: NOW.toISOString(),
  })
})

test('buildSocialPostTeamFields returns the team ids, first author and paper anchor, omitting empty values', () => {
  const publication = { doi: '10.1000/xyz', source: 'pubmed', authors: ['Roshanov PS', 'Garg AX'] }
  assert.deepEqual(buildSocialPostTeamFields({ publication, researchers: [PAVEL, AMIT, PAVEL] }), {
    teamMemberIds: ['r-pavel', 'r-amit'],
    firstAuthorId: 'r-pavel',
    paperAnchor: 'paper-doi-10-1000-xyz',
  })
  assert.deepEqual(buildSocialPostTeamFields({ publication, researchers: [] }), { paperAnchor: 'paper-doi-10-1000-xyz' })
  assert.deepEqual(buildSocialPostTeamFields({ researchers: [AMIT] }), { teamMemberIds: ['r-amit'] })
  assert.deepEqual(buildSocialPostTeamFields(), {})
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

test('syncSocialPosts records the team researcher ids, first author and paper anchor', async () => {
  const queries = []
  const { writeClient, created } = fakeSanity()
  const client = {
    async fetch(query) {
      queries.push(query)
      if (query.includes('"researcher"')) return [PAVEL, AMIT, { _id: 'r-other', name: 'Not On This Paper' }]
      return []
    },
  }
  const cache = {
    publications: [cachePublication('10.1000/new', { authors: ['Garg AX', 'Roshanov PS'], source: 'pubmed' })],
    provenance: { 'doi:10.1000/new': ['r-pavel', 'r-amit', 'r-missing'] },
  }
  await syncSocialPosts({ client, writeClient, now: NOW, loadCache: async () => cache })
  assert.deepEqual(created[0].teamMembers, ['Pavel Roshanov', 'Amit Garg'])
  assert.deepEqual(created[0].teamMemberIds, ['r-pavel', 'r-amit'])
  assert.equal(created[0].firstAuthorId, 'r-amit')
  assert.equal(created[0].paperAnchor, 'paper-doi-10-1000-new')
  assert.ok(queries.some((query) => query.includes('publicationAuthorName') && query.includes('publicationAuthorAliases')))
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

// --- Profile link (spotlight) ------------------------------------------------

const SITE = 'https://kcru.example.test'
const DAY = 24 * 60 * 60 * 1000
const JANE = { _id: 'r-jane', name: 'Jane Smith', slug: 'jane-smith' }
const RAJ = { _id: 'r-raj', name: 'Raj Patel', slug: 'Raj-Patel' }
const AMY = { _id: 'r-amy', name: 'Amy Lee', slug: 'amy-lee' }
const SPOTLIGHT_RESEARCHERS = [JANE, RAJ, AMY]

function daysAgo(days) {
  return new Date(NOW.getTime() - days * DAY).toISOString()
}

function neverRandom() {
  throw new Error('random should not be used')
}

test('findProfileSlugs reads /team/<slug> links from post text, case-insensitively', () => {
  const text = `New from investigators ${SITE}/team/Jane-Smith#paper-doi-10-1000-x and https://www.other.test/team/raj-patel/ plus ${LINK} and /team/amy-lee`
  assert.deepEqual(Array.from(findProfileSlugs(text)), ['jane-smith', 'raj-patel'])
  assert.equal(findProfileSlugs(`${SITE}/about/team/amy-lee`).size, 0)
  assert.equal(findProfileSlugs('').size, 0)
  assert.equal(findProfileSlugs(null).size, 0)

  assert.equal(postLinksToProfile(`Read more ${SITE}/team/jane-smith#paper-x`, 'Jane-Smith'), true)
  assert.equal(postLinksToProfile(`Read more ${SITE}/team/jane-smith-2`, 'jane-smith'), false)
  assert.equal(postLinksToProfile(`Read more ${LINK}`, 'jane-smith'), false)
  assert.equal(postLinksToProfile(`Read more ${SITE}/team/jane-smith`, ''), false)
})

test('collectRecentSpotlights counts only written, queued or published posts that link to a profile', () => {
  const records = [
    { _id: 'published', status: 'published', text: `Post ${SITE}/team/JANE-SMITH#paper-a`, sentAt: daysAgo(5), dueAt: daysAgo(6) },
    { _id: 'older', status: 'queued', text: `Post ${SITE}/team/jane-smith`, queuedAt: daysAgo(15) },
    { _id: 'sending', status: 'sending', text: `Post ${SITE}/team/raj-patel`, queuedAt: daysAgo(2) },
    { _id: 'dismissed', status: 'dismissed', text: `Post ${SITE}/team/amy-lee`, draftedAt: daysAgo(1) },
    { _id: 'available', status: 'available', text: `Post ${SITE}/team/amy-lee`, draftedAt: daysAgo(1) },
    { _id: 'legacy', status: 'pending', text: `Post ${SITE}/team/amy-lee`, draftedAt: daysAgo(1) },
    { _id: 'seeded', status: 'seeded', text: `Post ${SITE}/team/amy-lee`, draftedAt: daysAgo(1) },
    { _id: 'doi', status: 'draft', text: `Post ${LINK}`, draftedAt: daysAgo(1) },
    { _id: 'unknown', status: 'draft', text: `Post ${SITE}/team/someone-else`, draftedAt: daysAgo(1) },
    { _id: 'no-time', status: 'draft', text: `Post ${SITE}/team/amy-lee` },
  ]
  const recent = collectRecentSpotlights({ records, researchers: SPOTLIGHT_RESEARCHERS, now: NOW })
  assert.deepEqual(Object.fromEntries(recent), {
    'r-jane': Date.parse(daysAgo(5)),
    'r-raj': Date.parse(daysAgo(2)),
  })
})

test('collectRecentSpotlights uses sentAt, then dueAt, queuedAt and draftedAt, and counts an upcoming dueAt', () => {
  const upcoming = new Date(NOW.getTime() + 3 * DAY).toISOString()
  const records = [
    { _id: 'a', status: 'queued', text: `${SITE}/team/jane-smith`, dueAt: upcoming, queuedAt: daysAgo(40), draftedAt: daysAgo(41) },
    { _id: 'b', status: 'removing', text: `${SITE}/team/raj-patel`, queuedAt: daysAgo(3), draftedAt: daysAgo(40) },
    { _id: 'c', status: 'draft', text: `${SITE}/team/amy-lee`, draftedAt: daysAgo(4) },
    { _id: 'd', status: 'published', text: `${SITE}/team/amy-lee`, sentAt: daysAgo(40), dueAt: daysAgo(1) },
  ]
  const recent = collectRecentSpotlights({ records, researchers: SPOTLIGHT_RESEARCHERS, now: NOW })
  assert.equal(recent.get('r-jane'), Date.parse(upcoming))
  assert.equal(recent.get('r-raj'), Date.parse(daysAgo(3)))
  assert.equal(recent.get('r-amy'), Date.parse(daysAgo(4)))
})

test('collectRecentSpotlights includes the window edge, excludes older posts and leaves out the post being drafted', () => {
  assert.equal(SOCIAL_POST_SPOTLIGHT_WINDOW_DAYS, 30)
  const edge = new Date(NOW.getTime() - 30 * DAY)
  const records = [
    { _id: 'edge', status: 'published', text: `${SITE}/team/jane-smith`, sentAt: edge.toISOString() },
    { _id: 'too-old', status: 'published', text: `${SITE}/team/raj-patel`, sentAt: new Date(edge.getTime() - 1).toISOString() },
    { _id: 'self', status: 'draft', text: `${SITE}/team/amy-lee`, draftedAt: daysAgo(1) },
  ]
  const recent = collectRecentSpotlights({ records, researchers: SPOTLIGHT_RESEARCHERS, now: NOW, excludeId: 'self' })
  assert.deepEqual(Array.from(recent.keys()), ['r-jane'])
  assert.equal(collectRecentSpotlights({ records, researchers: SPOTLIGHT_RESEARCHERS, now: NOW }).has('r-amy'), true)
  assert.equal(collectRecentSpotlights({ records, researchers: SPOTLIGHT_RESEARCHERS, now: NOW, windowDays: 31 }).has('r-raj'), true)
})

test('chooseSpotlightResearcher always picks the first author, even one featured recently', () => {
  const recentSpotlights = new Map([['r-raj', NOW.getTime()]])
  assert.deepEqual(
    chooseSpotlightResearcher({ candidates: SPOTLIGHT_RESEARCHERS, firstAuthorId: 'r-raj', recentSpotlights, random: neverRandom }),
    { researcher: RAJ, reason: 'first-author' }
  )
})

test('chooseSpotlightResearcher picks at random among investigators not featured recently', () => {
  const recentSpotlights = new Map([['r-jane', NOW.getTime()]])
  const pick = (value) => chooseSpotlightResearcher({ candidates: SPOTLIGHT_RESEARCHERS, recentSpotlights, random: () => value })
  assert.deepEqual(pick(0), { researcher: RAJ, reason: 'rotation' })
  assert.deepEqual(pick(0.99), { researcher: AMY, reason: 'rotation' })
  // A first author who is not one of the candidates does not change that.
  assert.equal(chooseSpotlightResearcher({ candidates: SPOTLIGHT_RESEARCHERS, firstAuthorId: 'r-other', recentSpotlights, random: () => 0 }).reason, 'rotation')
})

test('chooseSpotlightResearcher picks the investigator featured longest ago when all were featured recently', () => {
  const recentSpotlights = new Map([['r-jane', 3000], ['r-raj', 1000], ['r-amy', 1000]])
  const pick = (value) => chooseSpotlightResearcher({ candidates: SPOTLIGHT_RESEARCHERS, recentSpotlights, random: () => value })
  assert.deepEqual(pick(0), { researcher: RAJ, reason: 'least-recent' })
  assert.deepEqual(pick(0.99), { researcher: AMY, reason: 'least-recent' })

  const single = new Map([['r-jane', 3000], ['r-raj', 2000], ['r-amy', 1000]])
  assert.deepEqual(
    chooseSpotlightResearcher({ candidates: SPOTLIGHT_RESEARCHERS, recentSpotlights: single, random: () => 0 }),
    { researcher: AMY, reason: 'least-recent' }
  )
})

test('chooseSpotlightResearcher returns null without a profile, and skips a first author who has none', () => {
  assert.equal(chooseSpotlightResearcher({ candidates: [], random: neverRandom }), null)
  assert.equal(chooseSpotlightResearcher({ candidates: [{ _id: 'r-x', name: 'No Profile', slug: '' }], random: neverRandom }), null)
  assert.equal(chooseSpotlightResearcher(), null)

  const noSlug = { _id: 'r-first', name: 'First Author', slug: '' }
  assert.deepEqual(
    chooseSpotlightResearcher({ candidates: [noSlug, JANE], firstAuthorId: 'r-first', random: () => 0 }),
    { researcher: JANE, reason: 'rotation' }
  )
})

test('buildProfilePaperLink links to the profile, anchored to the paper when there is an anchor', () => {
  assert.equal(
    buildProfilePaperLink({ baseUrl: `${SITE}/`, slug: 'jane-smith', anchor: 'paper-doi-10-1000-xyz' }),
    `${SITE}/team/jane-smith#paper-doi-10-1000-xyz`
  )
  assert.equal(buildProfilePaperLink({ baseUrl: SITE, slug: 'jane smith' }), `${SITE}/team/jane%20smith`)
  assert.equal(buildProfilePaperLink({ baseUrl: SITE, slug: '' }), '')
})

test('describeSpotlightReason explains each choice in plain language', () => {
  assert.equal(describeSpotlightReason('first-author'), 'first author')
  assert.equal(describeSpotlightReason('rotation'), 'picked at random from the investigators not featured in the last 30 days')
  assert.equal(
    describeSpotlightReason('least-recent'),
    'every investigator on this paper was featured in the last 30 days, so this is the one featured longest ago'
  )
  assert.equal(describeSpotlightReason('unknown'), '')
})

function spotlightClient({ researchers = SPOTLIGHT_RESEARCHERS, records = [] } = {}) {
  const queries = []
  return {
    queries,
    async fetch(query, params) {
      queries.push({ query, params })
      if (query.includes('"researcher"')) return researchers
      return records
    },
  }
}

function spotlightPost(overrides = {}) {
  return record({
    guid: 'doi:10.1000/xyz',
    teamMembers: ['Jane Smith', 'Raj Patel'],
    teamMemberIds: ['r-jane', 'r-raj'],
    paperAnchor: 'paper-doi-10-1000-xyz',
    ...overrides,
  })
}

test('resolveSocialPostSpotlight links the first author profile, anchored to the paper', async () => {
  const client = spotlightClient()
  const spotlight = await resolveSocialPostSpotlight({
    client,
    post: spotlightPost({ firstAuthorId: 'r-raj' }),
    baseUrl: SITE,
    now: NOW,
    random: neverRandom,
  })
  assert.deepEqual(spotlight, {
    researcherId: 'r-raj',
    name: 'Raj Patel',
    slug: 'Raj-Patel',
    reason: 'first-author',
    link: `${SITE}/team/Raj-Patel#paper-doi-10-1000-xyz`,
  })
  assert.ok(client.queries.some(({ query }) => query.includes('defined(slug.current)')))
})

test('resolveSocialPostSpotlight rotates away from investigators featured in the last 30 days', async () => {
  const records = [{ _id: 'other', status: 'published', text: `Post ${SITE}/team/jane-smith#paper-a`, sentAt: daysAgo(3) }]
  const spotlight = await resolveSocialPostSpotlight({
    client: spotlightClient({ records }),
    post: spotlightPost(),
    baseUrl: SITE,
    now: NOW,
    random: () => 0,
  })
  assert.equal(spotlight.researcherId, 'r-raj')
  assert.equal(spotlight.reason, 'rotation')
})

test('resolveSocialPostSpotlight leaves the post being drafted out of the history', async () => {
  const records = [{ _id: 'socialPost-x-1', status: 'draft', text: `Post ${SITE}/team/jane-smith`, draftedAt: daysAgo(1) }]
  const spotlight = await resolveSocialPostSpotlight({
    client: spotlightClient({ records }),
    post: spotlightPost({ teamMemberIds: ['r-jane'] }),
    baseUrl: SITE,
    now: NOW,
    random: () => 0,
  })
  assert.equal(spotlight.researcherId, 'r-jane')
  assert.equal(spotlight.reason, 'rotation')
})

test('resolveSocialPostSpotlight matches older records by name and anchors to the GUID', async () => {
  const spotlight = await resolveSocialPostSpotlight({
    client: spotlightClient(),
    post: spotlightPost({ teamMemberIds: undefined, paperAnchor: undefined, teamMembers: ['  amy LEE '], guid: 'pmid:12345' }),
    baseUrl: SITE,
    now: NOW,
    random: () => 0,
  })
  assert.equal(spotlight.researcherId, 'r-amy')
  assert.equal(spotlight.link, `${SITE}/team/amy-lee#paper-pmid-12345`)
})

test('resolveSocialPostSpotlight keeps the chosen profile on Regenerate while it is still on the paper', async () => {
  const kept = spotlightPost({ status: 'draft', spotlightSlug: 'raj-patel', spotlightReason: 'rotation' })
  // With this random value a fresh choice would be Jane, so Raj shows the earlier pick was kept.
  const again = await resolveSocialPostSpotlight({ client: spotlightClient(), post: kept, regenerate: true, baseUrl: SITE, now: NOW, random: () => 0 })
  assert.equal(again.researcherId, 'r-raj')
  assert.equal(again.reason, 'rotation')

  // Create post (not Regenerate) always chooses afresh.
  const fresh = await resolveSocialPostSpotlight({ client: spotlightClient(), post: kept, baseUrl: SITE, now: NOW, random: () => 0 })
  assert.equal(fresh.researcherId, 'r-jane')

  const gone = spotlightPost({ status: 'draft', spotlightSlug: 'amy-lee', spotlightReason: 'rotation' })
  const rechosen = await resolveSocialPostSpotlight({ client: spotlightClient(), post: gone, regenerate: true, baseUrl: SITE, now: NOW, random: () => 0.99 })
  assert.equal(rechosen.researcherId, 'r-raj')
})

test('resolveSocialPostSpotlight gives the first author the link on Regenerate, even over an earlier rotation pick', async () => {
  // The draft picked Jane by rotation; the migration later found that Raj is the first author.
  const post = spotlightPost({ status: 'draft', spotlightSlug: 'jane-smith', spotlightReason: 'rotation', firstAuthorId: 'r-raj' })
  const again = await resolveSocialPostSpotlight({ client: spotlightClient(), post, regenerate: true, baseUrl: SITE, now: NOW, random: neverRandom })
  assert.equal(again.researcherId, 'r-raj')
  assert.equal(again.reason, 'first-author')
  assert.equal(again.link, `${SITE}/team/Raj-Patel#paper-doi-10-1000-xyz`)

  // A first author without a profile cannot get the link, so the earlier pick stays.
  const noProfile = spotlightPost({ status: 'draft', spotlightSlug: 'jane-smith', spotlightReason: 'rotation', firstAuthorId: 'r-no-profile' })
  const kept = await resolveSocialPostSpotlight({ client: spotlightClient(), post: noProfile, regenerate: true, baseUrl: SITE, now: NOW, random: () => 0.99 })
  assert.equal(kept.researcherId, 'r-jane')
  assert.equal(kept.reason, 'rotation')
})

test('resolveSocialPostSpotlight links a profile only when the site has a public https address', async () => {
  const notPublic = [
    'http://localhost:3000',
    'https://localhost:3000',
    'https://kcru.localhost',
    'https://127.0.0.1',
    'https://127.0.1.1:8443',
    'https://[::1]:3000',
    'https://0.0.0.0',
    'http://kcru.example.test',
    'kcru.example.test',
    'not a url',
    '',
    undefined,
  ]
  for (const baseUrl of notPublic) {
    const client = spotlightClient()
    assert.equal(await resolveSocialPostSpotlight({ client, post: spotlightPost(), baseUrl, now: NOW, random: () => 0 }), null, String(baseUrl))
    assert.equal(client.queries.length, 0, String(baseUrl))
  }
  const publicSite = await resolveSocialPostSpotlight({ client: spotlightClient(), post: spotlightPost(), baseUrl: 'https://KCRU.example.test/', now: NOW, random: () => 0 })
  assert.equal(publicSite.link, 'https://KCRU.example.test/team/jane-smith#paper-doi-10-1000-xyz')
})

test('resolveSocialPostSpotlight returns null when no investigator on the paper has a profile', async () => {
  const withoutProfiles = spotlightClient({ researchers: [AMY] })
  assert.equal(await resolveSocialPostSpotlight({ client: withoutProfiles, post: spotlightPost(), baseUrl: SITE, now: NOW }), null)
  assert.equal(await resolveSocialPostSpotlight({ client: spotlightClient(), post: spotlightPost({ teamMemberIds: undefined, teamMembers: [] }), baseUrl: SITE, now: NOW }), null)
  assert.equal(await resolveSocialPostSpotlight({ client: spotlightClient(), post: spotlightPost(), baseUrl: '', now: NOW }), null)
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
  const { compose } = fakeCompose({ text: `New from ${DEFAULT_TEAM_LABEL} investigators: A kidney paper ${LINK}`, generatedBy: 'template' })
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

const SPOTLIGHT_LINK = `${SITE}/team/jane-smith#paper-doi-10-1000-xyz`
const SPOTLIGHT_FIELD_NAMES = ['spotlightResearcherId', 'spotlightName', 'spotlightSlug', 'spotlightReason', 'postLink']
const SPOTLIGHT_RECORD_FIELDS = {
  spotlightResearcherId: 'r-jane',
  spotlightName: 'Jane Smith',
  spotlightSlug: 'jane-smith',
  spotlightReason: 'first-author',
  postLink: SPOTLIGHT_LINK,
}

test('Create post records the profile the draft links to', async () => {
  const store = fakeStore(record())
  const text = `Jane Smith found something. ${SPOTLIGHT_LINK}`
  const { compose } = fakeCompose({
    text,
    generatedBy: 'llm:test-model',
    spotlight: { researcherId: 'r-jane', name: 'Jane Smith', slug: 'jane-smith', reason: 'first-author', link: SPOTLIGHT_LINK },
  })
  const result = await draft(store, { compose })
  assert.equal(result.ok, true)
  for (const [field, value] of Object.entries(SPOTLIGHT_RECORD_FIELDS)) {
    assert.equal(store.current[field], value, field)
    assert.equal(result.post[field], value, field)
  }
  assert.equal(store.current.text, text)
  assert.equal(store.current.link, LINK)
})

test('a draft that links to the paper clears any earlier profile link', async () => {
  const store = fakeStore(draftRecord(SPOTLIGHT_RECORD_FIELDS))
  const { compose } = fakeCompose({ text: DRAFT_TEXT, generatedBy: 'template', spotlight: null })
  const result = await draft(store, { regenerate: true, compose })
  assert.equal(result.ok, true)
  for (const field of SPOTLIGHT_FIELD_NAMES) {
    assert.equal(field in store.current, false, field)
    assert.equal(result.post[field], null, field)
  }
  assert.equal(store.calls[1].args[2].postLink, null)
})

test('Discard, Not posting and Restore clear the profile link with the draft', async () => {
  const discarded = fakeStore(draftRecord(SPOTLIGHT_RECORD_FIELDS))
  await discardSocialPostDraft({ id: 'socialPost-x-1', store: discarded })
  const dismissed = fakeStore(draftRecord(SPOTLIGHT_RECORD_FIELDS))
  await dismissSocialPost({ id: 'socialPost-x-1', actorEmail: 'admin@example.test', store: dismissed, now: NOW })
  const restored = fakeStore(record({ status: 'dismissed', ...SPOTLIGHT_RECORD_FIELDS }))
  await restoreSocialPost({ id: 'socialPost-x-1', store: restored })
  for (const store of [discarded, dismissed, restored]) {
    for (const field of SPOTLIGHT_FIELD_NAMES) assert.equal(field in store.current, false, field)
    assert.equal(store.current.link, LINK)
  }
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

// Records that already have the profile-link fields, so a test can cover one part of the migration.
const BACKFILLED = { teamMemberIds: ['r-jane'] }

test('the migration turns pending into available with the lay summary and skipped into dismissed', () => {
  const { patches, counts } = planSocialPostMigration({
    records: [
      { _id: 'p1', _rev: 'r1', status: 'pending', guid: 'doi:10.1000/a', ...BACKFILLED },
      { _id: 'p2', _rev: 'r2', status: 'pending', guid: 'doi:10.1000/gone', ...BACKFILLED },
      { _id: 's1', _rev: 'r3', status: 'skipped', skippedBy: 'admin@example.test', skippedAt: '2026-09-20T00:00:00.000Z', ...BACKFILLED },
      { _id: 'q1', _rev: 'r4', status: 'queued', ...BACKFILLED },
    ],
    publications: [cachePublication('10.1000/a', { publishedAt: '2025-01-01T00:00:00.000Z' })],
  })
  assert.deepEqual(counts, {
    socialPosts: 4,
    pendingToAvailable: 2,
    laySummaryFilled: 1,
    laySummaryMissing: 1,
    skippedToDismissed: 1,
    hasOtherAuthorsFilled: 0,
    hasOtherAuthorsUnknown: 4,
    teamMemberIdsFilled: 0,
    firstAuthorIdFilled: 0,
    paperAnchorFilled: 0,
    teamMembersUnmatched: 0,
    teamMembersPartlyMatched: 0,
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

test('the migration fills a missing hasOtherAuthors on records of any status, and leaves an existing value alone', () => {
  const { patches, counts } = planSocialPostMigration({
    records: [
      { _id: 'avail-more', _rev: 'r1', status: 'available', guid: 'doi:10.1000/more', teamMembers: ['Jane Smith'], ...BACKFILLED },
      // GROQ returns null (not undefined) for a field absent from the document; both must count as missing.
      { _id: 'queued-equal', _rev: 'r2', status: 'queued', guid: 'doi:10.1000/equal', teamMembers: ['Jane Smith', 'Raj Patel'], hasOtherAuthors: null, ...BACKFILLED },
      { _id: 'draft-known', _rev: 'r3', status: 'draft', guid: 'doi:10.1000/more', teamMembers: ['Jane Smith'], hasOtherAuthors: false, ...BACKFILLED },
      { _id: 'no-authors', _rev: 'r4', status: 'published', guid: 'doi:10.1000/unknown', teamMembers: [], ...BACKFILLED },
    ],
    publications: [
      cachePublication('10.1000/more', { authors: ['Jane Smith', 'Someone Else'] }),
      cachePublication('10.1000/equal', { authors: ['Jane Smith', 'Raj Patel'] }),
      cachePublication('10.1000/unknown'),
    ],
  })
  assert.equal(counts.hasOtherAuthorsFilled, 2)
  assert.equal(counts.hasOtherAuthorsUnknown, 1)
  assert.equal(counts.unchanged, 2)
  const byId = Object.fromEntries(patches.map((patch) => [patch.id, patch]))
  assert.deepEqual(byId['avail-more'].set, { hasOtherAuthors: true })
  assert.deepEqual(byId['queued-equal'].set, { hasOtherAuthors: false })
  assert.equal('draft-known' in byId, false)
  assert.equal('no-authors' in byId, false)
})

const ANDREA = { _id: 'r-andrea', name: 'Andrea Cowan' }
const MIGRATION_RESEARCHERS = [AMIT, PAVEL, ANDREA, { _id: 'r-not-named', name: 'Not Named' }]
const MIGRATION_PUBLICATIONS = [
  cachePublication('10.1000/garg', { source: 'pubmed', authors: ['Garg AX', 'Roshanov PS', 'Other X'] }),
  cachePublication('10.1000/cowan', { source: 'pubmed', authors: ['Cowan ACJ', 'Garg AX'] }),
  cachePublication('10.1000/roshanov', { source: 'pubmed', authors: ['Roshanov PS', 'Garg AX'] }),
]

function migrate(records) {
  const { patches, counts } = planSocialPostMigration({ records, publications: MIGRATION_PUBLICATIONS, researchers: MIGRATION_RESEARCHERS })
  return { counts, byId: Object.fromEntries(patches.map((patch) => [patch.id, patch])) }
}

test('the migration fills team researcher ids, the first author and the paper anchor from the names each post records', () => {
  const { counts, byId } = migrate([
    { _id: 'garg', _rev: 'r1', status: 'queued', guid: 'doi:10.1000/garg', teamMembers: [' amit  GARG ', 'Pavel Roshanov'], hasOtherAuthors: true, teamMemberIds: null },
    { _id: 'cowan', _rev: 'r2', status: 'published', guid: 'doi:10.1000/cowan', teamMembers: ['Andrea Cowan'], hasOtherAuthors: true },
    // Pavel is the first author, but this post does not name him, so it gets no first author.
    { _id: 'unnamed-first', _rev: 'r3', status: 'available', guid: 'doi:10.1000/roshanov', teamMembers: ['Amit Garg'], hasOtherAuthors: true },
    { _id: 'done', _rev: 'r4', status: 'draft', guid: 'doi:10.1000/garg', teamMembers: ['Amit Garg'], hasOtherAuthors: true, teamMemberIds: ['r-amit'] },
  ])
  // A record that needs only this backfill still gets a patch.
  assert.deepEqual(byId.garg, {
    id: 'garg',
    rev: 'r1',
    set: { teamMemberIds: ['r-amit', 'r-pavel'], firstAuthorId: 'r-amit', paperAnchor: 'paper-doi-10-1000-garg' },
    unset: [],
  })
  assert.deepEqual(byId.cowan.set, { teamMemberIds: ['r-andrea'], firstAuthorId: 'r-andrea', paperAnchor: 'paper-doi-10-1000-cowan' })
  assert.deepEqual(byId['unnamed-first'].set, { teamMemberIds: ['r-amit'], paperAnchor: 'paper-doi-10-1000-roshanov' })
  assert.equal('done' in byId, false)
  assert.equal(counts.teamMemberIdsFilled, 3)
  assert.equal(counts.firstAuthorIdFilled, 2)
  assert.equal(counts.paperAnchorFilled, 3)
  assert.equal(counts.teamMembersUnmatched, 0)
  assert.equal(counts.hasOtherAuthorsFilled, 0)
  assert.equal(counts.unchanged, 1)
})

test('the migration anchors a paper missing from the cache to its GUID with no first author, and never overwrites a field', () => {
  const { counts, byId } = migrate([
    { _id: 'gone', _rev: 'r1', status: 'published', guid: 'pmid:4242', teamMembers: ['Amit Garg'], hasOtherAuthors: true },
    { _id: 'partial', _rev: 'r2', status: 'draft', guid: 'doi:10.1000/garg', teamMembers: ['Amit Garg'], hasOtherAuthors: true, firstAuthorId: 'r-kept', paperAnchor: 'paper-kept' },
  ])
  assert.deepEqual(byId.gone.set, { teamMemberIds: ['r-amit'], paperAnchor: 'paper-pmid-4242' })
  assert.deepEqual(byId.partial.set, { teamMemberIds: ['r-amit'] })
  assert.equal(counts.teamMemberIdsFilled, 2)
  assert.equal(counts.firstAuthorIdFilled, 0)
  assert.equal(counts.paperAnchorFilled, 1)
})

test('the migration writes nothing for a record whose team member names match no researcher', () => {
  const { counts, byId } = migrate([
    { _id: 'renamed', _rev: 'r1', status: 'available', guid: 'doi:10.1000/garg', teamMembers: ['Amit X. Garg'], hasOtherAuthors: true },
    { _id: 'no-names', _rev: 'r2', status: 'seeded', guid: 'doi:10.1000/cowan', teamMembers: [], hasOtherAuthors: false },
  ])
  assert.deepEqual(byId, {})
  assert.equal(counts.teamMembersUnmatched, 2)
  assert.equal(counts.teamMembersPartlyMatched, 0)
  assert.equal(counts.teamMemberIdsFilled, 0)
  assert.equal(counts.firstAuthorIdFilled, 0)
  assert.equal(counts.paperAnchorFilled, 0)
  assert.equal(counts.unchanged, 2)
})

test('the migration waits to write a partly matched team until every name matches a researcher', () => {
  // The post recorded Andrea's name as "Andrea C. Cowan"; her researcher document now says "Andrea Cowan".
  const record = { _id: 'partly', _rev: 'r1', status: 'queued', guid: 'doi:10.1000/cowan', teamMembers: ['Andrea C. Cowan', 'Amit Garg'], hasOtherAuthors: true }
  const { counts, byId } = migrate([record])
  assert.deepEqual(byId, {})
  assert.equal(counts.teamMembersPartlyMatched, 1)
  assert.equal(counts.teamMembersUnmatched, 0)
  assert.equal(counts.teamMemberIdsFilled, 0)
  assert.equal(counts.firstAuthorIdFilled, 0)
  assert.equal(counts.paperAnchorFilled, 0)
  assert.equal(counts.unchanged, 1)

  // A later run, once every name matches, fills all three fields.
  const later = planSocialPostMigration({
    records: [record],
    publications: MIGRATION_PUBLICATIONS,
    researchers: [AMIT, { ...ANDREA, name: 'Andrea C. Cowan' }],
  })
  assert.deepEqual(later.patches[0].set, { teamMemberIds: ['r-andrea', 'r-amit'], firstAuthorId: 'r-andrea', paperAnchor: 'paper-doi-10-1000-cowan' })
  assert.equal(later.counts.teamMembersPartlyMatched, 0)
})

test('a legacy record gets its status change, hasOtherAuthors and the profile-link fields in one patch', () => {
  const { counts, byId } = migrate([
    { _id: 'legacy-pending', _rev: 'r1', status: 'pending', guid: 'doi:10.1000/cowan', teamMembers: ['Andrea Cowan'], text: 'Old text' },
    { _id: 'legacy-skipped', _rev: 'r2', status: 'skipped', guid: 'doi:10.1000/garg', teamMembers: ['Amit Garg'], skippedBy: 'admin@example.test', skippedAt: '2026-09-20T00:00:00.000Z' },
  ])
  assert.deepEqual(byId['legacy-pending'], {
    id: 'legacy-pending',
    rev: 'r1',
    set: {
      status: 'available',
      laySummary: 'Lay summary of 10.1000/cowan.',
      hasOtherAuthors: true,
      teamMemberIds: ['r-andrea'],
      firstAuthorId: 'r-andrea',
      paperAnchor: 'paper-doi-10-1000-cowan',
    },
    unset: ['text', 'proposedText', 'lastError', 'lastErrorAt', 'approvedBy', 'approvedAt'],
  })
  assert.deepEqual(byId['legacy-skipped'], {
    id: 'legacy-skipped',
    rev: 'r2',
    set: {
      status: 'dismissed',
      dismissedBy: 'admin@example.test',
      dismissedAt: '2026-09-20T00:00:00.000Z',
      hasOtherAuthors: true,
      teamMemberIds: ['r-amit'],
      firstAuthorId: 'r-amit',
      paperAnchor: 'paper-doi-10-1000-garg',
    },
    unset: [],
  })
  assert.deepEqual(counts, {
    socialPosts: 2,
    pendingToAvailable: 1,
    laySummaryFilled: 1,
    laySummaryMissing: 0,
    skippedToDismissed: 1,
    hasOtherAuthorsFilled: 2,
    hasOtherAuthorsUnknown: 0,
    teamMemberIdsFilled: 2,
    firstAuthorIdFilled: 2,
    paperAnchorFilled: 2,
    teamMembersUnmatched: 0,
    teamMembersPartlyMatched: 0,
    unchanged: 0,
  })
})
