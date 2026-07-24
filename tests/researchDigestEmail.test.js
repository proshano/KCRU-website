import assert from 'node:assert/strict'
import test from 'node:test'

const { buildResearchDigestEmail } = await import('../lib/researchDigestEmailTemplate.js')
const { normalizeResearchDigestSettings } = await import('../lib/researchDigestConfig.js')

const SETTINGS = normalizeResearchDigestSettings({})
const ISSUE = { date: '2026-07-24', slug: '2026-07-24' }
const SUBSCRIBER = { name: 'Pavel', manageToken: 'tok-123' }

function makePaper(overrides = {}) {
  return {
    title: 'Dapagliflozin in patients with advanced chronic kidney disease',
    journal: 'New England Journal of Medicine',
    pubDate: '2026-07-22',
    tier: 'Tier 1',
    whyItMatters: 'Likely practice changing for advanced CKD.',
    summary: 'A large randomised trial. The primary outcome favoured treatment.',
    topics: ['SGLT2 inhibitors', 'CKD'],
    pmid: '40000001',
    ...overrides,
  }
}

function build(papers, settings = SETTINGS) {
  return buildResearchDigestEmail({
    subscriber: SUBSCRIBER,
    issue: ISSUE,
    papers,
    settings,
    siteBaseUrl: 'https://www.kcru.ca',
  })
}

test('subject leads with the paper itself', () => {
  const email = build([makePaper()])
  assert.match(email.subject, /^Dapagliflozin in patients with advanced chronic kidney/)
  assert.match(email.subject, /Jul 24, 2026$/)
  assert.doesNotMatch(email.subject, /\+ \d+ more/)
})

test('subject counts the remaining papers when more than one ships', () => {
  const email = build([makePaper(), makePaper({ pmid: '2' }), makePaper({ pmid: '3' })])
  assert.match(email.subject, /\+ 2 more - Jul 24, 2026$/)
})

test('subject truncates a long lead title on a word boundary', () => {
  const longTitle = 'Effect of a multifaceted implementation strategy on guideline concordant care for patients with chronic kidney disease in primary care practices'
  const email = build([makePaper({ title: longTitle })])
  const leadPart = email.subject.split(' - ')[0]

  assert.ok(leadPart.length <= 74, `lead segment too long: ${leadPart.length}`)
  assert.match(leadPart, /…$/)
  assert.ok(longTitle.startsWith(leadPart.replace(/…$/, '')), 'truncation should be a prefix of the title')
})

test('an empty issue falls back to a generic subject', () => {
  const email = build([])
  assert.equal(email.subject, 'Today’s kidney research - Jul 24, 2026')
})

test('a configured subject template still wins', () => {
  const email = build([makePaper()], { ...SETTINGS, subjectTemplate: 'KCRU digest: {{paperCount}} {{paperNoun}}' })
  assert.equal(email.subject, 'KCRU digest: 1 paper')
})

test('a leadTitle template falls back when there is no paper to lead with', () => {
  const email = build([], { ...SETTINGS, subjectTemplate: '{{leadTitle}} - {{date}}' })
  assert.equal(email.subject, 'Today’s kidney research - Jul 24, 2026')
})

test('internal tier vocabulary never reaches the subscriber', () => {
  const email = build([makePaper()])
  assert.doesNotMatch(email.subject, /Tier/)
  assert.doesNotMatch(email.text, /Tier/)
  assert.doesNotMatch(email.html, /Tier/)
})

test('topics and a readable publication date reach the subscriber', () => {
  const email = build([makePaper()])
  assert.match(email.text, /Topics: SGLT2 inhibitors, CKD/)
  assert.match(email.html, /SGLT2 inhibitors/)
  assert.match(email.text, /New England Journal of Medicine - Jul 22, 2026/)
})

test('the plain-text part keeps its blank-line structure', () => {
  const email = build([makePaper()])
  const blocks = email.text.split('\n\n')

  assert.ok(blocks.length >= 5, `expected separated blocks, got ${blocks.length}`)
  assert.equal(blocks[0], 'Hi Pavel,')
  assert.match(email.text, /\n\nPaper\n\n1\. /)
  assert.ok(email.text.endsWith('--\nLondon Kidney Clinical Research'))
})

test('multiple papers are separated in the plain-text part', () => {
  const email = build([makePaper(), makePaper({ pmid: '2', title: 'Second paper' })])
  assert.match(email.text, /\n\n2\. Second paper/)
})

test('the manage URL is returned so a List-Unsubscribe header can use it', () => {
  const email = build([makePaper()])
  assert.equal(email.manageUrl, 'https://www.kcru.ca/updates/manage?token=tok-123')
  assert.match(email.text, /Manage preferences: https:\/\/www\.kcru\.ca\/updates\/manage\?token=tok-123/)
})

test('a subscriber without a manage token yields no manage URL', () => {
  const email = buildResearchDigestEmail({
    subscriber: { name: 'Pavel' },
    issue: ISSUE,
    papers: [makePaper()],
    settings: SETTINGS,
    siteBaseUrl: 'https://www.kcru.ca',
  })
  assert.equal(email.manageUrl, '')
  assert.doesNotMatch(email.text, /Manage preferences/)
})

test('paper titles are escaped in the HTML part', () => {
  const email = build([makePaper({ title: 'Kidney <script>alert(1)</script> outcomes' })])
  assert.doesNotMatch(email.html, /<script>/)
  assert.match(email.html, /&lt;script&gt;/)
})
