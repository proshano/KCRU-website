import assert from 'node:assert/strict'
import test from 'node:test'

import {
  LEGACY_STUDY_FIELDS,
  buildPatchFields,
  buildTrialSummaryDoc,
  buildUnsetFields,
  normalizeStudyPayload,
} from '../lib/studySubmissions.js'

const TEAM_PAYLOAD = {
  title: 'Two-site study',
  slug: 'two-site-study',
  nctId: 'nct12345678',
  status: 'recruiting',
  therapeuticAreaIds: ['area-1', 'area-1', 'area-2'],
  inclusionCriteria: 'Adults\neGFR &lt; 60',
  siteTeams: [
    {
      _key: 'k-uh',
      siteId: 'site-uh',
      status: 'enrolling',
      principalInvestigatorId: 'r-garg',
      contact: { name: 'Mika', email: 'mika@lhsc.on.ca', displayPublicly: true },
      acceptsReferrals: true,
    },
    {
      _key: 'k-vh',
      siteId: 'site-vh',
      status: 'not_yet_enrolling',
      principalInvestigatorName: 'Jane Doe',
      contact: {},
      acceptsReferrals: false,
    },
  ],
  recruitmentSiteIds: ['site-uh', 'site-kcc', 'site-uh'],
}

test('normalizeStudyPayload keeps two teams and the recruitment locations', () => {
  const normalized = normalizeStudyPayload(TEAM_PAYLOAD)
  assert.equal(normalized.nctId, 'NCT12345678')
  assert.deepEqual(normalized.therapeuticAreaIds, ['area-1', 'area-2'])
  assert.deepEqual(normalized.inclusionCriteria, ['Adults', 'eGFR < 60'])
  assert.equal(normalized.siteTeams.length, 2)
  assert.equal(normalized.siteTeams[0].contact.displayPublicly, true)
  assert.equal(normalized.siteTeams[1].status, 'not_yet_enrolling')
  assert.equal(normalized.siteTeams[1].principalInvestigatorName, 'Jane Doe')
  assert.deepEqual(normalized.recruitmentSiteIds, ['site-uh', 'site-kcc'])
  // The legacy single fields are never part of a normalized payload.
  for (const field of ['principalInvestigatorId', 'principalInvestigatorName', 'localContact', 'acceptsReferrals']) {
    assert.equal(field in normalized, false, field)
  }
})

test('a legacy payload (old submission or draft) normalizes to one team', () => {
  const normalized = normalizeStudyPayload({
    title: 'Old study',
    status: 'coming_soon',
    principalInvestigatorId: 'r-garg',
    localContact: { name: 'Mika', role: 'RN', email: 'mika@lhsc.on.ca', phone: '', displayPublicly: false },
    acceptsReferrals: true,
  })
  assert.equal(normalized.siteTeams.length, 1)
  const [team] = normalized.siteTeams
  assert.equal(team.siteId, '')
  assert.equal(team.status, 'not_yet_enrolling')
  assert.equal(team.principalInvestigatorId, 'r-garg')
  assert.equal(team.contact.role, 'RN')
  assert.equal(team.acceptsReferrals, true)
  assert.deepEqual(normalized.recruitmentSiteIds, [])

  assert.deepEqual(normalizeStudyPayload({ title: 'No people yet' }).siteTeams, [])
})

test('buildPatchFields writes team references and never the legacy fields; buildUnsetFields removes them', () => {
  const fields = buildPatchFields(normalizeStudyPayload(TEAM_PAYLOAD), 'two-site-study')
  assert.equal(fields.siteTeams.length, 2)
  assert.deepEqual(fields.siteTeams[0].site, { _type: 'reference', _ref: 'site-uh' })
  assert.deepEqual(fields.siteTeams[0].principalInvestigator, { _type: 'reference', _ref: 'r-garg' })
  assert.equal(fields.siteTeams[1].principalInvestigatorName, 'Jane Doe')
  assert.deepEqual(
    fields.recruitmentSites.map((ref) => ref._ref),
    ['site-uh', 'site-kcc']
  )
  assert.deepEqual(fields.slug, { _type: 'slug', current: 'two-site-study' })
  for (const field of LEGACY_STUDY_FIELDS) {
    assert.equal(field in fields, false, field)
  }
  const unset = buildUnsetFields()
  for (const field of LEGACY_STUDY_FIELDS) {
    assert.ok(unset.includes(field), field)
  }
})

test('both create paths build the same document as the update patch', () => {
  const normalized = normalizeStudyPayload(TEAM_PAYLOAD)
  const doc = buildTrialSummaryDoc(normalized, 'two-site-study')
  const patch = buildPatchFields(normalized, 'two-site-study')
  assert.equal(doc._type, 'trialSummary')
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) {
      assert.equal(key in doc, false, key)
    } else {
      assert.deepEqual(doc[key], value, key)
    }
  }
})
