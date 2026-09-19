import { DEFAULT_CLASSIFICATION_PROMPT } from './classificationPrompt.js'
import { CLASSIFICATION_AXES } from './classificationTaxonomy.js'
import { callJevSystemOne, describeJevConfig } from './jevClient.js'
import { DEFAULT_JEV_THRESHOLDS, deriveClassificationFromProbabilities, normalizeJevThresholds } from './jevDecisions.js'

/**
 * Publication classification with Jev, TypeSafe's decision model.
 *
 * The chat-model path (classifyPublication in lib/summaries.js) sends the whole taxonomy as a
 * prompt and asks for reasoning plus JSON. Jev instead answers one yes/no ("noul") question
 * per tag, all in a single request, and returns a calibrated probability for each. That gives
 * three things the chat path cannot: a confidence per tag, no JSON-parsing failure mode, and
 * thresholds that can be tuned from labelled data instead of prompt prose.
 *
 * The question for each tag reuses the criteria text from the classification prompt's
 * taxonomy tables, so the two systems describe every tag in the same words. Cross-tag rules
 * the prompt states in prose (CKD-general vs a specific cause, surveys are observational)
 * are applied in code afterwards - see applyClassificationPrecedence.
 */

// Article-body fallbacks can be tens of thousands of characters; abstracts are far shorter.
// Jev's per-request budget is generous, but the point of the cut is keeping cost and latency
// predictable for a decision that an abstract-sized excerpt answers.
export const JEV_MAX_ABSTRACT_CHARS = Number(process.env.JEV_MAX_ABSTRACT_CHARS || 8000)

const QUESTION_PREFIX = Object.freeze({
  topics: 't',
  studyDesign: 'd',
  methodologicalFocus: 'm',
})

export const JEV_EXCLUDE_QUESTION = 'exclude'

/**
 * Pull `| **Tag** | criteria |` rows out of the classification prompt's taxonomy tables.
 * Markdown emphasis is stripped; backticks become quotes.
 */
