import assert from 'node:assert/strict'
import test from 'node:test'

process.env.NEXT_PUBLIC_SANITY_PROJECT_ID ||= 'abc123'
process.env.NEXT_PUBLIC_SANITY_DATASET ||= 'test'

const { computeEvalMetrics, comparePaper } = await import('../lib/classificationEvalMetrics.js')
const { buildJevQuestions } = await import('../lib/jevClassifier.js')
const {
  fetchPublicationClassificationSettings,
  patchPublicationClassificationSettings,
  resolveBaseline,
  runClassificationEval,
  seededShuffle,
  selectEvalPublications,
} = await import('../lib/classificationEval.js')

function probabilities(high = [], mid = {}) {
  const { index } = buildJevQuestions()
  return Object.values(index).map(({ axis, tag }) => ({
    axis,
    tag,
    p: high.includes(tag) ? 0.9 : mid[tag] ?? 0.05,
  }))
}

function paper(pmid, baseline, jevHigh, extra = {}) {
  return {
    pmid,
    title: `Paper ${pmid}`,
    publicationTypeExcluded: false,
    baseline: { source: 'cache', exclude: false, topics: [], studyDesign: [], methodologicalFocus: [], ...baseline },
    jev: { probabilities: probabilities(jevHigh, extra.mid), latencyMs: 300, inputTokens: 1000, outputTokens: 0, error: extra.error || null },
    ...extra.paper,
  }
}

test('comparePaper splits tags into agree / jev-only / stored-only per axis', () => {
  const comparison = comparePaper(
    paper('1', { topics: ['Hemodialysis', 'Bone Health'], studyDesign: ['Observational Study'] }, ['Hemodialysis', 'Observational Study', 'Administrative Data']),
    { topics: 0.5, studyDesign: 0.5, methodologicalFocus: 0.5, exclude: 0.5 }
  )
  assert.deepEqual(comparison.axes.topics.agree, ['Hemodialysis'])
  assert.deepEqual(comparison.axes.topics.baselineOnly, ['Bone Health'])
  assert.deepEqual(comparison.axes.methodologicalFocus.jevOnly, ['Administrative Data'])
  assert.equal(comparison.axes.studyDesign.exact, true)
  assert.equal(comparison.allExact, false)
  assert.equal(comparison.disagreements, 2)
})

test('comparePaper folds the publication-type exclusion into the Jev side', () => {
  const comparison = comparePaper(
    paper('1', { exclude: true }, [], { paper: { publicationTypeExcluded: true } }),
    { topics: 0.5, studyDesign: 0.5, methodologicalFocus: 0.5, exclude: 0.5 }
  )
  assert.equal(comparison.exclude.jev, true)
  assert.equal(comparison.exclude.exact, true)
})

test('computeEvalMetrics scores axes, tags and usage and responds to thresholds', () => {
  const papers = [
    paper('1', { topics: ['Hemodialysis'], studyDesign: ['Observational Study'] }, ['Hemodialysis', 'Observational Study']),
    paper('2', { topics: ['Acute Kidney Injury'], studyDesign: ['Interventional Study'] }, ['Acute Kidney Injury', 'Observational Study'], {
      mid: { 'Interventional Study': 0.45 },
    }),
    paper('3', { topics: [] }, [], { error: 'boom' }),
  ]
  const at50 = computeEvalMetrics(papers, { topics: 0.5, studyDesign: 0.5, methodologicalFocus: 0.5, exclude: 0.5 })
  assert.equal(at50.papers, 3)
  assert.equal(at50.scored, 2)
  assert.equal(at50.errors, 1)
  assert.equal(at50.allExact, 1)
  assert.equal(at50.axes.topics.exactMatches, 2)
  assert.equal(at50.axes.topics.precision, 1)
  assert.equal(at50.axes.studyDesign.truePositives, 1)
  assert.equal(at50.axes.studyDesign.jevOnly, 1)
  assert.equal(at50.axes.studyDesign.baselineOnly, 1)
  assert.equal(at50.axes.studyDesign.precision, 0.5)
  assert.equal(at50.axes.studyDesign.recall, 0.5)
  assert.equal(at50.usage.inputTokens, 3000)
  assert.ok(at50.usage.estimatedUsd > 0)
  assert.equal(at50.latency.meanMs, 300)
  const worst = at50.tags[0]
  assert.equal(worst.disagreements, 1)
  assert.ok(['Interventional Study', 'Observational Study'].includes(worst.tag))

  // Lowering the study-design threshold below 0.45 brings Interventional Study back.
  const at40 = computeEvalMetrics(papers, { studyDesign: 0.4 })
  assert.equal(at40.axes.studyDesign.baselineOnly, 0)
  assert.equal(at40.axes.studyDesign.recall, 1)
})

