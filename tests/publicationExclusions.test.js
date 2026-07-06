import assert from 'node:assert/strict'
import test from 'node:test'

import {
  isPublicationCorrectionNotice,
  isPublicationExcluded,
  normalizePublicationTypes,
} from '../lib/publicationExclusions.js'

test('normalizes PubMed publication type arrays', () => {
  assert.deepEqual(
    normalizePublicationTypes(['Published Erratum', ' published erratum ', '', 'Journal Article']),
    ['Published Erratum', 'Journal Article']
  )
})

test('excludes PubMed published errata', () => {
  assert.equal(
    isPublicationExcluded({
      title: 'Clinical management and burden of cytomegalovirus in kidney transplant recipients.',
      publicationTypes: ['Published Erratum'],
    }),
    true
  )
})

test('excludes correction-title notices from older cached rows', () => {
  assert.equal(
    isPublicationCorrectionNotice({
      title: 'Author Correction: Intravital microscopic observation of the microvasculature during hemodialysis in healthy rats.',
    }),
    true
  )

  assert.equal(
    isPublicationCorrectionNotice({
      title: 'Correction: Impact of renal-replacement therapy strategies on outcomes for patients with chronic kidney disease.',
    }),
    true
  )

  assert.equal(
    isPublicationCorrectionNotice({
      title: 'Corrigendum to "Adenosine deaminase acting on RNA 1 and receptor-interacting serine/threonine-protein kinase-1 orchestrate the Z-DNA-binding protein 1-mediated PANoptosis and mouse heart transplant rejection" [American Journal of Transplantation Volume 26, Issue 5, May 2026, Pages 962-979].',
    }),
    true
  )
})

test('does not exclude substantive papers that discuss correction as a concept', () => {
  assert.equal(
    isPublicationCorrectionNotice({
      title: 'Correction of anemia in chronic kidney disease.',
      publicationTypes: ['Journal Article'],
    }),
    false
  )
})
