import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildPublicationClassificationPatch,
  normalizeClassificationBackend,
  resolvePublicationClassificationSettings,
} from '../lib/classificationSettings.js'

test('classification settings default to the chat backend with no thresholds set', () => {
  assert.deepEqual(resolvePublicationClassificationSettings(undefined), {
    backend: 'chat',
    backendUpdatedAt: null,
    backendUpdatedBy: null,
    thresholds: {},
    thresholdsSource: null,
    thresholdsUpdatedAt: null,
  })
  assert.equal(normalizeClassificationBackend('JEV'), 'jev')
  assert.equal(normalizeClassificationBackend('gpt'), 'chat')
})

test('classification settings read and clamp the Sanity block', () => {
  const resolved = resolvePublicationClassificationSettings({
    publicationClassification: {
      backend: 'jev',
      jevThresholdTopics: 0.7,
      jevThresholdStudyDesign: 1.4,
      jevThresholdMethodologicalFocus: 'abc',
      jevThresholdExclude: null,
      thresholdsSource: 'run 1',
      thresholdsUpdatedAt: '2026-09-19T00:00:00.000Z',
    },
  })
  assert.equal(resolved.backend, 'jev')
  assert.deepEqual(resolved.thresholds, { topics: 0.7, studyDesign: 1 })
  assert.equal(resolved.thresholdsSource, 'run 1')
})

test('classification settings patch changes only what was supplied', () => {
  const now = new Date('2026-09-19T12:00:00.000Z')
  const current = { backend: 'chat', jevThresholdTopics: 0.5, thresholdsSource: 'old' }

  const thresholdsOnly = buildPublicationClassificationPatch(
    { thresholds: { topics: 0.65, exclude: 0.8, studyDesign: 'nope' }, thresholdsSource: 'run 2' },
    current,
    { now }
  )
  assert.deepEqual(thresholdsOnly, {
    backend: 'chat',
    jevThresholdTopics: 0.65,
    jevThresholdExclude: 0.8,
    thresholdsSource: 'run 2',
    thresholdsUpdatedAt: '2026-09-19T12:00:00.000Z',
  })

  const backendOnly = buildPublicationClassificationPatch({ backend: 'jev', backendUpdatedBy: 'a@b.c' }, current, { now })
  assert.deepEqual(backendOnly, {
    backend: 'jev',
    backendUpdatedAt: '2026-09-19T12:00:00.000Z',
    backendUpdatedBy: 'a@b.c',
    jevThresholdTopics: 0.5,
    thresholdsSource: 'old',
  })

  // Re-saving the same backend does not re-stamp it.
  const sameBackend = buildPublicationClassificationPatch({ backend: 'chat', backendUpdatedBy: 'x@y.z' }, current, { now })
  assert.deepEqual(sameBackend, current)

  const nothing = buildPublicationClassificationPatch({ thresholds: { topics: 'x' } }, current, { now })
  assert.deepEqual(nothing, current)
})
