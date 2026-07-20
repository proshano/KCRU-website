import assert from 'node:assert/strict'
import test from 'node:test'

import { CORRESPONDENCE_OPTIONS } from '../lib/communicationOptions.js'
import { buildResearchDigestEmail } from '../lib/researchDigestEmailTemplate.js'
import {
  getPublicCorrespondenceOptions,
  isResearchDigestPublicEnabled,
} from '../lib/researchDigestPublic.js'

test('research digest public visibility fails closed', () => {
  assert.equal(isResearchDigestPublicEnabled({}), false)
  assert.equal(isResearchDigestPublicEnabled({ researchDigest: { publicEnabled: false } }), false)
  assert.equal(isResearchDigestPublicEnabled({ researchDigest: { publicEnabled: true } }), true)
})

test('hides the research digest from public subscription choices until launch', () => {
  const hidden = getPublicCorrespondenceOptions(CORRESPONDENCE_OPTIONS, {})
  const visible = getPublicCorrespondenceOptions(CORRESPONDENCE_OPTIONS, {
    researchDigest: { publicEnabled: true },
  })

  assert.deepEqual(hidden.map((option) => option.value), ['newsletter', 'study_updates'])
  assert.deepEqual(visible, CORRESPONDENCE_OPTIONS)
})

test('private pilot emails do not link to the hidden public digest archive', () => {
  const baseInput = {
    subscriber: { name: 'Test recipient', manageToken: 'token' },
    issue: { date: '2026-07-19', slug: '2026-07-19' },
    papers: [],
    opportunities: [],
    siteBaseUrl: 'https://www.kcru.ca',
  }
  const privateEmail = buildResearchDigestEmail({
    ...baseInput,
    settings: { publicEnabled: false },
  })
  const publicEmail = buildResearchDigestEmail({
    ...baseInput,
    settings: { publicEnabled: true },
  })

  assert.doesNotMatch(privateEmail.text, /Read online:/)
  assert.doesNotMatch(privateEmail.html, /Read this digest online/)
  assert.match(publicEmail.text, /research-digest\/2026-07-19/)
  assert.match(publicEmail.html, /Read this digest online/)
})
