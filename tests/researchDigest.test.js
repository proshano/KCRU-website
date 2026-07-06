import assert from 'node:assert/strict'
import test from 'node:test'

process.env.NEXT_PUBLIC_SANITY_PROJECT_ID ||= 'abc123'
process.env.NEXT_PUBLIC_SANITY_DATASET ||= 'test'

const {
  buildJournalGroupPubMedQuery,
  getResearchDigestWindow,
  normalizeOpportunityUrl,
  parseOpportunityFeed,
} = await import('../lib/researchDigest.js')

const {
  normalizeResearchDigestSettings: normalizeSettingsFromConfig,
} = await import('../lib/researchDigestConfig.js')

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

test('research digest settings default to pilot-only sends', () => {
  const settings = normalizeSettingsFromConfig({})

  assert.equal(settings.pilotMode, true)
  assert.deepEqual(settings.pilotRecipients, [])
})

test('research digest settings normalize pilot recipients', () => {
  const settings = normalizeSettingsFromConfig({
    pilotMode: true,
    pilotRecipients: ['PAVEL@example.org', 'bad-email', 'pavel@example.org'],
  })

  assert.deepEqual(settings.pilotRecipients, ['pavel@example.org'])
})
