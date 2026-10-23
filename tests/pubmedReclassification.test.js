import assert from 'node:assert/strict'
import test from 'node:test'

process.env.NEXT_PUBLIC_SANITY_PROJECT_ID ||= 'abc123'
process.env.NEXT_PUBLIC_SANITY_DATASET ||= 'test'

const { runPubmedReclassification } = await import('../lib/pubmedReclassification.js')

// A dry run with an explicit selection never reaches Sanity or the classifier: the settings
// and cache are injected, no existing-classification lookup runs, and it returns before
// classifying. That makes the selection logic testable on its own.
const cache = {
  generatedAt: '2026-10-01T00:00:00.000Z',
  publications: [
    {
      pmid: '101',
      year: '2026',
      title: 'Pregnancy Outcomes After Living Kidney Donation',
      abstract: 'Pregnancies in women who had donated a kidney were compared with matched nondonors.',
    },
    {
      pmid: '102',
      year: '2025',
      title: 'Graft survival after deceased donor kidney transplantation',
      abstract: 'Recipients of deceased donor kidneys were followed for graft loss.',
    },
    {
      pmid: '103',
      year: '2024',
      title: 'Blood pressure after nephrectomy',
      abstract: '',
      laySummary: 'Researchers followed living donors for ten years after donor nephrectomy.',
    },
    {
      pmid: '104',
      year: '2023',
      title: 'Peritonitis in peritoneal dialysis',
      abstract: 'Peritonitis rates were compared across solutions.',
    },
  ],
}

function run(options) {
  return runPubmedReclassification({ settings: {}, cache, dryRun: true, ...options })
}

test('match selects papers whose title, abstract or lay summary matches, already classified or not', async () => {
  const result = await run({ match: 'living (kidney )?don|donor nephrectomy' })
  assert.equal(result.dryRun, true)
  assert.equal(result.count, 0)
  assert.deepEqual(result.selection.targetPmids, ['101', '103'])
  assert.equal(result.selection.appliedMissingOnly, false)
  assert.equal(result.selection.matchPattern, 'living (kidney )?don|donor nephrectomy')
  assert.equal(result.selection.selectedCount, 2)
})

test('match is case-insensitive and is not capped by count', async () => {
  const result = await run({ match: 'DONOR', count: 1 })
  assert.deepEqual(result.selection.targetPmids, ['101', '102', '103'])
})

test('match narrows an explicit PMID list and respects the year filter', async () => {
  const byPmid = await run({ match: 'donor', pmids: ['102', '104'] })
  assert.deepEqual(byPmid.selection.targetPmids, ['102'])
  const byYear = await run({ match: 'donor', year: '2024' })
  assert.deepEqual(byYear.selection.targetPmids, ['103'])
})

test('a match pattern that selects nothing or does not parse is an error', async () => {
  await assert.rejects(() => run({ match: 'glomerulonephritis' }), /No publications selected/)
  await assert.rejects(() => run({ match: '(' }), /Invalid match pattern/)
})

test('a stored Site Settings prompt is used by default and its missing tag rows are reported', async () => {
  const stale = '| **Kidney Transplantation** | Transplant: donor/recipient outcomes |'
  const stored = await run({ match: 'donor', settings: { llmClassificationPrompt: stale } })
  assert.equal(stored.usedPrompt, stale)
  assert.equal(stored.prompt.source, 'site-settings')
  assert.ok(stored.prompt.missingTags.includes('Living Kidney Donation'))
  assert.ok(!stored.prompt.missingTags.includes('Kidney Transplantation'))
})

test('useBuiltInPrompt ignores the stored prompt, and an explicit override wins over both', async () => {
  const stale = '| **Kidney Transplantation** | Transplant: donor/recipient outcomes |'
  const builtIn = await run({ match: 'donor', settings: { llmClassificationPrompt: stale }, useBuiltInPrompt: true })
  assert.equal(builtIn.prompt.source, 'built-in')
  assert.deepEqual(builtIn.prompt.missingTags, [])
  assert.match(builtIn.usedPrompt, /\| \*\*Living Kidney Donation\*\* \|/)
  const override = await run({ match: 'donor', settings: { llmClassificationPrompt: stale }, useBuiltInPrompt: true, prompt: '| **Hypertension** | x |' })
  assert.equal(override.prompt.source, 'override')
  assert.equal(override.usedPrompt, '| **Hypertension** | x |')
})
