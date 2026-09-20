import assert from 'node:assert/strict'
import test from 'node:test'

import {
  isPublicationCorrectionNotice,
  isPublicationCorrespondence,
  isPublicationExcluded,
  isPublicationExcludedByRule,
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

test('excludes letter replies and comment pieces that PubMed indexes without an abstract', () => {
  // Lancet authors' reply: Letter + Comment, no abstract.
  assert.equal(
    isPublicationExcluded({
      title: "Can haemodynamic effects be resumed to systolic arterial pressure? - Authors' reply.",
      publicationTypes: ['Letter', 'Comment'],
      abstract: '',
    }),
    true
  )

  // JAMA Internal Medicine letter to the editor: Journal Article + Comment, no abstract.
  assert.equal(
    isPublicationCorrespondence({
      title: 'Integrating Specialist and Primary Care in Chronic Disease Management.',
      publicationTypes: ['Journal Article', 'Comment'],
      abstract: null,
    }),
    true
  )

  // Editorial written about one specific paper: Editorial + Comment, no abstract.
  assert.equal(
    isPublicationCorrespondence({
      title: 'Reviewing the Evidence of the Association Between Baclofen and Encephalopathy.',
      publicationTypes: ['Editorial', 'Comment'],
    }),
    true
  )
})

test('publisher body text saved by the DOI backfill does not count as an abstract', () => {
  assert.equal(
    isPublicationCorrespondence({
      title: 'Continuation of Tumor Necrosis Factor Antagonists for Inflammatory Bowel Diseases During Pregnancy.',
      publicationTypes: ['Journal Article', 'Comment'],
      abstract: 'We read with interest the article by ... '.repeat(40),
      abstractContentType: 'article_body',
    }),
    true
  )
})

test('keeps comment pieces that carry a real abstract', () => {
  assert.equal(
    isPublicationExcluded({
      title: 'TIPS to decide whether to prescribe aspirin for the primary prevention of cardiovascular events in chronic kidney disease.',
      publicationTypes: ['Journal Article', 'Comment'],
      abstract: 'Aspirin effectively prevents subsequent cardiovascular events. A post hoc subgroup analysis of the International Polycap Study 3 (TIPS-3) trial suggests that patients with chronic kidney disease might also benefit from aspirin for primary prevention.',
      abstractContentType: 'abstract',
    }),
    false
  )

  // Older cached rows have no abstractContentType; PubMed abstract text still counts.
  assert.equal(
    isPublicationCorrespondence({
      title: 'Improving the management of chronic kidney disease in primary care by enhancing laboratory reports.',
      publicationTypes: ['Journal Article', 'Comment'],
      abstract: 'Identifying people at risk for progressive chronic kidney disease and connecting them with recommended care is crucial.',
    }),
    false
  )
})

test('keeps research letters that PubMed types as Letter without Comment', () => {
  assert.equal(
    isPublicationExcluded({
      title: 'Association of Blood Mitochondrial DNA Copy Number With Risk of Acute Kidney Injury After Cardiac Surgery.',
      publicationTypes: ['Letter'],
      abstract: '',
    }),
    false
  )

  assert.equal(
    isPublicationExcluded({
      title: 'Long-Term Risk of Major Coronary Artery Disease Events After Thrombotic Microangiopathy Treated With Plasma Exchange.',
      publicationTypes: ['Letter'],
      abstract: 'Background text extracted from the publisher page. '.repeat(20),
      abstractContentType: 'article_body',
    }),
    false
  )
})

test('recognizes reply titles before MEDLINE adds the Comment type', () => {
  const replies = [
    'Reply to: Sodium bicarbonate and kidney outcomes.',
    'Reply.',
    'In Reply.',
    "Authors' Reply to Smith et al.",
    'Author response to "Timing of dialysis initiation".',
    'Response to the letter by Dr. Jones regarding potassium binders.',
    'Response to: Fluid balance in critically ill patients.',
    'Re: Hemodiafiltration versus hemodialysis.',
    'Letter to the Editor: Statins after kidney transplantation.',
    'Comment on "Perioperative aspirin in noncardiac surgery".',
    'Dapagliflozin in patients with chronic kidney disease - Authors’ reply.',
    'Anticoagulation in dialysis: response.',
  ]
  for (const title of replies) {
    assert.equal(
      isPublicationExcludedByRule({ title, publicationTypes: ['Journal Article'] }),
      true,
      title
    )
  }
})

test('does not mistake substantive titles for correspondence', () => {
  const substantive = [
    'Response to erythropoietin in hemodialysis patients: a cohort study.',
    'Replying to patient concerns about living kidney donation: a qualitative study.',
    'Re-evaluating the role of ultrafiltration rate in hemodialysis outcomes.',
    'Response to treatment and long-term outcomes in lupus nephritis.',
    'Comments from patients about dialysis scheduling: a survey.',
    'Correction of anemia in chronic kidney disease.',
  ]
  for (const title of substantive) {
    assert.equal(
      isPublicationExcludedByRule({ title, publicationTypes: ['Journal Article'], abstract: 'A study abstract.' }),
      false,
      title
    )
  }
})
