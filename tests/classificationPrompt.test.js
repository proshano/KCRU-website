import assert from 'node:assert/strict'
import test from 'node:test'

import { DEFAULT_CLASSIFICATION_PROMPT } from '../lib/classificationPrompt.js'

test('classification prompt distinguishes research methods frameworks from clinical guidelines', () => {
  assert.match(DEFAULT_CLASSIFICATION_PROMPT, /Research Methods Frameworks/)
  assert.match(DEFAULT_CLASSIFICATION_PROMPT, /do \*\*not\*\* classify it as "Clinical Practice Guideline"/i)
  assert.match(DEFAULT_CLASSIFICATION_PROMPT, /do \*\*not\*\* classify it as "Health Systems"/i)
})

test('classification prompt includes the CRT estimands example with intended tags', () => {
  assert.match(DEFAULT_CLASSIFICATION_PROMPT, /CRT-Estimands Framework/)
  assert.match(DEFAULT_CLASSIFICATION_PROMPT, /"topics": \[\]/)
  assert.match(DEFAULT_CLASSIFICATION_PROMPT, /"study_design": \[\]/)
  assert.match(
    DEFAULT_CLASSIFICATION_PROMPT,
    /"methodological_focus": \["Consensus Methods", "Innovation in Study Design or Analysis"\]/
  )
})

test('classification prompt does not use commentary as the fallback for missing abstracts', () => {
  assert.match(DEFAULT_CLASSIFICATION_PROMPT, /\*\*Do NOT use\*\* merely because PubMed has no abstract/i)
  assert.match(DEFAULT_CLASSIFICATION_PROMPT, /Use an empty `study_design` array when no study-design tag fits/)
})
