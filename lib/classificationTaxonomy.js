/**
 * Canonical publication classification taxonomy.
 *
 * This module is intentionally free of server-only imports so it can run in the browser
 * (the classification evaluation page re-derives tags from stored probabilities when the
 * reviewer moves a threshold) as well as in lib/ and scripts/.
 *
 * The prose criteria for each tag live in lib/classificationPrompt.js; the lists here are
 * the source of truth for which tag names exist on each axis.
 */

export const TOPIC_TAGS = new Set([
  'Perioperative and Surgery',
  'Hemodialysis',
  'Dialysis Vascular Access',
  'Peritoneal Dialysis',
  'Genetic Kidney Disease',
  'Kidney Transplantation',
  'Drug Safety',
  'Drug Dosing and Metabolism',
  'Acute Kidney Injury',
  'Glomerular Disease',
  'Diabetes and Metabolism',
  'Chronic Kidney Disease',
  'Obesity',
  'Hypertension',
  'Cardiovascular Disease',
  'Bone Health',
  'Kidney Disease in Cancer',
  'Health Systems',
  'Remote Monitoring and Care',
  'Clinical Decision Support',
  'Education',
  'Research Ethics',
])

export const STUDY_DESIGN_TAGS = new Set([
  'Interventional Study',
  'Observational Study',
  'Systematic Evidence Synthesis',
  'Narrative Review',
  'Clinical Practice Guideline',
  'Qualitative Study',
  'Case Report / Case Series',
  'Commentary / Editorial',
])

export const METHODOLOGICAL_FOCUS_TAGS = new Set([
  'Pragmatic Trial',
  'Innovation in Study Design or Analysis',
  'Research Automation',
  'Health Economics',
  'Biomarker Development or Validation',
  'Diagnostic Accuracy',
  'Advanced Imaging',
  'Genomics / Genetic Testing',
  'Machine Learning / AI',
  'Administrative Data',
  'Survey Research',
  'Consensus Methods',
  'Patient-Reported Outcomes',
  'Risk Estimation and Prognosis',
  'Preclinical',
])

/**
 * The three multi-label axes. `key` is the property name used on classification objects
 * throughout lib/ (`topics`, `studyDesign`, `methodologicalFocus`); `guidance` is the
 * axis-level instruction from the classification prompt, restated for a per-tag question.
 */
export const CLASSIFICATION_AXES = Object.freeze([
  Object.freeze({
    key: 'topics',
    label: 'Topic',
    tags: Object.freeze([...TOPIC_TAGS]),
    guidance:
      'Topics name the clinical disease area or healthcare-delivery problem the publication focuses on. ' +
      'A publication that is primarily about research methodology, trial design, reporting standards, ' +
      'estimands or statistical frameworks, with no clinical disease focus, carries no topic tags.',
  }),
  Object.freeze({
    key: 'studyDesign',
    label: 'Study Design',
    tags: Object.freeze([...STUDY_DESIGN_TAGS]),
    guidance:
      'Study design describes what the investigators did. More than one design can apply to a single ' +
      'publication, and none applies when no design tag fits.',
  }),
  Object.freeze({
    key: 'methodologicalFocus',
    label: 'Methodological Focus',
    tags: Object.freeze([...METHODOLOGICAL_FOCUS_TAGS]),
    guidance: 'Only tag a methodological focus when that method is central to the paper.',
  }),
])

export const CLASSIFICATION_AXIS_KEYS = Object.freeze(CLASSIFICATION_AXES.map((axis) => axis.key))

/**
 * Enforce canonical category assignments - move misplaced tags to their correct axis and drop
 * tags that belong to none. Unknown tags are silently dropped.
 */
export function enforceCanonicalCategories(classification) {
  const { topics = [], studyDesign = [], methodologicalFocus = [], exclude = false } = classification || {}

  const allTags = [...topics, ...studyDesign, ...methodologicalFocus]

  const cleanTopics = new Set()
  const cleanStudyDesign = new Set()
  const cleanMethodologicalFocus = new Set()

  for (const tag of allTags) {
    if (TOPIC_TAGS.has(tag)) {
      cleanTopics.add(tag)
    } else if (STUDY_DESIGN_TAGS.has(tag)) {
      cleanStudyDesign.add(tag)
    } else if (METHODOLOGICAL_FOCUS_TAGS.has(tag)) {
      cleanMethodologicalFocus.add(tag)
    }
  }

  return {
    topics: Array.from(cleanTopics),
    studyDesign: Array.from(cleanStudyDesign),
    methodologicalFocus: Array.from(cleanMethodologicalFocus),
    exclude: exclude === true,
  }
}

// Topic tags that name a specific cause of kidney disease or a treatment modality. The
// classification prompt tells the model not to use the general "Chronic Kidney Disease" tag
// when one of these fits; a per-tag decision model answers each tag in isolation, so the
// rule has to be applied here instead.
export const CKD_SUPERSEDING_TOPICS = Object.freeze([
  'Glomerular Disease',
  'Genetic Kidney Disease',
  'Diabetes and Metabolism',
  'Hemodialysis',
  'Peritoneal Dialysis',
  'Dialysis Vascular Access',
  'Kidney Transplantation',
])

/**
 * Cross-tag precedence rules stated in the classification prompt, applied in code.
 *
 * The chat-model path relies on the model reading the whole taxonomy and honouring these
 * itself. A decision model such as Jev scores every tag independently against the same
 * publication, so nothing stops it from returning both the general and the specific tag;
 * these rules resolve that deterministically. Each rule quotes the prompt text it enforces.
 */
export function applyClassificationPrecedence(classification) {
  const topics = new Set(classification?.topics || [])
  const studyDesign = new Set(classification?.studyDesign || [])
  const methodologicalFocus = new Set(classification?.methodologicalFocus || [])

  // "Chronic Kidney Disease ... Do NOT use if the study focuses on a specific cause (e.g.,
  // Glomerular Disease, Genetic Kidney Disease, Diabetic Kidney Disease) or treatment modality
  // (e.g., Hemodialysis, Transplantation) covered by another tag."
  if (topics.has('Chronic Kidney Disease') && CKD_SUPERSEDING_TOPICS.some((tag) => topics.has(tag))) {
    topics.delete('Chronic Kidney Disease')
  }

  // "For surveys, select 'Observational Study'. Do NOT use 'Survey Research' as a Study Design
  // tag (use it in Methodological Focus instead)."
  if (methodologicalFocus.has('Survey Research')) {
    studyDesign.add('Observational Study')
  }

  return {
    topics: [...topics],
    studyDesign: [...studyDesign],
    methodologicalFocus: [...methodologicalFocus],
    exclude: classification?.exclude === true,
  }
}