test('seededShuffle is deterministic for a seed and differs across seeds', () => {
  const items = Array.from({ length: 30 }, (_, i) => i)
  assert.deepEqual(seededShuffle(items, 7), seededShuffle(items, 7))
  assert.notDeepEqual(seededShuffle(items, 7), seededShuffle(items, 8))
  assert.deepEqual([...seededShuffle(items, 7)].sort((a, b) => a - b), items)
})

test('resolveBaseline prefers a classification document and needs some stored tags otherwise', () => {
  const doc = { status: 'ok', provider: 'openrouter', model: 'openai/gpt-5.6-luna', topics: ['Hemodialysis'], exclude: false }
  assert.equal(resolveBaseline({ topics: ['Bone Health'] }, doc).source, 'pubmedClassification')
  assert.deepEqual(resolveBaseline({ topics: ['Bone Health'] }, doc).topics, ['Hemodialysis'])
  assert.equal(resolveBaseline({ topics: ['Bone Health'] }, { status: 'error' }).source, 'cache')
  assert.equal(resolveBaseline({ topics: [], studyDesign: [], methodologicalFocus: [] }, undefined), null)
  assert.equal(resolveBaseline({ exclude: true }, undefined).exclude, true)
})

test('selectEvalPublications filters to eligible papers and honours count, year and pmids', () => {
  const publications = [
    { pmid: '1', title: 'A', year: 2025, abstract: 'x'.repeat(80), topics: ['Hemodialysis'] },
    { pmid: '2', title: 'B', year: 2025, abstract: 'short', topics: ['Hemodialysis'] },
    { pmid: '3', title: 'C', year: 2024, abstract: 'x'.repeat(80), topics: [] },
    { pmid: '4', title: 'D', year: 2024, abstract: 'x'.repeat(80), topics: ['Bone Health'] },
    { pmid: '5', title: 'E', year: 2026, abstract: 'x'.repeat(80), topics: [] },
  ]
  const classifications = new Map([['5', { status: 'ok', topics: ['Obesity'] }]])
  const all = selectEvalPublications({ publications, classifications, count: 10, seed: 1 })
  assert.equal(all.eligibleCount, 3)
  assert.deepEqual(all.selected.map((item) => item.publication.pmid).sort(), ['1', '4', '5'])

  const two = selectEvalPublications({ publications, classifications, count: 2, seed: 1 })
  assert.equal(two.selected.length, 2)
  assert.deepEqual(
    two.selected.map((item) => item.publication.pmid),
    selectEvalPublications({ publications, classifications, count: 2, seed: 1 }).selected.map((item) => item.publication.pmid)
  )

  const year = selectEvalPublications({ publications, classifications, count: 10, seed: 1, year: '2024' })
  assert.deepEqual(year.selected.map((item) => item.publication.pmid), ['4'])

  const pinned = selectEvalPublications({ publications, classifications, count: 1, seed: 1, pmids: ['4', '5', '2'] })
  assert.deepEqual(pinned.selected.map((item) => item.publication.pmid), ['4', '5'])
})

