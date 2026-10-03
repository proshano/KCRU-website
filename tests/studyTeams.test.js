import assert from 'node:assert/strict'
import test from 'node:test'

import {
  LEGACY_TEAM_KEY,
  createEmptyTeam,
  describePayloadTeam,
  formatTeamError,
  legacyPayloadTeam,
  listTeamInvestigators,
  normalizePayloadTeam,
  payloadTeamsToSanity,
  pickReferralTeam,
  publicTeamContact,
  referralOptionLabel,
  resolvePayloadTeams,
  resolveStudyTeams,
  studyAcceptsReferrals,
  summarizeStudyChanges,
  summarizePayloadTeam,
  teamStatusFromStudyStatus,
  teamsAcceptingReferrals,
  validateSiteTeams,
} from '../lib/studyTeams.js'

const UH = { _id: 'site-uh', name: 'University Hospital', shortName: 'UH', coordinatesStudies: true, recruitsPatients: true }
const VH = { _id: 'site-vh', name: 'Victoria Hospital', shortName: 'VH', coordinatesStudies: true, recruitsPatients: true }
const KCC = { _id: 'site-kcc', name: 'Westmount', shortName: 'KCC', coordinatesStudies: false, recruitsPatients: true }
const SITES = [UH, VH, KCC]
const RESEARCHERS = [
  { _id: 'r-garg', name: 'Amit Garg', primarySiteId: 'site-uh' },
  { _id: 'r-doe', name: 'Jane Doe', primarySiteId: 'site-vh' },
]

function team(overrides = {}) {
  return normalizePayloadTeam({
    _key: 'k-uh',
    siteId: 'site-uh',
    status: 'enrolling',
    principalInvestigatorId: 'r-garg',
    contact: { name: 'Mika', email: 'mika@lhsc.on.ca', displayPublicly: false },
    acceptsReferrals: true,
    ...overrides,
  })
}

test('a study that predates teams resolves to one legacy team in both shapes', () => {
  const doc = {
    status: 'coming_soon',
    principalInvestigator: { _id: 'r-garg', name: 'Amit Garg', slug: { current: 'amit-garg' } },
    localContact: { name: 'Mika', email: 'mika@lhsc.on.ca', displayPublicly: true },
    acceptsReferrals: true,
  }
  const [docTeam] = resolveStudyTeams(doc)
  assert.equal(docTeam._key, LEGACY_TEAM_KEY)
  assert.equal(docTeam.status, 'not_yet_enrolling')
  assert.equal(docTeam.site, null)
  assert.equal(docTeam.principalInvestigator.name, 'Amit Garg')
  assert.equal(docTeam.canReceiveReferrals, true)

  const payload = {
    status: 'recruiting',
    principalInvestigatorId: 'r-garg',
    localContact: { email: 'mika@lhsc.on.ca' },
    acceptsReferrals: false,
  }
  const [payloadTeam] = resolvePayloadTeams(payload)
  assert.equal(payloadTeam._key, LEGACY_TEAM_KEY)
  assert.equal(payloadTeam.status, 'enrolling')
  assert.equal(payloadTeam.siteId, '')
  assert.equal(payloadTeam.principalInvestigatorId, 'r-garg')
  assert.equal(payloadTeam.contact.email, 'mika@lhsc.on.ca')

  assert.equal(legacyPayloadTeam({ title: 'Nothing legacy here' }), null)
  assert.deepEqual(resolveStudyTeams({ title: 'No teams, no legacy' }), [])
})

test('resolveStudyTeams prefers siteTeams, then the GROQ legacyTeam, then raw fields', () => {
  const withTeams = { siteTeams: [{ _key: 'a', site: { name: 'UH' } }], legacyTeam: { principalInvestigatorName: 'Old' } }
  assert.equal(resolveStudyTeams(withTeams).length, 1)
  assert.equal(resolveStudyTeams(withTeams)[0].site.name, 'UH')

  const withLegacyTeam = {
    status: 'recruiting',
    legacyTeam: { principalInvestigatorName: 'Old PI', acceptsReferrals: true, canReceiveReferrals: true, contact: null },
  }
  const [legacy] = resolveStudyTeams(withLegacyTeam)
  assert.equal(legacy._key, LEGACY_TEAM_KEY)
  assert.equal(legacy.principalInvestigatorName, 'Old PI')
  assert.equal(legacy.status, 'enrolling')
  // The GROQ flag stands in for the hidden contact email.
  assert.equal(legacy.canReceiveReferrals, true)
})

