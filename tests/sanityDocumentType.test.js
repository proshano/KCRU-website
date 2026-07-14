import assert from 'node:assert/strict'
import test from 'node:test'

import { requireSanityDocumentType } from '../lib/sanityDocumentType.js'

test('accepts a document only when its id and type match', async () => {
  const calls = []
  const document = await requireSanityDocumentType({
    fetch: async (query, params) => {
      calls.push({ query, params })
      return { _id: 'paper-1', _type: 'researchDigestPaper' }
    },
    id: 'paper-1',
    expectedType: 'researchDigestPaper',
    label: 'Paper',
  })

  assert.equal(document._id, 'paper-1')
  assert.deepEqual(calls[0].params, { id: 'paper-1' })
})

test('rejects a caller-selected id that resolves to another document type', async () => {
  await assert.rejects(
    requireSanityDocumentType({
      fetch: async () => ({ _id: 'settings', _type: 'siteSettings' }),
      id: 'settings',
      expectedType: 'researchDigestPaper',
      label: 'Paper',
    }),
    (error) => error.statusCode === 400 && /does not reference/.test(error.message)
  )
})

test('rejects missing target documents', async () => {
  await assert.rejects(
    requireSanityDocumentType({
      fetch: async () => null,
      id: 'missing',
      expectedType: 'trialSummary',
      label: 'Study',
    }),
    (error) => error.statusCode === 404 && /not found/.test(error.message)
  )
})
