'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'

import { computeEvalMetrics } from '@/lib/classificationEvalMetrics'
import { CLASSIFICATION_AXES } from '@/lib/classificationTaxonomy'
import { DEFAULT_JEV_THRESHOLDS, JEV_THRESHOLD_KEYS, normalizeJevThresholds } from '@/lib/jevDecisions'

const THRESHOLD_LABELS = {
  topics: 'Topics',
  studyDesign: 'Study design',
  methodologicalFocus: 'Methodological focus',
  exclude: 'Exclude',
}

const FILTERS = [
  { key: 'disagree', label: 'Disagreements' },
  { key: 'all', label: 'All papers' },
  { key: 'errors', label: 'Errors' },
]

// Status colours: agreement is good, a tag only Jev applied is a warning to look at, a tag
// only the stored classification has is the more serious miss. Each chip also carries its
// state in text, so colour is never the only signal.
const CHIP_STYLES = {
  agree: 'bg-emerald-50 text-emerald-900 border-emerald-300',
  jevOnly: 'bg-amber-50 text-amber-900 border-amber-300',
  baselineOnly: 'bg-rose-50 text-rose-900 border-rose-300',
}

const CHIP_LABELS = {
  agree: 'both',
  jevOnly: 'Jev only',
  baselineOnly: 'stored only',
}

function formatPct(value, digits = 0) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '—'
  return `${(Number(value) * 100).toFixed(digits)}%`
}

function formatProbability(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '—'
  return Number(value).toFixed(2)
}

function formatDateTime(value) {
  if (!value) return '—'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return String(value)
  return parsed.toLocaleString()
}

function formatNumber(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '—'
  return Number(value).toLocaleString()
}

function probabilityKey(axis, tag) {
  return `${axis}:${tag}`
}

function StatTile({ label, value, detail }) {
  return (
    <div className="bg-white border border-black/5 rounded-xl p-4 shadow-sm">
      <p className="text-xs uppercase tracking-wide text-gray-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-gray-900 tabular-nums">{value}</p>
      {detail ? <p className="mt-1 text-xs text-gray-500">{detail}</p> : null}
    </div>
  )
}

