import assert from 'node:assert/strict'
import test from 'node:test'

import {
  canEditPeopleField,
  describeEmailListChange,
  extractEmailAddresses,
  findEditorLockout,
  findOutsideDomainEmails,
  sameEmailList,
  validateEmailList,
  validateOptionalEmail,
  validateRoutingEmails,
} from '../lib/peopleSettings.js'
import { buildPeopleView, updatePeopleField } from '../lib/peopleSettingsStore.js'

const APPROVALS = { admin: true, approvals: true, updates: false }
const UPDATES = { admin: true, approvals: false, updates: true }

test('extracts addresses from an Outlook paste and ignores the names around them', () => {
  const { emails, invalid } = extractEmailAddresses(
    '"Smith, John" <John.Smith@LHSC.on.ca>; Doe, Jane <jane.doe@sjhc.london.on.ca>, mailto:team@lhsc.on.ca.'
  )
  assert.deepEqual(emails, ['john.smith@lhsc.on.ca', 'jane.doe@sjhc.london.on.ca', 'team@lhsc.on.ca'])
  assert.deepEqual(invalid, [])
})

test('reports typos instead of dropping them, and keeps apostrophes inside addresses', () => {
  const { emails, invalid } = extractEmailAddresses("mary.o'brien@lhsc.on.ca\njane@lhsc\nplain words")
  assert.deepEqual(emails, ["mary.o'brien@lhsc.on.ca"])
  assert.deepEqual(invalid, ['jane@lhsc'])
})

test('validates stored lists strictly, lowercasing and removing duplicates', () => {
  assert.equal(validateEmailList('a@b.ca').ok, false)
  const bad = validateEmailList(['good@lhsc.on.ca', 'not-an-email'])
  assert.equal(bad.ok, false)
  assert.match(bad.error, /not-an-email/)
  assert.deepEqual(validateEmailList([' A@LHSC.on.ca ', 'a@lhsc.on.ca']), { ok: true, emails: ['a@lhsc.on.ca'] })
  assert.equal(validateEmailList(['a@b.ca', 'c@d.ca'], { maxEmails: 1 }).ok, false)
})

test('compares lists regardless of order and case, and describes what changed', () => {
  assert.equal(sameEmailList(['B@x.ca', 'a@x.ca'], ['a@x.ca', 'b@x.ca']), true)
  assert.equal(sameEmailList(['a@x.ca'], ['a@x.ca', 'b@x.ca']), false)
  assert.deepEqual(describeEmailListChange(['a@x.ca', 'b@x.ca'], ['b@x.ca', 'c@x.ca']), {
    added: ['c@x.ca'],
    removed: ['a@x.ca'],
  })
})

