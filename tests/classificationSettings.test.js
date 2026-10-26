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
    decisionModel: 'jev',
    thresholds: {},
    thresholdsSource: null,
    thresholdsUpdatedAt: null,
    thresholdsDecisionModel: null,
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
  assert.equal(resolved.decisionModel, 'jev')
  assert.deepEqual(resolved.thresholds, { topics: 0.7, studyDesign: 1 })
  assert.equal(resolved.thresholdsSource, 'run 1')
  // Thresholds applied before the model choice existed were tuned on Jev.
  assert.equal(resolved.thresholdsDecisionModel, 'jev')

  const luna = resolvePublicationClassificationSettings({
    publicationClassification: {
      backend: 'jev',
      decisionModel: 'gpt-6-luna-decisions',
      thresholdsUpdatedAt: '2026-10-26T00:00:00.000Z',
      thresholdsDecisionModel: 'gpt-6-luna-decisions',
    },
  })
  assert.equal(luna.decisionModel, 'gpt-6-luna-decisions')
  assert.equal(luna.thresholdsDecisionModel, 'gpt-6-luna-decisions')
  assert.equal(resolvePublicationClassificationSettings({ publicationClassification: { decisionModel: 'unknown' } }).decisionModel, 'jev')
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

test('switching the decision model is stamped like switching the classifier', () => {
  const now = new Date('2026-10-26T12:00:00.000Z')
  const current = { backend: 'jev', backendUpdatedAt: '2026-10-01T00:00:00.000Z', backendUpdatedBy: 'old@x.y' }

  const switched = buildPublicationClassificationPatch({ decisionModel: 'gpt-6-luna-decisions', backendUpdatedBy: 'a@b.c' }, current, { now })
  assert.deepEqual(switched, {
    backend: 'jev',
    decisionModel: 'gpt-6-luna-decisions',
    backendUpdatedAt: '2026-10-26T12:00:00.000Z',
    backendUpdatedBy: 'a@b.c',
  })

  // A document with no decisionModel is on Jev, so choosing Jev changes nothing worth stamping.
  const same = buildPublicationClassificationPatch({ decisionModel: 'jev', backendUpdatedBy: 'a@b.c' }, current, { now })
  assert.equal(same.backendUpdatedAt, current.backendUpdatedAt)
  assert.equal(same.decisionModel, 'jev')
})

test('thresholds record the decision model of the run they came from', () => {
  const now = new Date('2026-10-26T12:00:00.000Z')
  const current = { backend: 'jev', jevThresholdTopics: 0.5, thresholdsDecisionModel: 'jev' }

  const fromLuna = buildPublicationClassificationPatch(
    { thresholds: { topics: 0.4 }, thresholdsSource: 'run 3', thresholdsDecisionModel: 'gpt-6-luna-decisions' },
    current,
    { now }
  )
  assert.equal(fromLuna.thresholdsDecisionModel, 'gpt-6-luna-decisions')
  assert.equal(resolvePublicationClassificationSettings({ publicationClassification: fromLuna }).thresholdsDecisionModel, 'gpt-6-luna-decisions')

  // Thresholds saved without a model drop the old one rather than keep a stale record.
  const unknown = buildPublicationClassificationPatch({ thresholds: { topics: 0.6 } }, fromLuna, { now })
  assert.equal('thresholdsDecisionModel' in unknown, false)
})