test('teamStatusFromStudyStatus maps the study status onto one implied team', () => {
  assert.equal(teamStatusFromStudyStatus('recruiting'), 'enrolling')
  assert.equal(teamStatusFromStudyStatus('coming_soon'), 'not_yet_enrolling')
  assert.equal(teamStatusFromStudyStatus('completed'), 'closed')
  assert.equal(teamStatusFromStudyStatus(undefined), 'closed')
})

test('validateSiteTeams reports the missing site, duplicate sites, missing PI and referrals without an email', () => {
  assert.deepEqual(validateSiteTeams([]), [{ teamKey: null, field: 'siteTeams', message: 'Add at least one study team.' }])

  const errors = validateSiteTeams(
    [
      team({ _key: 'one', siteId: '' }),
      team({ _key: 'two', siteId: 'site-kcc' }),
      team({ _key: 'three', siteId: 'site-vh', principalInvestigatorId: '', principalInvestigatorName: '' }),
      team({ _key: 'four', siteId: 'site-vh', contact: { name: 'No email' } }),
    ],
    { sites: SITES }
  )
  assert.deepEqual(
    errors.map((error) => [error.teamKey, error.field]),
    [
      ['one', 'siteId'],
      ['two', 'siteId'],
      ['three', 'principalInvestigator'],
      ['four', 'siteId'],
      ['four', 'contact.email'],
    ]
  )
  assert.equal(errors[1].message, 'Choose a site that coordinates studies.')
  assert.equal(errors[3].message, 'Each site can have only one team.')
  assert.equal(formatTeamError(errors[2], errors.map((e) => team({ _key: e.teamKey, siteId: e.teamKey === 'three' ? 'site-vh' : '' })), SITES), 'Team 3 (Victoria Hospital): Select a principal investigator or choose Other and enter a name.')

  assert.deepEqual(validateSiteTeams([team(), team({ _key: 'k-vh', siteId: 'site-vh' })], { sites: SITES }), [])
})

test('payloadTeamsToSanity writes references, keeps keys and drops an empty contact', () => {
  const [item] = payloadTeamsToSanity([team({ contact: { name: '', email: '' }, acceptsReferrals: false })])
  assert.equal(item._type, 'siteTeam')
  assert.equal(item._key, 'k-uh')
  assert.deepEqual(item.site, { _type: 'reference', _ref: 'site-uh' })
  assert.deepEqual(item.principalInvestigator, { _type: 'reference', _ref: 'r-garg' })
  assert.equal(item.contact, undefined)
  assert.equal(item.principalInvestigatorName, undefined)

  const [other] = payloadTeamsToSanity([team({ principalInvestigatorId: '', principalInvestigatorName: 'Outside PI' })])
  assert.equal(other.principalInvestigator, undefined)
  assert.equal(other.principalInvestigatorName, 'Outside PI')
  assert.equal(other.contact.email, 'mika@lhsc.on.ca')
})

test('normalizePayloadTeam gives a new team a key and clears the free-text PI when a researcher is chosen', () => {
  const fresh = normalizePayloadTeam({ siteId: 'site-vh', principalInvestigatorId: 'r-doe', principalInvestigatorName: 'typo' }, 2)
  assert.equal(fresh._key, 'site-site-vh')
  assert.equal(fresh.principalInvestigatorName, '')
  assert.equal(normalizePayloadTeam({}, 2)._key, 'team-3')
  assert.equal(normalizePayloadTeam({ _key: 'bad key with spaces' }, 0)._key, 'team-1')
  assert.equal(createEmptyTeam('team-1').contact.displayPublicly, false)
})

test('referral routing: only enrolling teams with an email take referrals, and a key never routes elsewhere', () => {
  const uh = { _key: 'uh', status: 'enrolling', site: UH, principalInvestigator: { name: 'Amit Garg' }, contact: { email: 'uh@x.ca' }, acceptsReferrals: true, canReceiveReferrals: true }
  const vh = { _key: 'vh', status: 'not_yet_enrolling', site: VH, principalInvestigatorName: 'Jane Doe', contact: { email: 'vh@x.ca' }, acceptsReferrals: true, canReceiveReferrals: true }
  const closedTeam = { _key: 'closed', status: 'enrolling', site: KCC, acceptsReferrals: false, contact: { email: 'k@x.ca' } }
  const study = { siteTeams: [uh, vh, closedTeam] }
  const teams = resolveStudyTeams(study)

  assert.deepEqual(teamsAcceptingReferrals(teams).map((t) => t._key), ['uh'])
  assert.equal(studyAcceptsReferrals(study), true)
  assert.equal(pickReferralTeam(teams, '').team._key, 'uh')
  assert.equal(pickReferralTeam(teams, 'vh').error, 'not_found')
  assert.equal(pickReferralTeam(teams, 'closed').error, 'not_found')
  assert.equal(pickReferralTeam([], '').error, 'none')

  const bothOpen = resolveStudyTeams({ siteTeams: [uh, { ...vh, status: 'enrolling' }] })
  assert.equal(pickReferralTeam(bothOpen, '').error, 'choose')
  assert.equal(pickReferralTeam(bothOpen, 'vh').team._key, 'vh')
  assert.equal(referralOptionLabel(bothOpen[1]), 'Jane Doe, Victoria Hospital team')
  assert.equal(referralOptionLabel({ _key: 'x', site: null }), 'Study team')
})