test('an admin cannot remove themselves from the list that grants their access', () => {
  assert.match(findEditorLockout('approvalAdmins', ['other@lhsc.on.ca'], 'Me@lhsc.on.ca'), /can't remove your own address/)
  assert.equal(findEditorLockout('approvalAdmins', ['me@lhsc.on.ca'], 'Me@lhsc.on.ca'), null)
  assert.match(findEditorLockout('updateAdmins', [], 'me@lhsc.on.ca'), /update email admins/)
  assert.equal(findEditorLockout('coordinators', [], 'me@lhsc.on.ca'), null)
})

test('each group edits only its own settings', () => {
  assert.equal(canEditPeopleField(APPROVALS, 'approvalAdmins'), true)
  assert.equal(canEditPeopleField(APPROVALS, 'coordinators'), true)
  assert.equal(canEditPeopleField(APPROVALS, 'contactRouting'), true)
  assert.equal(canEditPeopleField(APPROVALS, 'updateAdmins'), false)
  assert.equal(canEditPeopleField(UPDATES, 'updateAdmins'), true)
  assert.equal(canEditPeopleField(UPDATES, 'approvalAdmins'), false)
  assert.equal(canEditPeopleField(UPDATES, 'replyToEmail'), false)
  assert.equal(canEditPeopleField(APPROVALS, 'unknownField'), false)
})

test('flags list members who cannot sign in because of their domain', () => {
  assert.deepEqual(
    findOutsideDomainEmails(['a@lhsc.on.ca', 'b@gmail.com', 'c@SJHC.london.on.ca'], ['lhsc.on.ca', 'sjhc.london.on.ca']),
    ['b@gmail.com']
  )
})

test('validates single and per-reason contact addresses', () => {
  assert.deepEqual(validateOptionalEmail('  '), { ok: true, email: '' })
  assert.equal(validateOptionalEmail('nope').ok, false)
  assert.equal(validateRoutingEmails({ referral: '' }).ok, false)
  assert.equal(validateRoutingEmails({ referral: 'bad' }).ok, false)
  assert.deepEqual(validateRoutingEmails({ referral: 'Ref@LHSC.on.ca' }), { ok: true, emails: { referral: 'ref@lhsc.on.ca' } })
})

test('the read model marks what the signed-in admin can edit and resolves sign-in domains', () => {
  const view = buildPeopleView(
    {
      settings: {
        _id: 'siteSettings',
        coordinatorDomain: 'lhsc.on.ca',
        approvalAdmins: ['Admin@LHSC.on.ca', 'admin@lhsc.on.ca', ''],
        updateAdmins: ['news@lhsc.on.ca'],
        testing: { enabled: true, recipients: ['t@lhsc.on.ca'] },
        digestPilot: { pilotMode: false, pilotRecipients: [] },
      },
      routing: {
        _id: 'contactRouting',
        options: [
          { key: 'referral', label: 'Referral', email: 'Ref@lhsc.on.ca' },
          { key: 'referral', label: 'Duplicate', email: 'dup@lhsc.on.ca' },
          { label: 'No key' },
        ],
      },
    },
    { access: UPDATES, serverPilotRecipients: ['env@lhsc.on.ca'] }
  )
  assert.deepEqual(view.lists.approvalAdmins, { emails: ['admin@lhsc.on.ca'], canEdit: false })
  assert.deepEqual(view.lists.updateAdmins, { emails: ['news@lhsc.on.ca'], canEdit: true })
  assert.deepEqual(view.signInDomains, ['lhsc.on.ca', 'sjhc.london.on.ca'])
  assert.deepEqual(view.contactRouting.options, [{ key: 'referral', label: 'Referral', email: 'ref@lhsc.on.ca' }])
  assert.equal(view.contactRouting.canEdit, false)
  assert.equal(view.testing.enabled, true)
  assert.equal(view.digestPilot.serverRecipientCount, 1)
})

// A fake Sanity client: `docs` maps document type to { published, draft }.
function createClient(docs, { mutateError } = {}) {
  const calls = { fetch: [], mutate: [] }
  return {
    calls,
    async fetch(query, params = {}) {
      calls.fetch.push({ query, params })
      const entry = docs[params.type]
      if (!entry?.published) return null
      return { ...entry.published, draft: entry.draft || null }
    },
    async mutate(mutations, options) {
      calls.mutate.push({ mutations, options })
      if (mutateError) throw mutateError
      return {}
    },
  }
}

const settingsDocs = () => ({
  siteSettings: {
    published: {
      _id: 'siteSettings',
      _rev: 'rev-published',
      studyApprovals: { coordinatorDomain: 'lhsc.on.ca', admins: ['me@lhsc.on.ca', 'old@lhsc.on.ca'], coordinatorEmails: [] },
    },
    draft: {
      _id: 'drafts.siteSettings',
      _rev: 'rev-draft',
      studyApprovals: { coordinatorDomain: 'lhsc.on.ca, example.org', admins: ['me@lhsc.on.ca', 'old@lhsc.on.ca'] },
    },
  },
})

test('refuses an edit outside the signed-in admin group before reading anything', async () => {
  const client = createClient(settingsDocs())
  await assert.rejects(
    updatePeopleField(client, { key: 'approvalAdmins', value: [], previous: [], access: UPDATES, editorEmail: 'me@lhsc.on.ca' }),
    (error) => error.statusCode === 403
  )
  assert.equal(client.calls.fetch.length, 0)
})

test('refuses to let an admin remove themselves', async () => {
  const client = createClient(settingsDocs())
  await assert.rejects(
    updatePeopleField(client, {
      key: 'approvalAdmins',
      value: ['old@lhsc.on.ca'],
      previous: ['me@lhsc.on.ca', 'old@lhsc.on.ca'],
      access: APPROVALS,
      editorEmail: 'me@lhsc.on.ca',
    }),
    (error) => error.statusCode === 400 && /own address/.test(error.message)
  )
  assert.equal(client.calls.mutate.length, 0)
})

test('reports a conflict when the list changed since the page loaded', async () => {
  const client = createClient(settingsDocs())
  await assert.rejects(
    updatePeopleField(client, {
      key: 'approvalAdmins',
      value: ['me@lhsc.on.ca', 'new@lhsc.on.ca'],
      previous: ['me@lhsc.on.ca'],
      access: APPROVALS,
      editorEmail: 'me@lhsc.on.ca',
    }),
    (error) => error.statusCode === 409
  )
  assert.equal(client.calls.mutate.length, 0)
})

test('writes the published document and the Studio draft, each guarded by its own revision', async () => {
  const client = createClient(settingsDocs())
  const result = await updatePeopleField(client, {
    key: 'approvalAdmins',
    value: ['me@lhsc.on.ca', 'New@LHSC.on.ca'],
    previous: ['old@lhsc.on.ca', 'me@lhsc.on.ca'],
    access: APPROVALS,
    editorEmail: 'ME@lhsc.on.ca',
  })

  assert.equal(result.changed, true)
  assert.equal(result.draftUpdated, true)
  assert.deepEqual(result.change, { added: ['new@lhsc.on.ca'], removed: ['old@lhsc.on.ca'] })
  const [{ mutations }] = client.calls.mutate
  assert.deepEqual(mutations, [
    {
      patch: {
        id: 'siteSettings',
        ifRevisionID: 'rev-published',
        set: { studyApprovals: { coordinatorDomain: 'lhsc.on.ca', admins: ['me@lhsc.on.ca', 'new@lhsc.on.ca'], coordinatorEmails: [] } },
      },
    },
    {
      patch: {
        id: 'drafts.siteSettings',
        ifRevisionID: 'rev-draft',
        // The draft keeps its own unpublished sibling edits.
        set: { studyApprovals: { coordinatorDomain: 'lhsc.on.ca, example.org', admins: ['me@lhsc.on.ca', 'new@lhsc.on.ca'] } },
      },
    },
  ])
})

test('creates a missing parent object and skips the draft when there is none', async () => {
  const client = createClient({
    siteSettings: { published: { _id: 'siteSettings', _rev: 'r1' } },
  })
  await updatePeopleField(client, {
    key: 'socialApprovers',
    value: ['social@lhsc.on.ca'],
    previous: [],
    access: APPROVALS,
    editorEmail: 'me@lhsc.on.ca',
  })
  assert.deepEqual(client.calls.mutate[0].mutations, [
    { patch: { id: 'siteSettings', ifRevisionID: 'r1', set: { socialPosting: { approverEmails: ['social@lhsc.on.ca'] } } } },
  ])
})

test('does not write when nothing changed', async () => {
  const client = createClient(settingsDocs())
  const result = await updatePeopleField(client, {
    key: 'approvalAdmins',
    value: ['OLD@lhsc.on.ca', 'me@lhsc.on.ca'],
    previous: ['me@lhsc.on.ca', 'old@lhsc.on.ca'],
    access: APPROVALS,
    editorEmail: 'me@lhsc.on.ca',
  })
  assert.equal(result.changed, false)
  assert.equal(client.calls.mutate.length, 0)
})

test('turns a revision mismatch at write time into a conflict', async () => {
  const error = Object.assign(new Error('Document revision does not match'), { statusCode: 409 })
  const client = createClient(settingsDocs(), { mutateError: error })
  await assert.rejects(
    updatePeopleField(client, {
      key: 'coordinators',
      value: ['coord@lhsc.on.ca'],
      previous: [],
      access: APPROVALS,
      editorEmail: 'me@lhsc.on.ca',
    }),
    (thrown) => thrown.statusCode === 409 && /Reload/.test(thrown.message)
  )
})

test('clears a single address when it is left blank', async () => {
  const client = createClient({
    siteSettings: { published: { _id: 'siteSettings', _rev: 'r1', replyToEmail: 'Replies@lhsc.on.ca' } },
  })
  await updatePeopleField(client, {
    key: 'replyToEmail',
    value: '',
    previous: 'replies@lhsc.on.ca',
    access: APPROVALS,
    editorEmail: 'me@lhsc.on.ca',
  })
  assert.deepEqual(client.calls.mutate[0].mutations, [
    { patch: { id: 'siteSettings', ifRevisionID: 'r1', unset: ['replyToEmail'] } },
  ])
})

test('rewrites only the contact reasons whose address changed, in the draft as well', async () => {
  const client = createClient({
    contactRouting: {
      published: {
        _id: 'contactRouting',
        _rev: 'r1',
        options: [
          { _key: 'a', key: 'referral', label: 'Referral', email: 'Ref@lhsc.on.ca' },
          { _key: 'b', key: 'training', label: 'Training', email: 'train@lhsc.on.ca' },
        ],
      },
      draft: {
        _id: 'drafts.contactRouting',
        _rev: 'r2',
        options: [
          { _key: 'a', key: 'referral', label: 'Referral (edited)', email: 'Ref@lhsc.on.ca' },
          { _key: 'b', key: 'training', label: 'Training', email: 'train@lhsc.on.ca' },
          { _key: 'c', key: 'donation', label: 'Donation', email: 'give@lhsc.on.ca' },
        ],
      },
    },
  })
  const result = await updatePeopleField(client, {
    key: 'contactRouting',
    value: { referral: 'ref@lhsc.on.ca', training: 'learn@lhsc.on.ca' },
    previous: { referral: 'ref@lhsc.on.ca', training: 'train@lhsc.on.ca' },
    access: APPROVALS,
    editorEmail: 'me@lhsc.on.ca',
  })

  assert.deepEqual(result.change, { changed: [{ key: 'training', from: 'train@lhsc.on.ca', to: 'learn@lhsc.on.ca' }] })
  const [published, draft] = client.calls.mutate[0].mutations
  assert.equal(published.patch.ifRevisionID, 'r1')
  assert.deepEqual(published.patch.set.options.map((option) => option.email), ['Ref@lhsc.on.ca', 'learn@lhsc.on.ca'])
  assert.equal(draft.patch.ifRevisionID, 'r2')
  assert.deepEqual(draft.patch.set.options.map((option) => [option.label, option.email]), [
    ['Referral (edited)', 'Ref@lhsc.on.ca'],
    ['Training', 'learn@lhsc.on.ca'],
    ['Donation', 'give@lhsc.on.ca'],
  ])
})

test('reports a conflict when a contact reason is missing or changed since the page loaded', async () => {
  const docs = {
    contactRouting: {
      published: { _id: 'contactRouting', _rev: 'r1', options: [{ key: 'referral', email: 'ref@lhsc.on.ca' }] },
    },
  }
  await assert.rejects(
    updatePeopleField(createClient(docs), {
      key: 'contactRouting',
      value: { gone: 'x@lhsc.on.ca' },
      previous: { gone: 'x@lhsc.on.ca' },
      access: APPROVALS,
    }),
    (error) => error.statusCode === 409
  )
  await assert.rejects(
    updatePeopleField(createClient(docs), {
      key: 'contactRouting',
      value: { referral: 'new@lhsc.on.ca' },
      previous: { referral: 'someone-else@lhsc.on.ca' },
      access: APPROVALS,
    }),
    (error) => error.statusCode === 409
  )
})
