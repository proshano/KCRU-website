import { CLASSIFICATION_AXES } from './classificationTaxonomy.js'
import { deriveClassificationFromProbabilities, normalizeJevThresholds } from './jevDecisions.js'

/**
 * Agreement metrics between the stored ("baseline") classification and Jev's, computed from
 * an evaluation run's papers.
 *
 * Browser-safe and pure: the evaluation page recomputes everything here when the reviewer
 * changes a threshold. The baseline is treated as the reference for precision/recall, but
 * it is the current classifier's output, not ground truth - a disagreement means one of the
 * two systems is wrong, and the page exists so a person can see which.
 */

// TypeSafe's published early-access price for Jev (September 2026): $0.042 per million input
// tokens, output free. An estimate for the summary tiles, not a bill.
export const JEV_USD_PER_MILLION_INPUT_TOKENS = 0.042

function safeRatio(numerator, denominator) {
  return denominator > 0 ? numerator / denominator : null
}

function f1(precision, recall) {
  if (precision === null || recall === null) return null
  const sum = precision + recall
  return sum > 0 ? (2 * precision * recall) / sum : 0
}

function setsEqual(a, b) {
  if (a.size !== b.size) return false
  for (const value of a) if (!b.has(value)) return false
  return true
}

/** Baseline and derived-Jev tag sets for one paper, per axis. */
export function comparePaper(paper, thresholds) {
  const jev = paper?.jev?.error
    ? null
    : deriveClassificationFromProbabilities(paper?.jev?.probabilities || [], thresholds)
  const axes = {}
  for (const axis of CLASSIFICATION_AXES) {
    const baseline = new Set(paper?.baseline?.[axis.key] || [])
    const candidate = new Set(jev ? jev[axis.key] : [])
    axes[axis.key] = {
      baseline: [...baseline],
      jev: [...candidate],
      agree: [...baseline].filter((tag) => candidate.has(tag)),
      jevOnly: [...candidate].filter((tag) => !baseline.has(tag)),
      baselineOnly: [...baseline].filter((tag) => !candidate.has(tag)),
      exact: jev ? setsEqual(baseline, candidate) : false,
    }
  }
  const baselineExclude = paper?.baseline?.exclude === true
  // The stored exclude flag already folds in the publication-type/title correction rule
  // (isPublicationExcluded), so the same rule is applied to Jev's answer before comparing.
  const jevExclude = jev ? jev.exclude === true || paper?.publicationTypeExcluded === true : false
  return {
    pmid: paper?.pmid,
    error: paper?.jev?.error || null,
    axes,
    exclude: { baseline: baselineExclude, jev: jevExclude, exact: jev ? baselineExclude === jevExclude : false },
    allExact: Boolean(jev) && Object.values(axes).every((axis) => axis.exact) && baselineExclude === jevExclude,
    disagreements: Object.values(axes).reduce((sum, axis) => sum + axis.jevOnly.length + axis.baselineOnly.length, 0)
      + (jev && baselineExclude !== jevExclude ? 1 : 0),
  }
}

/**
 * Summary metrics for a run at the given thresholds.
 *
 * Per axis: exact-set-match rate and micro-averaged precision/recall/F1 with the baseline as
 * reference. Per tag: counts on each side plus agreement, so the tags that drive the
 * disagreement are visible at a glance.
 */
export function computeEvalMetrics(papers = [], thresholds) {
  const cut = normalizeJevThresholds(thresholds)
  const comparisons = (papers || []).map((paper) => comparePaper(paper, cut))
  const scored = comparisons.filter((comparison) => !comparison.error)

  const axes = {}
  const tags = {}
  for (const axis of CLASSIFICATION_AXES) {
    let tp = 0
    let fp = 0
    let fn = 0
    let exact = 0
    let baselineTags = 0
    let jevTags = 0
    for (const comparison of scored) {
      const row = comparison.axes[axis.key]
      tp += row.agree.length
      fp += row.jevOnly.length
      fn += row.baselineOnly.length
      exact += row.exact ? 1 : 0
      baselineTags += row.baseline.length
      jevTags += row.jev.length
      for (const tag of row.agree) bump(tags, axis.key, tag, 'agree')
      for (const tag of row.jevOnly) bump(tags, axis.key, tag, 'jevOnly')
      for (const tag of row.baselineOnly) bump(tags, axis.key, tag, 'baselineOnly')
    }
    const precision = safeRatio(tp, tp + fp)
    const recall = safeRatio(tp, tp + fn)
    axes[axis.key] = {
      key: axis.key,
      label: axis.label,
      papers: scored.length,
      exactMatches: exact,
      exactMatchRate: safeRatio(exact, scored.length),
      baselineTags,
      jevTags,
      truePositives: tp,
      jevOnly: fp,
      baselineOnly: fn,
      precision,
      recall,
      f1: f1(precision, recall),
    }
  }

  let excludeAgree = 0
  let excludeBaseline = 0
  let excludeJev = 0
  for (const comparison of scored) {
    if (comparison.exclude.exact) excludeAgree += 1
    if (comparison.exclude.baseline) excludeBaseline += 1
    if (comparison.exclude.jev) excludeJev += 1
  }

  const latencies = (papers || []).map((paper) => Number(paper?.jev?.latencyMs)).filter((value) => value > 0)
  const inputTokens = (papers || []).reduce((sum, paper) => sum + (Number(paper?.jev?.inputTokens) || 0), 0)
  const outputTokens = (papers || []).reduce((sum, paper) => sum + (Number(paper?.jev?.outputTokens) || 0), 0)

  return {
    thresholds: cut,
    papers: comparisons.length,
    scored: scored.length,
    errors: comparisons.length - scored.length,
    allExact: scored.filter((comparison) => comparison.allExact).length,
    allExactRate: safeRatio(scored.filter((comparison) => comparison.allExact).length, scored.length),
    axes,
    exclude: {
      papers: scored.length,
      agree: excludeAgree,
      agreeRate: safeRatio(excludeAgree, scored.length),
      baselineExcluded: excludeBaseline,
      jevExcluded: excludeJev,
    },
    tags: Object.values(tags)
      .map((row) => ({
        ...row,
        baselineCount: row.agree + row.baselineOnly,
        jevCount: row.agree + row.jevOnly,
        precision: safeRatio(row.agree, row.agree + row.jevOnly),
        recall: safeRatio(row.agree, row.agree + row.baselineOnly),
        disagreements: row.jevOnly + row.baselineOnly,
      }))
      .sort((left, right) => right.disagreements - left.disagreements || left.tag.localeCompare(right.tag)),
    latency: {
      meanMs: latencies.length ? Math.round(latencies.reduce((sum, value) => sum + value, 0) / latencies.length) : null,
      maxMs: latencies.length ? Math.max(...latencies) : null,
    },
    usage: {
      inputTokens,
      outputTokens,
      estimatedUsd: (inputTokens / 1_000_000) * JEV_USD_PER_MILLION_INPUT_TOKENS,
    },
    comparisons,
  }
}

function bump(tags, axis, tag, field) {
  const key = `${axis}:${tag}`
  if (!tags[key]) tags[key] = { axis, tag, agree: 0, jevOnly: 0, baselineOnly: 0 }
  tags[key][field] += 1
}
