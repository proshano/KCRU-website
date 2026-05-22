import assert from 'node:assert/strict'
import test from 'node:test'

import { applyPublicationClassificationOverlay } from '../lib/publicationClassificationOverlay.js'

test('classification overlay clears stale cached tags when the classification has empty arrays', () => {
  const publication = {
    pmid: '42167774',
    topics: ['Health Systems'],
    studyDesign: ['Commentary / Editorial'],
    methodologicalFocus: ['Innovation in Study Design or Analysis'],
    exclude: false,
  }

  const classification = {
    topics: [],
    studyDesign: [],
    methodologicalFocus: ['Consensus Methods', 'Innovation in Study Design or Analysis'],
    exclude: false,
  }

  assert.deepEqual(applyPublicationClassificationOverlay(publication, classification), {
    pmid: '42167774',
    topics: [],
    studyDesign: [],
    methodologicalFocus: ['Consensus Methods', 'Innovation in Study Design or Analysis'],
    exclude: false,
  })
})

test('classification overlay preserves cached tags when a field is absent from the classification', () => {
  const publication = {
    pmid: '1',
    topics: ['Chronic Kidney Disease'],
    studyDesign: ['Observational Study'],
    methodologicalFocus: ['Administrative Data'],
  }

  const classification = {
    methodologicalFocus: [],
  }

  assert.deepEqual(applyPublicationClassificationOverlay(publication, classification), {
    pmid: '1',
    topics: ['Chronic Kidney Disease'],
    studyDesign: ['Observational Study'],
    methodologicalFocus: [],
  })
})