test('a hidden contact never becomes public, and listTeamInvestigators carries the site name', () => {
  const teams = resolveStudyTeams({
    siteTeams: [
      { _key: 'a', site: UH, principalInvestigator: { name: 'Amit Garg', slug: { current: 'amit-garg' } }, contact: { name: 'Hidden', email: 'h@x.ca', displayPublicly: false } },
      { _key: 'b', site: VH, principalInvestigatorName: 'Jane Doe', contact: { name: 'Shown', displayPublicly: true } },
      { _key: 'c', site: KCC, contact: { displayPublicly: true } },
    ],
  })
  assert.equal(publicTeamContact(teams[0]), null)
  assert.equal(publicTeamContact(teams[1]).name, 'Shown')
  assert.equal(publicTeamContact(teams[2]), null)
  assert.equal(publicTeamContact({ contact: { name: 'Unset flag' } }), null)
  assert.deepEqual(
    listTeamInvestigators(teams).map((pi) => [pi.name, pi.slug, pi.siteName]),
    [
      ['Amit Garg', 'amit-garg', 'University Hospital'],
      ['Jane Doe', '', 'Victoria Hospital'],
    ]
  )
})

test('summarizeStudyChanges lists team changes first, then changed study fields', () => {
  const current = {
    title: 'Study',
    status: 'recruiting',
    inclusionCriteria: ['Adults'],
    therapeuticAreaIds: ['a', 'b'],
    siteTeams: [team(), team({ _key: 'k-vh', siteId: 'site-vh', principalInvestigatorId: 'r-doe' })],
  }
  const proposed = {
    ...current,
    inclusionCriteria: ['Adults', 'eGFR < 60'],
    therapeuticAreaIds: ['b', 'a'],
    siteTeams: [
      team({ contact: { name: 'Mika', email: 'new@lhsc.on.ca', displayPublicly: false }, acceptsReferrals: false }),
      team({ _key: 'brand-new', siteId: 'site-kcc', principalInvestigatorName: 'Someone', principalInvestigatorId: '' }),
    ],
  }
  assert.deepEqual(summarizeStudyChanges(current, proposed, { sites: SITES }), [
    'University Hospital team: contact email, accepts referrals',
    'Adds the Westmount team',
    'Removes the Victoria Hospital team',
    'Changes inclusion criteria',
  ])
  assert.deepEqual(summarizeStudyChanges(current, current, { sites: SITES }), [])

  // A legacy payload compared with its team-shaped successor is unchanged.
  const legacy = { status: 'recruiting', principalInvestigatorId: 'r-garg', localContact: { name: 'Mika', email: 'mika@lhsc.on.ca' }, acceptsReferrals: true }
  const converted = { status: 'recruiting', siteTeams: [team({ _key: 'legacy', siteId: '' })] }
  assert.deepEqual(summarizeStudyChanges(legacy, converted, { sites: SITES }), [])
})

test('describePayloadTeam and summarizePayloadTeam read names through the site and researcher lists', () => {
  const described = describePayloadTeam(team(), { sites: SITES, researchers: RESEARCHERS })
  assert.equal(described.siteName, 'University Hospital')
  assert.equal(described.siteShortName, 'UH')
  assert.equal(described.piName, 'Amit Garg')
  assert.equal(described.statusLabel, 'Enrolling')
  assert.equal(described.contactLine, 'Mika, mika@lhsc.on.ca')

  const summary = summarizePayloadTeam(team({ siteId: '' }), 1, { sites: SITES, researchers: RESEARCHERS })
  assert.equal(summary.label, 'Team 2 (no coordinating site)')
  assert.match(summary.summary, /^PI: Amit Garg \| Enrolling \| Contact: Mika, mika@lhsc.on.ca \| Contact public: No \| Accepts referrals: Yes$/)
})
