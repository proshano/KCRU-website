import assert from 'node:assert/strict'
import test from 'node:test'

process.env.NEXT_PUBLIC_SANITY_PROJECT_ID ||= 'abc123'
process.env.NEXT_PUBLIC_SANITY_DATASET ||= 'test'

const {
  buildJournalGroupPubMedQuery,
  buildKidneyTopicPubMedFilter,
  getResearchDigestWindow,
  hasExcludedDigestPublicationType,
  normalizeOpportunityUrl,
  parseOpportunityFeed,
  selectAutomatedDigestPapers,
} = await import('../lib/researchDigest.js')

const {
  normalizeResearchDigestSettings: normalizeSettingsFromConfig,
} = await import('../lib/researchDigestConfig.js')

test('adds kidney topic filters to broad journal groups', () => {
  const query = buildJournalGroupPubMedQuery(
    { key: 'general_medicine', journals: ['JAMA'] },
    { from: '2026/05/22', to: '2026/05/29' }
  )

  assert.match(query, /kidney"\[Title\/Abstract\]/)
  assert.match(query, /JAMA"\[Journal\]/)
})

test('does not add kidney topic filters to kidney-native journal groups', () => {
  const query = buildJournalGroupPubMedQuery(
    { key: 'kidney_nephrology', journals: ['Kidney International'] },
    { from: '2026/05/22', to: '2026/05/29' }
  )

  assert.doesNotMatch(query, /Title\/Abstract\]/)
  assert.match(query, /Kidney International"\[Journal\]/)
})

test('buildKidneyTopicPubMedFilter covers core kidney terms', () => {
  const filter = buildKidneyTopicPubMedFilter()
  assert.match(filter, /nephrology"\[Title\/Abstract\]/)
  assert.match(filter, /proteinuria"\[Title\/Abstract\]/)
})

test('builds PubMed journal queries against entry date', () => {
  const query = buildJournalGroupPubMedQuery(
    { journals: ['Journal of the American Society of Nephrology', 'Kidney International'] },
    { from: '2026/05/22', to: '2026/05/29' }
  )

  assert.match(query, /Journal of the American Society of Nephrology"\[Journal\]/)
  assert.match(query, /Kidney International"\[Journal\]/)
  assert.match(query, /"2026\/05\/22"\[EDAT\] : "2026\/05\/29"\[EDAT\]/)
})

test('uses a longer PubMed window on Mondays', () => {
  const monday = new Date('2026-06-01T12:00:00Z')
  const friday = new Date('2026-05-29T12:00:00Z')

  assert.equal(getResearchDigestWindow(monday, 'UTC').days, 14)
  assert.equal(getResearchDigestWindow(friday, 'UTC').days, 7)
})

test('normalizes opportunity URLs for deduplication', () => {
  assert.equal(
    normalizeOpportunityUrl('https://example.org/path/?utm_source=email&b=2#section'),
    'https://example.org/path?b=2'
  )
})

test('parses RSS opportunity feeds into pending candidates', () => {
  const xml = `
    <rss><channel>
      <item>
        <title>Kidney grant deadline: June 30, 2026</title>
        <link>https://example.org/grants/kidney?utm_medium=email</link>
        <guid>grant-1</guid>
        <description>Funding for kidney research teams. Deadline: June 30, 2026.</description>
      </item>
    </channel></rss>
  `

  const items = parseOpportunityFeed(xml, {
    name: 'Example funder',
    url: 'https://example.org/feed.xml',
    type: 'grant',
    topics: ['Kidney'],
  })

  assert.equal(items.length, 1)
  assert.equal(items[0].title, 'Kidney grant deadline: June 30, 2026')
  assert.equal(items[0].sourceName, 'Example funder')
  assert.equal(items[0].type, 'grant')
  assert.equal(items[0].deadline, '2026-06-30')
  assert.deepEqual(items[0].topics, ['Kidney'])
})

test('research digest settings default to a small automated daily send', () => {
  const settings = normalizeSettingsFromConfig({})

  assert.equal(settings.automaticSelection, true)
  assert.equal(settings.publicEnabled, false)
  assert.equal(settings.maxPapers, 3)
  assert.equal(settings.minPriorityScore, 75)
  assert.equal(settings.pilotMode, false)
  assert.deepEqual(settings.pilotRecipients, [])
})

test('research digest public launch requires an explicit enable flag', () => {
  assert.equal(normalizeSettingsFromConfig({ publicEnabled: true }).publicEnabled, true)
  assert.equal(normalizeSettingsFromConfig({ publicEnabled: 'true' }).publicEnabled, false)
})

test('research digest settings normalize pilot recipients', () => {
  const settings = normalizeSettingsFromConfig({
    pilotMode: true,
    pilotRecipients: ['PAVEL@example.org', 'bad-email', 'pavel@example.org'],
  })

  assert.deepEqual(settings.pilotRecipients, ['pavel@example.org'])
})

test('automated selection chooses only the highest-priority eligible papers', () => {
  const base = {
    triageStatus: 'include',
    tier: 'Tier 2',
    whyItMatters: 'Useful to kidney clinicians.',
    summary: 'A concise, complete summary.',
    publicationTypes: ['Journal Article'],
  }
  const papers = [
    { ...base, _id: 'a', pmid: '1', priorityScore: 95 },
    { ...base, _id: 'b', pmid: '2', priorityScore: 88 },
    { ...base, _id: 'c', pmid: '3', priorityScore: 80 },
    { ...base, _id: 'below-threshold', pmid: '4', priorityScore: 74 },
    { ...base, _id: 'uncertain', pmid: '5', priorityScore: 99, triageStatus: 'maybe' },
    { ...base, _id: 'case-report', pmid: '6', priorityScore: 99, publicationTypes: ['Case Reports'] },
    { ...base, _id: 'triage-error', pmid: '7', priorityScore: 99, triageError: 'provider failed' },
    { ...base, _id: 'manual-exclusion', pmid: '8', priorityScore: 99, autoSelectionExcluded: true },
  ]

  const selected = selectAutomatedDigestPapers(papers, {
    maxPapers: 3,
    minPriorityScore: 75,
  })

  assert.deepEqual(selected.map((paper) => paper._id), ['a', 'b', 'c'])
})

test('automated selection supports legacy papers using tier fallback scores', () => {
  const base = {
    triageStatus: 'include',
    whyItMatters: 'Useful to kidney clinicians.',
    summary: 'A concise, complete summary.',
    publicationTypes: ['Journal Article'],
  }
  const selected = selectAutomatedDigestPapers([
    { ...base, _id: 'tier-3', tier: 'Tier 3', priorityScore: null },
    { ...base, _id: 'tier-1', tier: 'Tier 1' },
    { ...base, _id: 'tier-2', tier: 'Tier 2', priorityScore: null },
  ], {
    maxPapers: 3,
    minPriorityScore: 75,
  })

  assert.deepEqual(selected.map((paper) => paper._id), ['tier-1', 'tier-2'])
})

test('excludes low-value publication types before LLM selection', () => {
  assert.equal(hasExcludedDigestPublicationType(['Journal Article', 'Editorial']), true)
  assert.equal(hasExcludedDigestPublicationType(['Randomized Controlled Trial']), false)
  assert.equal(hasExcludedDigestPublicationType(null), false)
})

test('uses the safe score threshold for null settings while allowing an explicit zero', () => {
  assert.equal(normalizeSettingsFromConfig({ minPriorityScore: null }).minPriorityScore, 75)
  assert.equal(normalizeSettingsFromConfig({ minPriorityScore: '' }).minPriorityScore, 75)
  assert.equal(normalizeSettingsFromConfig({ minPriorityScore: 0 }).minPriorityScore, 0)
})
