import assert from 'node:assert/strict'
import test from 'node:test'

import { planLegacyRemoval, planSiteTeamMigration } from '../scripts/migrate-site-teams.js'

const SITES = [
  { _id: 'site-uh', name: 'University Hospital', shortName: 'UH', coordinatesStudies: true },
  { _id: 'site-kcc', name: 'Westmount', shortName: 'KCC', coordinatesStudies: false },
]
const RESEARCHERS = [
  { _id: 'r-garg', name: 'Amit Garg', primarySiteId: 'site-uh' },
  { _id: 'r-draft', name: 'Draft Only', primarySiteId: null, draftPrimarySiteId: 'site-uh' },
  { _id: 'r-kcc', name: 'Clinic PI', primarySiteId: 'site-kcc' },
]

test('planSiteTeamMigration converts legacy studies, infers the site from a published primary site, and reports the rest', () => {
  const studies = [
    { _id: 's1', _rev: 'r1', title: 'Inferred', status: 'recruiting', principalInvestigatorId: 'r-garg', localContact: { email: 'a@b.ca' }, acceptsReferrals: true },
    { _id: 's2', _rev: 'r2', title: 'Draft site', status: 'coming_soon', principalInvestigatorId: 'r-draft' },
    { _id: 's3', _rev: 'r3', title: 'Clinic', status: 'completed', principalInvestigatorId: 'r-kcc' },
    { _id: 's4', _rev: 'r4', title: 'Outside PI', status: 'recruiting', principalInvestigatorName: 'Someone Else' },
    { _id: 's5', _rev: 'r5', title: 'Already done', siteTeams: [{ _key: 'x' }], principalInvestigatorId: 'r-garg' },
    { _id: 's6', _rev: 'r6', title: 'Empty', status: 'recruiting' },
  ]
  const plan = planSiteTeamMigration({ studies, researchers: RESEARCHERS, sites: SITES })

  assert.deepEqual(plan.counts, {
    studies: 6,
    alreadyMigrated: 1,
    converted: 4,
    siteInferred: 1,
    needsSite: 3,
    noLegacyData: 1,
  })
  assert.equal(plan.patches.length, 4)

  const inferred = plan.patches.find((patch) => patch.id === 's1')
  assert.equal(inferred.rev, 'r1')
  const [team] = inferred.set.siteTeams
  assert.deepEqual(team.site, { _type: 'reference', _ref: 'site-uh' })
  assert.equal(team.status, 'enrolling')
  assert.equal(team.acceptsReferrals, true)
  assert.equal(team.contact.email, 'a@b.ca')

  const draftSite = plan.patches.find((patch) => patch.id === 's2')
  assert.equal(draftSite.set.siteTeams[0].site, undefined)
  assert.equal(draftSite.set.siteTeams[0].status, 'not_yet_enrolling')

  assert.ok(plan.lines.some((line) => line.includes("Inferred [s1] -> University Hospital (from Amit Garg's primary site)")))
  assert.ok(plan.lines.some((line) => line.includes('unpublished Studio draft')))
  assert.ok(plan.lines.some((line) => line.includes('does not coordinate studies')))
  assert.ok(plan.lines.some((line) => line.includes('"Someone Else" is not a researcher record')))
  assert.ok(plan.lines.some((line) => line.includes('Empty [s6] -> no PI or contact to convert')))
})

test('planLegacyRemoval refuses while a study lacks a team with a PI, then unsets only the legacy fields', () => {
  const blocked = planLegacyRemoval({
    studies: [
      { _id: 's1', _rev: 'r1', title: 'Fine', siteTeams: [{ _key: 'a', siteId: 'site-uh', principalInvestigatorId: 'r-garg' }] },
      { _id: 's2', _rev: 'r2', title: 'No PI', siteTeams: [{ _key: 'b', siteId: 'site-uh' }] },
    ],
  })
  assert.equal(blocked.ok, false)
  assert.deepEqual(blocked.blocking, ['No PI [s2]'])

  const notMigrated = planLegacyRemoval({
    studies: [{ _id: 's3', _rev: 'r3', title: 'Legacy only', principalInvestigatorId: 'r-garg' }],
  })
  assert.equal(notMigrated.ok, false)
  assert.match(notMigrated.blocking[0], /has no siteTeams yet/)

  const ready = planLegacyRemoval({
    studies: [
      { _id: 's1', _rev: 'r1', title: 'Fine', siteTeams: [{ _key: 'a', siteId: 'site-uh', principalInvestigatorId: 'r-garg' }], principalInvestigatorId: 'r-garg', acceptsReferrals: false },
      { _id: 's4', _rev: 'r4', title: 'Clean', siteTeams: [{ _key: 'c', siteId: 'site-uh', principalInvestigatorName: 'X' }] },
    ],
  })
  assert.equal(ready.ok, true)
  assert.deepEqual(ready.patches, [
    { id: 's1', rev: 'r1', unset: ['localContact', 'principalInvestigator', 'principalInvestigatorName', 'acceptsReferrals'] },
  ])
})