function TagChip({ tag, state, probability, threshold }) {
  const nearThreshold = Number.isFinite(probability) && Number.isFinite(threshold) && Math.abs(probability - threshold) < 0.15
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs ${CHIP_STYLES[state]}`}
      title={`${tag}: ${CHIP_LABELS[state]}${Number.isFinite(probability) ? ` (Jev p=${formatProbability(probability)})` : ''}`}
    >
      <span className="font-medium">{tag}</span>
      <span className="text-[10px] uppercase tracking-wide opacity-70">{CHIP_LABELS[state]}</span>
      {Number.isFinite(probability) ? (
        <span className={`tabular-nums ${nearThreshold ? 'underline decoration-dotted' : ''}`}>
          {formatProbability(probability)}
        </span>
      ) : null}
    </span>
  )
}

function ThresholdSlider({ id, label, value, onChange }) {
  return (
    <label htmlFor={id} className="block text-sm">
      <span className="flex items-center justify-between">
        <span className="font-medium text-gray-800">{label}</span>
        <span className="tabular-nums text-gray-600">{formatProbability(value)}</span>
      </span>
      <input
        id={id}
        type="range"
        min="0.05"
        max="0.95"
        step="0.05"
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="mt-1 w-full accent-purple"
      />
    </label>
  )
}

function PaperCard({ paper, comparison, thresholds, expanded, onToggle }) {
  const probabilities = useMemo(() => {
    const map = new Map()
    for (const row of paper?.jev?.probabilities || []) map.set(probabilityKey(row.axis, row.tag), Number(row.p))
    return map
  }, [paper])

  const sortedProbabilities = useMemo(
    () => [...(paper?.jev?.probabilities || [])].sort((left, right) => Number(right.p) - Number(left.p)),
    [paper]
  )

  const statusChip = comparison.error
    ? { text: 'Jev error', className: 'bg-red-100 text-red-900 border-red-300' }
    : comparison.allExact
      ? { text: 'Exact match', className: 'bg-emerald-100 text-emerald-900 border-emerald-300' }
      : {
        text: `${comparison.disagreements} disagreement${comparison.disagreements === 1 ? '' : 's'}`,
        className: 'bg-amber-100 text-amber-900 border-amber-300',
      }

  return (
    <article className="bg-white border border-black/5 rounded-xl p-5 shadow-sm space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1 min-w-0">
          <h3 className="text-base font-semibold text-gray-900 leading-snug">
            <a href={paper.url} target="_blank" rel="noreferrer" className="hover:underline">
              {paper.title || `PMID ${paper.pmid}`}
            </a>
          </h3>
          <p className="text-xs text-gray-500">
            {[paper.journal, paper.year, `PMID ${paper.pmid}`].filter(Boolean).join(' • ')}
            {' • stored: '}
            {paper.baseline?.model || paper.baseline?.source || 'unknown'}
            {paper.jev?.latencyMs ? ` • Jev ${formatNumber(paper.jev.latencyMs)} ms` : ''}
            {paper.abstractTruncated ? ' • abstract truncated for Jev' : ''}
          </p>
        </div>
        <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${statusChip.className}`}>
          {statusChip.text}
        </span>
      </header>

      {comparison.error ? (
        <p className="text-sm text-red-700">{comparison.error}</p>
      ) : (
        <div className="space-y-3">
          {CLASSIFICATION_AXES.map((axis) => {
            const row = comparison.axes[axis.key]
            const chips = [
              ...row.agree.map((tag) => ({ tag, state: 'agree' })),
              ...row.jevOnly.map((tag) => ({ tag, state: 'jevOnly' })),
              ...row.baselineOnly.map((tag) => ({ tag, state: 'baselineOnly' })),
            ]
            return (
              <div key={axis.key} className="grid grid-cols-1 md:grid-cols-[180px_1fr] gap-1 md:gap-3">
                <p className="text-sm font-medium text-gray-700">{axis.label}</p>
                <div className="flex flex-wrap gap-1.5">
                  {chips.length === 0 ? <span className="text-xs text-gray-400">no tags on either side</span> : null}
                  {chips.map((chip) => (
                    <TagChip
                      key={`${axis.key}:${chip.tag}`}
                      tag={chip.tag}
                      state={chip.state}
                      probability={probabilities.get(probabilityKey(axis.key, chip.tag))}
                      threshold={thresholds[axis.key]}
                    />
                  ))}
                </div>
              </div>
            )
          })}
          <div className="grid grid-cols-1 md:grid-cols-[180px_1fr] gap-1 md:gap-3">
            <p className="text-sm font-medium text-gray-700">Exclude</p>
            <p className={`text-sm ${comparison.exclude.exact ? 'text-gray-600' : 'text-rose-800'}`}>
              stored {comparison.exclude.baseline ? 'yes' : 'no'} • Jev {comparison.exclude.jev ? 'yes' : 'no'}
              {' '}
              <span className="text-xs text-gray-500 tabular-nums">
                (p={formatProbability(probabilities.get(probabilityKey('exclude', 'exclude')))})
              </span>
              {paper.publicationTypeExcluded ? <span className="text-xs text-gray-500"> • excluded by publication type</span> : null}
            </p>
          </div>
        </div>
      )}

      <div>
        <button
          type="button"
          onClick={onToggle}
          className="text-xs font-medium text-purple hover:underline"
        >
          {expanded ? 'Hide abstract and probabilities' : 'Show abstract and all probabilities'}
        </button>
        {expanded ? (
          <div className="mt-3 grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div>
              <p className="text-xs uppercase tracking-wide text-gray-500">Abstract (first {formatNumber(paper.abstractPreview?.length || 0)} of {formatNumber(paper.abstractLength)} characters)</p>
              <p className="mt-1 text-sm text-gray-700 whitespace-pre-line">{paper.abstractPreview || '—'}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-gray-500">Jev probabilities, highest first</p>
              <table className="mt-1 w-full text-xs">
                <tbody>
                  {sortedProbabilities.slice(0, 16).map((row) => {
                    const threshold = row.axis === 'exclude' ? thresholds.exclude : thresholds[row.axis]
                    const above = Number(row.p) >= threshold
                    return (
                      <tr key={probabilityKey(row.axis, row.tag)} className="border-t border-black/5">
                        <td className="py-1 pr-2 text-gray-500">{THRESHOLD_LABELS[row.axis] || row.axis}</td>
                        <td className={`py-1 pr-2 ${above ? 'font-medium text-gray-900' : 'text-gray-600'}`}>{row.tag}</td>
                        <td className="py-1 text-right tabular-nums text-gray-700">{formatProbability(row.p)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
      </div>
    </article>
  )
}

export default function ClassificationEvalClient() {
  const [payload, setPayload] = useState({ config: null, production: null, runs: [], run: null })
  const [loading, setLoading] = useState(true)
  const [working, setWorking] = useState(false)
  const [message, setMessage] = useState({ type: 'idle', text: '' })
  const [form, setForm] = useState({ count: 50, seed: 1, concurrency: 4, label: '', year: '' })
  const [thresholds, setThresholds] = useState(DEFAULT_JEV_THRESHOLDS)
  const [filter, setFilter] = useState('disagree')
  const [expanded, setExpanded] = useState({})

  const run = payload.run
  const config = payload.config
  const production = payload.production

  const metrics = useMemo(
    () => (run?.papers?.length ? computeEvalMetrics(run.papers, thresholds) : null),
    [run, thresholds]
  )

  const runThresholds = useMemo(() => normalizeJevThresholds(run?.thresholds), [run])
  const thresholdsChanged = JEV_THRESHOLD_KEYS.some((key) => thresholds[key] !== runThresholds[key])
  const productionThresholds = useMemo(
    () => normalizeJevThresholds(production?.effectiveThresholds),
    [production]
  )
  const matchesProduction = JEV_THRESHOLD_KEYS.every(
    (key) => Math.abs(thresholds[key] - productionThresholds[key]) < 0.001
  )

  async function load(runId = '') {
    setLoading(true)
    setMessage({ type: 'idle', text: '' })
    try {
      const qs = runId ? `?run=${encodeURIComponent(runId)}` : ''
      const res = await fetch(`/api/admin/classification-eval${qs}`)
      const data = await res.json()
      if (!res.ok || !data.ok) {
        throw new Error(data?.error || 'Failed to load classification evaluations.')
      }
      setPayload({ config: data.config, production: data.production || null, runs: data.runs || [], run: data.run || null })
      setThresholds(normalizeJevThresholds(data.run?.thresholds))
      setExpanded({})
    } catch (error) {
      setMessage({ type: 'error', text: error.message || 'Failed to load classification evaluations.' })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load('')
  }, [])

  async function runEvaluation(event) {
    event.preventDefault()
    setWorking(true)
    setMessage({ type: 'info', text: `Classifying ${form.count} papers with Jev…` })
    try {
      const res = await fetch('/api/admin/classification-eval', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'run',
          count: Number(form.count),
          seed: Number(form.seed),
          concurrency: Number(form.concurrency),
          label: form.label.trim() || undefined,
          year: form.year.trim() || undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok || !data.ok) {
        throw new Error(data?.error || 'Evaluation failed.')
      }
      setPayload((previous) => ({ ...previous, runs: data.runs || previous.runs, run: data.run }))
      setThresholds(normalizeJevThresholds(data.run?.thresholds))
      setExpanded({})
      const summary = data.run?.summary
      setMessage({
        type: 'success',
        text: summary
          ? `Done: ${summary.papers} papers, ${formatPct(summary.allExactRate)} exact agreement on every axis${summary.errors ? `, ${summary.errors} errors` : ''}.`
          : 'Evaluation complete.',
      })
    } catch (error) {
      setMessage({ type: 'error', text: error.message || 'Evaluation failed.' })
    } finally {
      setWorking(false)
    }
  }

  async function deleteRun() {
    if (!run?._id) return
    if (!window.confirm('Delete this evaluation run? The stored probabilities cannot be recovered.')) return
    setWorking(true)
    try {
      const res = await fetch('/api/admin/classification-eval', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete', runId: run._id }),
      })
      const data = await res.json()
      if (!res.ok || !data.ok) {
        throw new Error(data?.error || 'Delete failed.')
      }
      await load('')
    } catch (error) {
      setMessage({ type: 'error', text: error.message || 'Delete failed.' })
    } finally {
      setWorking(false)
    }
  }

  async function applyThresholds() {
    const summary = JEV_THRESHOLD_KEYS.map((key) => `${THRESHOLD_LABELS[key]} ${formatProbability(thresholds[key])}`).join(', ')
    if (!window.confirm(`Use these thresholds for production classification?\n\n${summary}\n\nThey apply on the next PubMed refresh or reclassification when the classifier is set to Jev.`)) return
    setWorking(true)
    setMessage({ type: 'idle', text: '' })
    try {
      const res = await fetch('/api/admin/classification-eval', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'apply-thresholds',
          thresholds,
          source: run ? `${run.label || 'evaluation'} (${run._id})` : 'classification evaluation',
        }),
      })
      const data = await res.json()
      if (!res.ok || !data.ok) {
        throw new Error(data?.error || 'Saving thresholds failed.')
      }
      setPayload((previous) => ({ ...previous, production: data.production }))
      setMessage({
        type: 'success',
        text: data.production?.backend === 'jev'
          ? 'Production thresholds saved. They apply on the next refresh or reclassification.'
          : 'Production thresholds saved. The classifier is still set to the chat model; switch it to Jev in Sanity Studio (Site Settings → Publication Classification) when you are ready.',
      })
    } catch (error) {
      setMessage({ type: 'error', text: error.message || 'Saving thresholds failed.' })
    } finally {
      setWorking(false)
    }
  }

  async function setBackend(backend) {
    if (!production || production.backend === backend) return
    const label = backend === 'jev' ? 'the Jev decision model' : 'the chat model'
    if (!window.confirm(`Switch production classification to ${label}?\n\nThis applies to the next PubMed refresh or reclassification. Existing tags are not changed until a paper is reclassified.`)) return
    setWorking(true)
    setMessage({ type: 'idle', text: '' })
    try {
      const res = await fetch('/api/admin/classification-eval', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'set-backend', backend }),
      })
      const data = await res.json()
      if (!res.ok || !data.ok) {
        throw new Error(data?.error || 'Switching the classifier failed.')
      }
      setPayload((previous) => ({ ...previous, production: data.production }))
      setMessage({
        type: 'success',
        text: backend === 'jev'
          ? `Production classification now uses Jev at thresholds ${JEV_THRESHOLD_KEYS.map((key) => formatProbability(data.production?.effectiveThresholds?.[key])).join(' / ')}. It applies on the next refresh or reclassification.`
          : 'Production classification now uses the chat model.',
      })
    } catch (error) {
      setMessage({ type: 'error', text: error.message || 'Switching the classifier failed.' })
    } finally {
      setWorking(false)
    }
  }

  const visiblePapers = useMemo(() => {
    if (!run?.papers) return []
    const comparisons = metrics?.comparisons || []
    return run.papers
      .map((paper, index) => ({ paper, comparison: comparisons[index] }))
      .filter(({ comparison }) => {
        if (!comparison) return false
        if (filter === 'errors') return Boolean(comparison.error)
        if (filter === 'disagree') return Boolean(comparison.error) || comparison.disagreements > 0
        return true
      })
  }, [run, metrics, filter])

  const messageClass = {
    error: 'border-red-300 bg-red-50 text-red-900',
    success: 'border-emerald-300 bg-emerald-50 text-emerald-900',
    info: 'border-sky-300 bg-sky-50 text-sky-900',
  }[message.type]

  return (
    <main className="max-w-[1400px] mx-auto px-6 md:px-12 py-10 space-y-8">
      <header className="space-y-3">
        <p className="text-sm font-semibold text-purple uppercase tracking-wide">
          <Link href="/admin" className="hover:underline">Admin Portal</Link>
        </p>
        <h1 className="text-3xl md:text-4xl font-bold tracking-tight">Classification evaluation</h1>
        <p className="text-gray-600 max-w-3xl">
          Jev answers one yes/no question per tag and returns a probability for each. A run classifies a
          sample of publications with Jev and stores the result beside the classification the site already
          holds. The stored classification is the comparison reference, not ground truth: a disagreement
          means one of the two systems is wrong, and the per-paper view is where to decide which.
        </p>
      </header>

      {message.text ? (
        <div className={`border rounded-lg px-4 py-3 text-sm ${messageClass}`}>{message.text}</div>
      ) : null}

      <section className="grid grid-cols-1 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-4">
        <form onSubmit={runEvaluation} className="bg-white border border-black/5 rounded-xl p-5 md:p-6 shadow-sm space-y-4">
          <div>
            <h2 className="text-lg font-semibold">Run a new evaluation</h2>
            <p className="text-sm text-gray-500">
              {config?.hasApiKey
                ? `Using ${config.model} via ${config.transport}.`
                : config?.apiKeyEnvVar
                  ? `No credential configured: set ${config.apiKeyEnvVar} on the server to run evaluations.`
                  : config?.error || 'Checking configuration…'}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-sm">
              <span className="block font-medium text-gray-800">Papers</span>
              <input
                type="number"
                min="1"
                max="100"
                value={form.count}
                onChange={(event) => setForm({ ...form, count: event.target.value })}
                className="mt-1 w-full border border-gray-300 rounded px-2 py-1"
              />
            </label>
            <label className="text-sm">
              <span className="block font-medium text-gray-800">Seed</span>
              <input
                type="number"
                min="0"
                value={form.seed}
                onChange={(event) => setForm({ ...form, seed: event.target.value })}
                className="mt-1 w-full border border-gray-300 rounded px-2 py-1"
              />
            </label>
            <label className="text-sm">
              <span className="block font-medium text-gray-800">Concurrency</span>
              <input
                type="number"
                min="1"
                max="10"
                value={form.concurrency}
                onChange={(event) => setForm({ ...form, concurrency: event.target.value })}
                className="mt-1 w-full border border-gray-300 rounded px-2 py-1"
              />
            </label>
            <label className="text-sm">
              <span className="block font-medium text-gray-800">Year (optional)</span>
              <input
                type="text"
                inputMode="numeric"
                placeholder="e.g. 2026"
                value={form.year}
                onChange={(event) => setForm({ ...form, year: event.target.value })}
                className="mt-1 w-full border border-gray-300 rounded px-2 py-1"
              />
            </label>
            <label className="text-sm col-span-2">
              <span className="block font-medium text-gray-800">Label (optional)</span>
              <input
                type="text"
                value={form.label}
                onChange={(event) => setForm({ ...form, label: event.target.value })}
                className="mt-1 w-full border border-gray-300 rounded px-2 py-1"
              />
            </label>
          </div>
          <p className="text-xs text-gray-500">
            The same seed picks the same papers, so re-running after a prompt or threshold change compares
            like with like. Runs from this page are capped at 100 papers; use
            {' '}<code className="bg-gray-100 px-1 rounded">npm run eval:jev-classification</code> for more.
          </p>
          <button
            type="submit"
            disabled={working || !config?.hasApiKey}
            className="inline-flex items-center justify-center bg-purple text-white px-4 py-2 rounded shadow hover:bg-purple/90 disabled:opacity-50"
          >
            {working ? 'Working…' : 'Run evaluation'}
          </button>
        </form>

        <div className="bg-white border border-black/5 rounded-xl p-5 md:p-6 shadow-sm space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <label className="text-sm flex-1 min-w-[240px]">
              <span className="block font-medium text-gray-800">Stored runs</span>
              <select
                value={run?._id || ''}
                onChange={(event) => load(event.target.value)}
                disabled={loading || working}
                className="mt-1 w-full border border-gray-300 rounded px-2 py-1"
              >
                {payload.runs.length === 0 ? <option value="">No runs yet</option> : null}
                {payload.runs.map((item) => (
                  <option key={item._id} value={item._id}>
                    {item.label || 'Evaluation'} — {formatDateTime(item.runAt)} — {item.summary?.papers ?? '?'} papers
                  </option>
                ))}
              </select>
            </label>
            {run?._id ? (
              <button
                type="button"
                onClick={deleteRun}
                disabled={working}
                className="text-sm text-rose-700 hover:underline disabled:opacity-50"
              >
                Delete run
              </button>
            ) : null}
          </div>
          {run ? (
            <dl className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-2 text-sm">
              <div><dt className="text-gray-500">Model</dt><dd className="text-gray-900">{run.model} <span className="text-gray-500">via {run.transport}</span></dd></div>
              <div><dt className="text-gray-500">Run at</dt><dd className="text-gray-900">{formatDateTime(run.runAt)}</dd></div>
              <div><dt className="text-gray-500">Requested by</dt><dd className="text-gray-900">{run.requestedBy || 'script'}</dd></div>
              <div><dt className="text-gray-500">Sample</dt><dd className="text-gray-900">{run.sample?.requestedCount} requested, seed {run.sample?.seed}{run.sample?.year ? `, year ${run.sample.year}` : ''}</dd></div>
              <div><dt className="text-gray-500">Eligible pool</dt><dd className="text-gray-900">{formatNumber(run.sample?.eligibleCount)} of {formatNumber(run.sample?.totalPublications)} cached</dd></div>
              <div><dt className="text-gray-500">Status</dt><dd className="text-gray-900">{run.status}</dd></div>
            </dl>
          ) : (
            <p className="text-sm text-gray-500">{loading ? 'Loading…' : 'Run an evaluation to see results here.'}</p>
          )}
        </div>
      </section>

      <section className="bg-white border border-black/5 rounded-xl p-5 md:p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold">Production classifier</h2>
            <p className="text-sm text-gray-500">
              What the site uses when it refreshes or reclassifies publications. Switching applies to the
              next run; existing tags stay until a paper is reclassified. If Jev fails for a paper, the
              chat model classifies it instead. The same setting is editable in Sanity Studio.
            </p>
          </div>
          {production ? (
            <div className="flex items-center gap-1 rounded-lg border border-black/10 p-1 bg-white" role="radiogroup" aria-label="Production classifier">
              {[
                { key: 'chat', label: 'Chat model' },
                { key: 'jev', label: 'Jev decision model' },
              ].map((item) => (
                <button
                  key={item.key}
                  type="button"
                  role="radio"
                  aria-checked={production.backend === item.key}
                  onClick={() => setBackend(item.key)}
                  disabled={working || production.backend === item.key}
                  className={`px-3 py-1 rounded text-sm ${
                    production.backend === item.key
                      ? 'bg-purple text-white'
                      : 'text-gray-700 hover:bg-gray-100 disabled:opacity-50'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          ) : null}
        </div>
        {production ? (
          <dl className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-2 text-sm">
            {JEV_THRESHOLD_KEYS.map((key) => (
              <div key={key}>
                <dt className="text-gray-500">{THRESHOLD_LABELS[key]} threshold</dt>
                <dd className="text-gray-900 tabular-nums">
                  {formatProbability(production.effectiveThresholds?.[key])}
                  {production.thresholds?.[key] === undefined ? <span className="text-xs text-gray-400"> (default)</span> : null}
                </dd>
              </div>
            ))}
            <div className="col-span-2 md:col-span-4 text-xs text-gray-500 space-y-0.5">
              <p>
                {production.thresholdsUpdatedAt
                  ? `Thresholds set ${formatDateTime(production.thresholdsUpdatedAt)}${production.thresholdsSource ? ` from ${production.thresholdsSource}` : ''}.`
                  : 'Thresholds have not been set from an evaluation yet; defaults apply.'}
              </p>
              {production.backendUpdatedAt ? (
                <p>
                  Classifier set to {production.backend === 'jev' ? 'Jev' : 'the chat model'} {formatDateTime(production.backendUpdatedAt)}
                  {production.backendUpdatedBy ? ` by ${production.backendUpdatedBy}` : ''}.
                </p>
              ) : null}
            </div>
          </dl>
        ) : (
          <p className="mt-3 text-sm text-gray-500">{loading ? 'Loading…' : 'Production settings unavailable.'}</p>
        )}
      </section>

      {metrics ? (
        <>
          <section className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
            <StatTile label="Papers" value={formatNumber(metrics.papers)} detail={metrics.errors ? `${metrics.errors} Jev errors` : 'all classified'} />
            <StatTile label="Exact on every axis" value={formatPct(metrics.allExactRate)} detail={`${metrics.allExact} of ${metrics.scored}`} />
            <StatTile label="Exclude agreement" value={formatPct(metrics.exclude.agreeRate)} detail={`stored ${metrics.exclude.baselineExcluded}, Jev ${metrics.exclude.jevExcluded}`} />
            <StatTile label="Mean Jev latency" value={metrics.latency.meanMs ? `${formatNumber(metrics.latency.meanMs)} ms` : '—'} detail={metrics.latency.maxMs ? `max ${formatNumber(metrics.latency.maxMs)} ms` : ''} />
            <StatTile label="Input tokens" value={formatNumber(metrics.usage.inputTokens)} detail={`${formatNumber(Math.round(metrics.usage.inputTokens / Math.max(1, metrics.papers)))} per paper`} />
            <StatTile label="Estimated cost" value={`$${metrics.usage.estimatedUsd.toFixed(4)}`} detail="at $0.042 / M input tokens" />
          </section>

          <section className="grid grid-cols-1 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-4">
            <div className="bg-white border border-black/5 rounded-xl p-5 md:p-6 shadow-sm space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold">Thresholds</h2>
                  <p className="text-sm text-gray-500">
                    A tag is applied when Jev&apos;s probability reaches the axis threshold. Moving a slider
                    re-cuts the stored probabilities; nothing is re-sent to the model.
                  </p>
                </div>
                {thresholdsChanged ? (
                  <button
                    type="button"
                    onClick={() => setThresholds(runThresholds)}
                    className="text-xs font-medium text-purple hover:underline whitespace-nowrap"
                  >
                    Reset to run values
                  </button>
                ) : null}
              </div>
              <div className="space-y-3">
                {JEV_THRESHOLD_KEYS.map((key) => (
                  <ThresholdSlider
                    key={key}
                    id={`threshold-${key}`}
                    label={THRESHOLD_LABELS[key]}
                    value={thresholds[key]}
                    onChange={(value) => setThresholds({ ...thresholds, [key]: value })}
                  />
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-3 pt-1">
                <button
                  type="button"
                  onClick={applyThresholds}
                  disabled={working || !production || matchesProduction}
                  className="inline-flex items-center justify-center bg-purple text-white px-4 py-2 rounded shadow hover:bg-purple/90 disabled:opacity-50"
                >
                  Use these thresholds in production
                </button>
                <span className="text-xs text-gray-500">
                  {matchesProduction ? 'Production already uses these values.' : 'Writes to Site Settings; takes effect on the next refresh or reclassification.'}
                </span>
              </div>
            </div>

            <div className="bg-white border border-black/5 rounded-xl p-5 md:p-6 shadow-sm space-y-3">
              <div>
                <h2 className="text-lg font-semibold">Agreement by axis</h2>
                <p className="text-sm text-gray-500">
                  Precision and recall treat the stored classification as the reference. Exact means the
                  two tag sets are identical for that paper.
                </p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-wide text-gray-500 border-b border-black/10">
                      <th className="py-2 pr-3 font-medium">Axis</th>
                      <th className="py-2 pr-3 font-medium text-right">Exact</th>
                      <th className="py-2 pr-3 font-medium text-right">Precision</th>
                      <th className="py-2 pr-3 font-medium text-right">Recall</th>
                      <th className="py-2 pr-3 font-medium text-right">F1</th>
                      <th className="py-2 pr-3 font-medium text-right">Stored tags</th>
                      <th className="py-2 font-medium text-right">Jev tags</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.values(metrics.axes).map((axis) => (
                      <tr key={axis.key} className="border-b border-black/5">
                        <td className="py-2 pr-3 font-medium text-gray-800">{axis.label}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">{formatPct(axis.exactMatchRate)}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">{formatPct(axis.precision)}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">{formatPct(axis.recall)}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">{formatPct(axis.f1)}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">{formatNumber(axis.baselineTags)}</td>
                        <td className="py-2 text-right tabular-nums">{formatNumber(axis.jevTags)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>

          <section className="bg-white border border-black/5 rounded-xl p-5 md:p-6 shadow-sm space-y-3">
            <div>
              <h2 className="text-lg font-semibold">Agreement by tag</h2>
              <p className="text-sm text-gray-500">
                Sorted by disagreement count. &ldquo;Jev only&rdquo; counts papers where Jev applied the tag and
                the stored classification did not; &ldquo;stored only&rdquo; is the reverse.
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-gray-500 border-b border-black/10">
                    <th className="py-2 pr-3 font-medium">Tag</th>
                    <th className="py-2 pr-3 font-medium">Axis</th>
                    <th className="py-2 pr-3 font-medium text-right">Stored</th>
                    <th className="py-2 pr-3 font-medium text-right">Jev</th>
                    <th className="py-2 pr-3 font-medium text-right">Both</th>
                    <th className="py-2 pr-3 font-medium text-right">Jev only</th>
                    <th className="py-2 pr-3 font-medium text-right">Stored only</th>
                    <th className="py-2 pr-3 font-medium text-right">Precision</th>
                    <th className="py-2 font-medium text-right">Recall</th>
                  </tr>
                </thead>
                <tbody>
                  {metrics.tags.map((row) => (
                    <tr key={`${row.axis}:${row.tag}`} className={`border-b border-black/5 ${row.disagreements === 0 ? 'text-gray-500' : 'text-gray-800'}`}>
                      <td className="py-1.5 pr-3 font-medium">{row.tag}</td>
                      <td className="py-1.5 pr-3 text-gray-500">{THRESHOLD_LABELS[row.axis]}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">{row.baselineCount}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">{row.jevCount}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">{row.agree}</td>
                      <td className={`py-1.5 pr-3 text-right tabular-nums ${row.jevOnly ? 'text-amber-800' : ''}`}>{row.jevOnly}</td>
                      <td className={`py-1.5 pr-3 text-right tabular-nums ${row.baselineOnly ? 'text-rose-800' : ''}`}>{row.baselineOnly}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">{formatPct(row.precision)}</td>
                      <td className="py-1.5 text-right tabular-nums">{formatPct(row.recall)}</td>
                    </tr>
                  ))}
                  {metrics.tags.length === 0 ? (
                    <tr><td colSpan={9} className="py-3 text-center text-gray-500">No tags on either side at these thresholds.</td></tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </section>

          <section className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">Papers</h2>
                <p className="text-sm text-gray-500">
                  Showing {visiblePapers.length} of {run.papers.length}. Chips read tag, who applied it, and
                  Jev&apos;s probability; a dotted underline marks a probability within 0.15 of the threshold.
                </p>
              </div>
              <div className="flex items-center gap-1 rounded-lg border border-black/10 p-1 bg-white">
                {FILTERS.map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => setFilter(item.key)}
                    className={`px-3 py-1 rounded text-sm ${filter === item.key ? 'bg-purple text-white' : 'text-gray-700 hover:bg-gray-100'}`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex flex-wrap gap-2 text-xs text-gray-600">
              <span className={`rounded-full border px-2 py-0.5 ${CHIP_STYLES.agree}`}>both systems applied the tag</span>
              <span className={`rounded-full border px-2 py-0.5 ${CHIP_STYLES.jevOnly}`}>Jev only</span>
              <span className={`rounded-full border px-2 py-0.5 ${CHIP_STYLES.baselineOnly}`}>stored classification only</span>
            </div>
            {visiblePapers.length === 0 ? (
              <p className="text-sm text-gray-500 bg-white border border-black/5 rounded-xl p-5 shadow-sm">
                {filter === 'all' ? 'No papers in this run.' : 'Nothing matches this filter.'}
              </p>
            ) : null}
            {visiblePapers.map(({ paper, comparison }) => (
              <PaperCard
                key={paper.pmid}
                paper={paper}
                comparison={comparison}
                thresholds={thresholds}
                expanded={Boolean(expanded[paper.pmid])}
                onToggle={() => setExpanded({ ...expanded, [paper.pmid]: !expanded[paper.pmid] })}
              />
            ))}
          </section>
        </>
      ) : null}
    </main>
  )
}
