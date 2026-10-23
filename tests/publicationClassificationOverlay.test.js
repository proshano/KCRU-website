import assert from 'node:assert/strict'
import test from 'node:test'

import {
  applyPublicationClassificationOverlay,
  buildClassificationMap,
  classificationIdentity,
  classificationLookupParams,
  lookupClassification,
} from '../lib/publicationClassificationOverlay.js'

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

test('classification overlay keeps PubMed correction notices excluded', () => {
  const publication = {
    pmid: '36757471',
    title: 'Correction: Impact of renal-replacement therapy strategies on outcomes for patients with chronic kidney disease.',
    publicationTypes: ['Published Erratum'],
    exclude: false,
  }

  const classification = {
    topics: [],
    studyDesign: [],
    methodologicalFocus: [],
    exclude: false,
  }

  assert.deepEqual(applyPublicationClassificationOverlay(publication, classification), {
    pmid: '36757471',
    title: 'Correction: Impact of renal-replacement therapy strategies on outcomes for patients with chronic kidney disease.',
    publicationTypes: ['Published Erratum'],
    topics: [],
    studyDesign: [],
    methodologicalFocus: [],
    exclude: true,
  })
})

test('classification identity is the PMID when there is one and the publication key otherwise', () => {
  assert.equal(classificationIdentity({ pmid: 42637175, doi: '10.1053/j.ajkd.2026.01.001' }), '42637175')
  assert.equal(classificationIdentity({ doi: 'https://doi.org/10.1001/JAMA.2026.21737' }), 'doi:10.1001/jama.2026.21737')
  assert.equal(classificationIdentity({ title: 'no identifiers' }), '')
  assert.deepEqual(
    classificationLookupParams([{ pmid: '1', doi: '10.1000/a' }, { doi: '10.1000/b' }, { pmid: '1' }, {}]),
    { pmids: ['1'], keys: ['doi:10.1000/a', 'doi:10.1000/b', 'pmid:1'] }
  )
})

test('stored classifications are found by PMID first and by publication key for DOI-only papers', () => {
  const docs = [
    { pmid: '1', publicationKey: 'doi:10.1000/a', topics: ['Hypertension'] },
    { publicationKey: 'doi:10.1000/b', topics: ['Living Kidney Donation'] },
    { pmid: 3, topics: ['Hemodialysis'] },
  ]
  const map = buildClassificationMap(docs, (d) => d.topics)
  assert.deepEqual(lookupClassification(map, { pmid: '1' }), ['Hypertension'])
  assert.deepEqual(lookupClassification(map, { doi: '10.1000/a' }), ['Hypertension'])
  assert.deepEqual(lookupClassification(map, { doi: '10.1000/B', title: 'DOI-only paper' }), ['Living Kidney Donation'])
  assert.deepEqual(lookupClassification(map, { pmid: 3 }), ['Hemodialysis'])
  assert.equal(lookupClassification(map, { doi: '10.1000/zzz' }), undefined)
  assert.equal(lookupClassification(new Map(), { pmid: '1' }), undefined)
})
