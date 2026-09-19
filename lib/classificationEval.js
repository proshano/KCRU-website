import { computeEvalMetrics } from './classificationEvalMetrics.js'
import { CLASSIFICATION_AXIS_KEYS } from './classificationTaxonomy.js'
import { classifyPublicationWithJev, describeJevConfig, resolveJevThresholds } from './jevClassifier.js'
import { readCache } from './pubmedCache.js'
import { isPublicationCorrectionNotice } from './publicationExclusions.js'
import { writeClient } from './sanity.js'
import { requireSanityDocumentType } from './sanityDocumentType.js'

/**
 * Side-by-side evaluation of Jev against the classification the site already holds.
 *
 * A run samples cached publications that have an abstract and a stored classification,
 * classifies each with Jev, and stores both classifications plus Jev's per-tag probabilities
 * as one `classificationEvalRun` document. /admin/classification-eval reads those documents
 * and lets a reviewer re-cut the probabilities at different thresholds without another
 * model call. Nothing here touches the production classification.
 */

export const CLASSIFICATION_EVAL_RUN_TYPE = 'classificationEvalRun'
export const DEFAULT_EVAL_COUNT = 50
export const DEFAULT_EVAL_SEED = 1
export const DEFAULT_EVAL_CONCURRENCY = 4
// The script has no execution ceiling; the admin route runs inside one request.
export const MAX_EVAL_COUNT = 1000
export const MAX_EVAL_ROUTE_COUNT = 100
const ABSTRACT_MIN_CHARS = 50
const ABSTRACT_PREVIEW_CHARS = 600

function clamp(value, min, max) {
  const n = Number(value)
  if (!Number.isFinite(n)) return min
  return Math.max(min, Math.min(max, n))
}