export function parseTaxonomyCriteria(prompt = DEFAULT_CLASSIFICATION_PROMPT) {
  const criteria = new Map()
  for (const line of String(prompt || '').split('\n')) {
    const match = line.match(/^\|\s*\*\*(.+?)\*\*\s*\|\s*(.+?)\s*\|\s*$/)
    if (!match) continue
    const tag = match[1].trim()
    const text = match[2].replace(/\*\*/g, '').replace(/`/g, '"').replace(/\s+/g, ' ').trim()
    if (tag && text) criteria.set(tag, text)
  }
  return criteria
}

function slugifyTag(tag) {
  return String(tag)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

function buildTagQuestion(axis, tag, criteria) {
  const yes = criteria
    ? `Tag "${tag}" applies. ${criteria}`
    : `Tag "${tag}" applies: the publication's focus is ${tag}.`
  return {
    type: 'noul',
    instructions: `Should this research publication be tagged "${tag}" under ${axis.label}? ${axis.guidance}`,
    criteria: {
      true: yes,
      false: `Tag "${tag}" does not apply, or the subject is only mentioned in passing rather than being a focus of the publication.`,
    },
  }
}

/**
 * One noul question per canonical tag plus the exclude question.
 *
 * @returns {{ questions: Record<string, object>, index: Record<string, { axis: string, tag: string }>, missingCriteria: string[] }}
 */
export function buildJevQuestions(options = {}) {
  const criteria = parseTaxonomyCriteria(options.classificationPrompt || DEFAULT_CLASSIFICATION_PROMPT)
  const questions = {}
  const index = {}
  const missingCriteria = []

  for (const axis of CLASSIFICATION_AXES) {
    for (const tag of axis.tags) {
      const name = `${QUESTION_PREFIX[axis.key]}_${slugifyTag(tag)}`
      const text = criteria.get(tag) || null
      if (!text) missingCriteria.push(tag)
      questions[name] = buildTagQuestion(axis, tag, text)
      index[name] = { axis: axis.key, tag }
    }
  }

  // "Set `exclude: true` for corrections or errata only."
  questions[JEV_EXCLUDE_QUESTION] = {
    type: 'noul',
    instructions:
      'Is this item a correction, erratum, corrigendum, retraction notice or publisher note about a previously published article, rather than an original publication?',
    criteria: {
      true: 'The title or text indicates a correction, erratum, author correction, corrigendum, retraction or similar notice.',
      false: 'The item is an original article, review, commentary, protocol or other substantive publication.',
    },
  }
  index[JEV_EXCLUDE_QUESTION] = { axis: 'exclude', tag: 'exclude' }

  return { questions, index, missingCriteria }
}

/** The publication as Jev sees it. Returns the state and whether the abstract was cut. */
export function buildJevState({ title, abstract, laySummary }, options = {}) {
  const maxChars = Number(options.maxAbstractChars) > 0 ? Number(options.maxAbstractChars) : JEV_MAX_ABSTRACT_CHARS
  const fullAbstract = String(abstract || '').trim()
  const truncated = fullAbstract.length > maxChars
  const state = {
    title: String(title || '').trim(),
    abstract: truncated ? `${fullAbstract.slice(0, maxChars)}…` : fullAbstract,
    lay_summary: String(laySummary || '').trim() || null,
  }
  return { state, abstractTruncated: truncated, abstractLength: fullAbstract.length }
}

/** Flatten Jev's answers into `{ axis, tag, p }` rows, ordered as the questions were asked. */
export function probabilitiesFromAnswers(answers, index) {
  const rows = []
  for (const [name, meta] of Object.entries(index)) {
    const answer = answers?.[name]
    const p = Number(answer?.noul)
    if (!Number.isFinite(p)) continue
    rows.push({ axis: meta.axis, tag: meta.tag, p: Math.min(1, Math.max(0, p)) })
  }
  return rows
}

export function resolveJevThresholds(overrides) {
  const fromEnv = {
    topics: process.env.JEV_THRESHOLD_TOPICS,
    studyDesign: process.env.JEV_THRESHOLD_STUDY_DESIGN,
    methodologicalFocus: process.env.JEV_THRESHOLD_METHODOLOGICAL_FOCUS,
    exclude: process.env.JEV_THRESHOLD_EXCLUDE,
  }
  const merged = { ...DEFAULT_JEV_THRESHOLDS }
  for (const key of Object.keys(merged)) {
    const candidate = overrides?.[key] ?? fromEnv[key]
    if (candidate !== undefined && candidate !== null && candidate !== '') merged[key] = candidate
  }
  return normalizeJevThresholds(merged)
}

/**
 * Classify a publication with Jev.
 *
 * Returns the same `{ topics, studyDesign, methodologicalFocus, exclude }` shape as
 * classifyPublication, plus the per-tag probabilities the tags were cut from and the call's
 * model, transport, token usage and latency.
 */
export async function classifyPublicationWithJev({ title, abstract, laySummary }, options = {}) {
  const { questions, index, missingCriteria } = buildJevQuestions(options)
  if (missingCriteria.length && options.debug) {
    console.warn('[jev] Tags without prompt criteria; using bare tag names', missingCriteria)
  }
  const { state, abstractTruncated, abstractLength } = buildJevState({ title, abstract, laySummary }, options)
  const thresholds = resolveJevThresholds(options.thresholds)

  const result = await callJevSystemOne({ state, questions }, options)
  const probabilities = probabilitiesFromAnswers(result.answers, index)
  const missingAnswers = Object.keys(index).length - probabilities.length
  if (missingAnswers > 0) {
    throw new Error(`Jev answered ${probabilities.length} of ${Object.keys(index).length} questions`)
  }
  const classification = deriveClassificationFromProbabilities(probabilities, thresholds)

  return {
    ...classification,
    probabilities,
    thresholds,
    model: result.model,
    transport: result.transport,
    usage: result.usage,
    latencyMs: result.latencyMs,
    abstractTruncated,
    abstractLength,
  }
}

export { describeJevConfig }