test('runClassificationEval classifies the sample, records both sides and stores one document', async () => {
  const { index } = buildJevQuestions()
  const created = []
  const client = {
    create: async (doc) => {
      created.push(doc)
      return { ...doc, _id: 'run-1' }
    },
    fetch: async () => [],
  }
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body)
    const answers = {}
    const title = body.state.title
    for (const name of Object.keys(body.questions)) {
      const { tag } = index[name]
      const yes = (title.includes('dialysis') && tag === 'Hemodialysis') || tag === 'Observational Study'
      answers[name] = { type: 'noul', noul: yes ? 0.85 : 0.1 }
    }
    return new Response(JSON.stringify({ model: 'jev-1.13', answers, usage: { input_tokens: 700, output_tokens: 0 } }), { status: 200 })
  }
  const cache = {
    publications: [
      { pmid: '10', title: 'Home dialysis outcomes', year: 2026, abstract: 'x'.repeat(100), topics: ['Hemodialysis'], studyDesign: ['Observational Study'], methodologicalFocus: [] },
      { pmid: '11', title: 'Correction: something', year: 2026, abstract: 'x'.repeat(100), publicationTypes: ['Published Erratum'], topics: [], studyDesign: [], methodologicalFocus: [], exclude: true },
      { pmid: '12', title: 'Glomerular study', year: 2026, abstract: 'x'.repeat(100), topics: ['Glomerular Disease'], studyDesign: ['Interventional Study'], methodologicalFocus: [] },
    ],
  }

  const saved = { TYPESAFE_API_KEY: process.env.TYPESAFE_API_KEY, JEV_TRANSPORT: process.env.JEV_TRANSPORT }
  process.env.TYPESAFE_API_KEY = 'k'
  delete process.env.JEV_TRANSPORT
  try {
    const dry = await runClassificationEval({ cache, client, fetch: fetchImpl, count: 5, seed: 3, dryRun: true })
    assert.equal(dry.dryRun, true)
    assert.equal(dry.selection.eligibleCount, 3)
    assert.equal(created.length, 0)

    const result = await runClassificationEval({ cache, client, fetch: fetchImpl, count: 5, seed: 3, label: 'test run', requestedBy: 'a@b.c' })
    assert.equal(result.persisted, true)
    assert.equal(created.length, 1)
    const run = result.run
    assert.equal(run._id, 'run-1')
    assert.equal(run._type, 'classificationEvalRun')
    assert.equal(run.label, 'test run')
    assert.equal(run.requestedBy, 'a@b.c')
    assert.equal(run.model, 'jev-1.13')
    assert.equal(run.transport, 'typesafe')
    assert.equal(run.status, 'ok')
    assert.equal(run.papers.length, 3)
    assert.equal(run.summary.papers, 3)
    assert.equal(run.summary.axes.length, 3)

    const byPmid = Object.fromEntries(run.papers.map((entry) => [entry.pmid, entry]))
    assert.deepEqual(byPmid['10'].jev.topics, ['Hemodialysis'])
    assert.deepEqual(byPmid['10'].jev.studyDesign, ['Observational Study'])
    assert.equal(byPmid['10'].jev.probabilities.length, Object.keys(index).length)
    assert.ok(byPmid['10'].jev.probabilities.every((row) => row._key))
    assert.equal(byPmid['11'].publicationTypeExcluded, true)
    assert.equal(byPmid['11'].jev.exclude, true, 'publication-type rule applies to the Jev side')
    assert.equal(byPmid['11'].baseline.exclude, true)
    assert.equal(byPmid['12'].baseline.source, 'cache')
    assert.equal(byPmid['12'].jev.inputTokens, 700)

    // Paper 10 agrees on everything; 12 disagrees (Jev found no glomerular focus and called it observational).
    const comparison = result.metrics.comparisons.find((entry) => entry.pmid === '10')
    assert.equal(comparison.allExact, true)
    assert.equal(result.metrics.axes.topics.baselineOnly, 1)
  } finally {
    if (saved.TYPESAFE_API_KEY === undefined) delete process.env.TYPESAFE_API_KEY
    else process.env.TYPESAFE_API_KEY = saved.TYPESAFE_API_KEY
    if (saved.JEV_TRANSPORT !== undefined) process.env.JEV_TRANSPORT = saved.JEV_TRANSPORT
  }
})