/** Small deterministic PRNG so a seed reproduces the same sample on every run. */
export function mulberry32(seed) {
  let a = (Number(seed) || 0) >>> 0
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function seededShuffle(items, seed) {
  const out = [...items]
  const random = mulberry32(seed)
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

function tagList(value) {
  return Array.isArray(value) ? value.map((tag) => String(tag)).filter(Boolean) : []
}

/**
 * The classification to compare against. A `pubmedClassification` document is preferred
 * because it records which model produced it; otherwise the tags carried on the cache
 * entry (written by the summary+classification refresh path) are used. A publication with
 * neither is not eligible: an empty tag set could mean "classified as nothing" or "never
 * classified", and the two cannot be told apart.
 */
export function resolveBaseline(publication, classificationDoc) {
  if (classificationDoc && classificationDoc.status !== 'error') {
    return {
      source: 'pubmedClassification',
      provider: classificationDoc.provider || null,
      model: classificationDoc.model || null,
      runAt: classificationDoc.runAt || null,
      topics: tagList(classificationDoc.topics),
      studyDesign: tagList(classificationDoc.studyDesign),
      methodologicalFocus: tagList(classificationDoc.methodologicalFocus),
      exclude: classificationDoc.exclude === true,
    }
  }
  const hasTags = CLASSIFICATION_AXIS_KEYS.some((key) => tagList(publication?.[key]).length > 0)
  if (!hasTags && publication?.exclude !== true) return null
  return {
    source: 'cache',
    provider: null,
    model: null,
    runAt: null,
    topics: tagList(publication.topics),
    studyDesign: tagList(publication.studyDesign),
    methodologicalFocus: tagList(publication.methodologicalFocus),
    exclude: publication.exclude === true,
  }
}

/**
 * Pick the sample. Explicit PMIDs take everything that matches; otherwise a seeded shuffle
 * of the eligible publications is cut to `count`.
 */
export function selectEvalPublications({ publications = [], classifications = new Map(), count, seed, pmids = [], year } = {}) {
  const pmidFilter = new Set((pmids || []).map((pmid) => String(pmid)))
  const eligible = []
  for (const publication of publications || []) {
    if (!publication?.pmid || !publication?.title) continue
    const pmid = String(publication.pmid)
    if (pmidFilter.size && !pmidFilter.has(pmid)) continue
    if (year && String(publication.year || '') !== String(year)) continue
    if (String(publication.abstract || '').trim().length < ABSTRACT_MIN_CHARS) continue
    const baseline = resolveBaseline(publication, classifications.get(pmid))
    if (!baseline) continue
    eligible.push({ publication, baseline })
  }
  eligible.sort((left, right) => String(left.publication.pmid).localeCompare(String(right.publication.pmid)))
  const selected = pmidFilter.size ? eligible : seededShuffle(eligible, seed).slice(0, count)
  return { selected, eligibleCount: eligible.length }
}

async function fetchClassificationDocs(client) {
  const docs = await client.fetch(
    `*[_type == "pubmedClassification"]{ pmid, status, provider, model, runAt, topics, studyDesign, methodologicalFocus, exclude }`
  )
  const map = new Map()
  for (const doc of docs || []) {
    if (doc?.pmid) map.set(String(doc.pmid), doc)
  }
  return map
}

function buildPaperRecord({ publication, baseline }, jevResult, error) {
  const abstract = String(publication.abstract || '')
  const pmid = String(publication.pmid)
  const publicationTypeExcluded = isPublicationCorrectionNotice(publication)
  const jev = jevResult
    ? {
      topics: jevResult.topics,
      studyDesign: jevResult.studyDesign,
      methodologicalFocus: jevResult.methodologicalFocus,
      // Same rule the reclassification path applies to the chat model's answer.
      exclude: jevResult.exclude === true || publicationTypeExcluded,
      model: jevResult.model || null,
      latencyMs: jevResult.latencyMs ?? null,
      inputTokens: jevResult.usage?.inputTokens || 0,
      outputTokens: jevResult.usage?.outputTokens || 0,
      probabilities: (jevResult.probabilities || []).map((row, index) => ({ _key: `q${index}`, ...row })),
      error: null,
    }
    : {
      topics: [],
      studyDesign: [],
      methodologicalFocus: [],
      exclude: false,
      model: null,
      latencyMs: null,
      inputTokens: 0,
      outputTokens: 0,
      probabilities: [],
      error: String(error?.message || error || 'Classification failed'),
    }

  return {
    _key: pmid,
    pmid,
    title: publication.title || null,
    year: Number(publication.year) || null,
    journal: publication.journal || null,
    url: publication.url || publication.pubmedUrl || `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
    abstractLength: abstract.length,
    abstractTruncated: jevResult?.abstractTruncated === true,
    abstractPreview: abstract.slice(0, ABSTRACT_PREVIEW_CHARS),
    publicationTypeExcluded,
    baseline,
    jev,
  }
}

function summarizeMetrics(metrics) {
  return {
    papers: metrics.papers,
    scored: metrics.scored,
    errors: metrics.errors,
    allExact: metrics.allExact,
    allExactRate: metrics.allExactRate,
    meanLatencyMs: metrics.latency.meanMs,
    inputTokens: metrics.usage.inputTokens,
    outputTokens: metrics.usage.outputTokens,
    estimatedUsd: metrics.usage.estimatedUsd,
    axes: Object.values(metrics.axes).map((axis) => ({
      _key: axis.key,
      key: axis.key,
      label: axis.label,
      exactMatchRate: axis.exactMatchRate,
      precision: axis.precision,
      recall: axis.recall,
      f1: axis.f1,
    })),
  }
}

/**
 * Run Jev over a sample and (unless `persist: false` or `dryRun`) store the run.
 *
 * Options: count, seed, concurrency, year, pmids, label, requestedBy, thresholds, model,
 * transport, apiKey, dryRun, persist, plus `cache`, `classifications`, `client` and `fetch`
 * for tests. `onProgress({ done, total })` is called after each batch.
 */
export async function runClassificationEval(options = {}) {
  const count = clamp(options.count ?? DEFAULT_EVAL_COUNT, 1, MAX_EVAL_COUNT)
  const seed = options.seed === undefined || options.seed === null || options.seed === ''
    ? DEFAULT_EVAL_SEED
    : clamp(options.seed, 0, Number.MAX_SAFE_INTEGER)
  const concurrency = clamp(options.concurrency ?? DEFAULT_EVAL_CONCURRENCY, 1, 10)
  const dryRun = options.dryRun === true
  const persist = options.persist !== false && !dryRun
  const client = options.client || writeClient

  const config = describeJevConfig(options)
  if (!config.hasApiKey) {
    throw new Error(`Missing ${config.apiKeyEnvVar}: set it to run the Jev evaluation (transport "${config.transport}").`)
  }
  const thresholds = resolveJevThresholds(options.thresholds)

  const cache = options.cache || (await readCache())
  if (!cache?.publications?.length) {
    throw new Error('No cached publications. Refresh cache first.')
  }
  const classifications = options.classifications || (await fetchClassificationDocs(client))
  const { selected, eligibleCount } = selectEvalPublications({
    publications: cache.publications,
    classifications,
    count,
    seed,
    pmids: options.pmids,
    year: options.year,
  })
  if (!selected.length) {
    throw new Error('No eligible publications: the sample needs an abstract and an existing classification.')
  }

  const selection = {
    requestedCount: count,
    seed,
    eligibleCount,
    totalPublications: cache.publications.length,
    year: options.year ? String(options.year) : null,
    pmids: selected.map((item) => String(item.publication.pmid)),
  }

  if (dryRun) {
    return {
      dryRun: true,
      config,
      selection,
      preview: selected.slice(0, 20).map((item) => ({
        pmid: item.publication.pmid,
        title: item.publication.title,
        year: item.publication.year || null,
        baselineSource: item.baseline.source,
      })),
    }
  }

  const papers = new Array(selected.length)
  for (let i = 0; i < selected.length; i += concurrency) {
    const chunk = selected.slice(i, i + concurrency)
    await Promise.all(
      chunk.map(async (item, offset) => {
        try {
          const jev = await classifyPublicationWithJev(
            {
              title: item.publication.title,
              abstract: item.publication.abstract || '',
              laySummary: item.publication.laySummary || '',
            },
            { ...options, thresholds }
          )
          papers[i + offset] = buildPaperRecord(item, jev, null)
        } catch (error) {
          papers[i + offset] = buildPaperRecord(item, null, error)
        }
      })
    )
    options.onProgress?.({ done: Math.min(i + concurrency, selected.length), total: selected.length })
  }

  const metrics = computeEvalMetrics(papers, thresholds)
  const observedModel = papers.find((paper) => paper.jev.model)?.jev.model || config.model
  const doc = {
    _type: CLASSIFICATION_EVAL_RUN_TYPE,
    label: options.label || `Jev vs stored classification (${papers.length} papers, seed ${seed})`,
    runAt: new Date().toISOString(),
    status: metrics.errors > 0 ? 'partial' : 'ok',
    transport: config.transport,
    model: observedModel,
    endpoint: config.endpoint,
    requestedBy: options.requestedBy || null,
    thresholds,
    sample: selection,
    summary: summarizeMetrics(metrics),
    papers,
  }

  const run = persist ? await client.create(doc) : doc
  return { run, metrics, persisted: persist, config, selection }
}

const RUN_SUMMARY_PROJECTION = `{
  _id, label, runAt, status, transport, model, requestedBy, thresholds,
  sample{ requestedCount, seed, eligibleCount, totalPublications, year },
  summary
}`

export async function listClassificationEvalRuns(client) {
  const runs = await client.fetch(
    `*[_type == $type] | order(runAt desc)[0...50] ${RUN_SUMMARY_PROJECTION}`,
    { type: CLASSIFICATION_EVAL_RUN_TYPE }
  )
  return runs || []
}

export async function fetchClassificationEvalRun(client, id) {
  if (!id) return null
  return client.fetch(`*[_type == $type && _id == $id][0]`, { type: CLASSIFICATION_EVAL_RUN_TYPE, id })
}

export async function deleteClassificationEvalRun(client, id) {
  await requireSanityDocumentType({
    fetch: client.fetch.bind(client),
    id,
    expectedType: CLASSIFICATION_EVAL_RUN_TYPE,
    label: 'Evaluation run',
  })
  await client.delete(id)
}
