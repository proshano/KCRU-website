import assert from 'node:assert/strict'
import test from 'node:test'

import {
  CLASSIFICATION_AXES,
  METHODOLOGICAL_FOCUS_TAGS,
  STUDY_DESIGN_TAGS,
  TOPIC_TAGS,
  applyClassificationPrecedence,
  enforceCanonicalCategories,
} from '../lib/classificationTaxonomy.js'

test('taxonomy axes expose every canonical tag exactly once', () => {
  const all = CLASSIFICATION_AXES.flatMap((axis) => axis.tags)
  assert.equal(all.length, TOPIC_TAGS.size + STUDY_DESIGN_TAGS.size + METHODOLOGICAL_FOCUS_TAGS.size)
  assert.equal(new Set(all).size, all.length)
  assert.deepEqual(CLASSIFICATION_AXES.map((axis) => axis.key), ['topics', 'studyDesign', 'methodologicalFocus'])
})

test('enforceCanonicalCategories moves misplaced tags and drops unknown ones', () => {
  const cleaned = enforceCanonicalCategories({
    topics: ['Observational Study', 'Hemodialysis', 'Made Up'],
    studyDesign: ['Survey Research'],
    methodologicalFocus: ['Acute Kidney Injury'],
    exclude: 'true',
  })
  assert.deepEqual(cleaned, {
    topics: ['Hemodialysis', 'Acute Kidney Injury'],
    studyDesign: ['Observational Study'],
    methodologicalFocus: ['Survey Research'],
    exclude: false,
  })
})

test('precedence drops general CKD when a specific cause or modality tag is present', () => {
  const result = applyClassificationPrecedence({
    topics: ['Chronic Kidney Disease', 'Glomerular Disease'],
    studyDesign: ['Observational Study'],
    methodologicalFocus: [],
    exclude: false,
  })
  assert.deepEqual(result.topics, ['Glomerular Disease'])
})

test('precedence keeps general CKD when no superseding topic is present', () => {
  const result = applyClassificationPrecedence({
    topics: ['Chronic Kidney Disease', 'Acute Kidney Injury', 'Cardiovascular Disease'],
    studyDesign: [],
    methodologicalFocus: [],
    exclude: false,
  })
  assert.deepEqual(result.topics, ['Chronic Kidney Disease', 'Acute Kidney Injury', 'Cardiovascular Disease'])
})

test('precedence treats survey research as an observational design', () => {
  const result = applyClassificationPrecedence({
    topics: [],
    studyDesign: ['Qualitative Study'],
    methodologicalFocus: ['Survey Research'],
    exclude: false,
  })
  assert.deepEqual(result.studyDesign, ['Qualitative Study', 'Observational Study'])
  assert.deepEqual(result.methodologicalFocus, ['Survey Research'])
})