test('runClassificationEval refuses to run without a credential', async () => {
  const saved = { TYPESAFE_API_KEY: process.env.TYPESAFE_API_KEY, OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY }
  delete process.env.TYPESAFE_API_KEY
  delete process.env.OPENROUTER_API_KEY
  try {
    await assert.rejects(
      runClassificationEval({ cache: { publications: [] }, client: { fetch: async () => [] } }),
      /Missing OPENROUTER_API_KEY/
    )
  } finally {
    if (saved.TYPESAFE_API_KEY !== undefined) process.env.TYPESAFE_API_KEY = saved.TYPESAFE_API_KEY
    if (saved.OPENROUTER_API_KEY !== undefined) process.env.OPENROUTER_API_KEY = saved.OPENROUTER_API_KEY
  }
})

test('runClassificationEval starts from the production thresholds stored in Sanity', async () => {
  const { index } = buildJevQuestions()
  const client = {
    create: async (doc) => ({ ...doc, _id: 'run-2' }),
    fetch: async (query) => (query.includes('siteSettings')
      ? { _id: 'settings', publicationClassification: { backend: 'jev', jevThresholdTopics: 0.8 } }
      : []),
  }
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body)
    const answers = {}
    for (const name of Object.keys(body.questions)) {
      answers[name] = { type: 'noul', noul: index[name].tag === 'Hemodialysis' ? 0.7 : 0.1 }
    }
    return new Response(JSON.stringify({ answers }), { status: 200 })
  }
  const cache = {
    publications: [
      { pmid: '20', title: 'Dialysis', year: 2026, abstract: 'x'.repeat(100), topics: ['Hemodialysis'], studyDesign: [], methodologicalFocus: [] },
    ],
  }
  const saved = process.env.TYPESAFE_API_KEY
  process.env.TYPESAFE_API_KEY = 'k'
  try {
    const result = await runClassificationEval({ cache, client, fetch: fetchImpl, count: 1, seed: 1 })
    assert.equal(result.run.thresholds.topics, 0.8)
    assert.equal(result.run.thresholds.studyDesign, 0.5)
    // 0.7 is below the production topics threshold of 0.8, so Jev applies no topic.
    assert.deepEqual(result.run.papers[0].jev.topics, [])
    const explicit = await runClassificationEval({ cache, client, fetch: fetchImpl, count: 1, seed: 1, thresholds: { topics: 0.6 } })
    assert.deepEqual(explicit.run.papers[0].jev.topics, ['Hemodialysis'])
  } finally {
    if (saved === undefined) delete process.env.TYPESAFE_API_KEY
    else process.env.TYPESAFE_API_KEY = saved
  }
})

test('production classification settings are read with effective thresholds and patched in place', async () => {
  const stored = { _id: 'settings', publicationClassification: { backend: 'chat', jevThresholdExclude: 0.9 } }
  const patches = []
  const client = {
    fetch: async () => stored,
    patch: (id) => ({
      set: (value) => ({
        commit: async () => {
          patches.push({ id, value })
        },
      }),
    }),
  }
  const read = await fetchPublicationClassificationSettings(client)
  assert.equal(read.backend, 'chat')
  assert.deepEqual(read.thresholds, { exclude: 0.9 })
  assert.equal(read.effectiveThresholds.exclude, 0.9)
  assert.equal(read.effectiveThresholds.topics, 0.5)

  const written = await patchPublicationClassificationSettings(client, {
    thresholds: { topics: 0.65, studyDesign: 0.55 },
    thresholdsSource: 'run-1 by a@b.c',
  })
  assert.equal(patches.length, 1)
  assert.equal(patches[0].id, 'settings')
  const block = patches[0].value.publicationClassification
  assert.equal(block.backend, 'chat')
  assert.equal(block.jevThresholdTopics, 0.65)
  assert.equal(block.jevThresholdStudyDesign, 0.55)
  assert.equal(block.jevThresholdExclude, 0.9, 'untouched thresholds survive')
  assert.equal(block.thresholdsSource, 'run-1 by a@b.c')
  assert.ok(block.thresholdsUpdatedAt)
  assert.equal(written.effectiveThresholds.topics, 0.65)
  assert.equal(written.effectiveThresholds.exclude, 0.9)
})
