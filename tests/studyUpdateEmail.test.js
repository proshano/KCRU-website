import assert from 'node:assert/strict'
import test from 'node:test'

import { buildStudyReferralMailto } from '../lib/studyUpdateEmail.js'
import { buildStudyUpdateEmail } from '../lib/studyUpdateEmailTemplate.js'

const UH_TEAM = {
  _key: 'uh',
  status: 'enrolling',
  site: { _id: 'site-uh', name: 'University Hospital', shortName: 'UH' },
  principalInvestigator: { name: 'Amit Garg' },
  contact: { email: 'uh@lhsc.on.ca' },
  acceptsReferrals: true,
}
const VH_TEAM = {
  _key: 'vh',
  status: 'enrolling',
  site: { _id: 'site-vh', name: 'Victoria Hospital', shortName: 'VH' },
  principalInvestigatorName: 'Jane Doe',
  contact: { email: 'vh@lhsc.on.ca' },
  acceptsReferrals: true,
}

function study(overrides = {}) {
  return {
    title: 'Kidney study',
    slug: 'kidney-study',
    status: 'recruiting',
    emailTitle: 'Kidney study',
    emailEligibilitySummary: 'Adults with CKD.',
    siteTeams: [UH_TEAM],
    recruitmentSites: [{ name: 'University Hospital' }, { name: 'Westmount' }],
    ...overrides,
  }
}

function build(studyRecord) {
  return buildStudyUpdateEmail({
    subscriber: { email: 'doc@lhsc.on.ca' },
    studies: [studyRecord],
    siteBaseUrl: 'https://londonkidney.ca',
    monthLabel: 'October 2026',
  })
}

test('a single-team study keeps the plain referral button and names the PI with the site', () => {
  const { text, html } = build(study())
  assert.match(text, /PI: Amit Garg \(University Hospital\)/)
  assert.match(text, /Patients can be seen at: University Hospital, Westmount/)
  assert.match(text, /^Refer a patient: mailto:uh@lhsc\.on\.ca\?subject=Study%20referral%3A%20Kidney%20study%20\(University%20Hospital%20team\)/m)
  assert.equal((html.match(/mailto:/g) || []).length, 1)
  assert.match(html, />\s*Refer a patient\s*</)
})

test('a two-team study gets one labelled button per team that takes referrals', () => {
  const { text, html } = build(study({ siteTeams: [UH_TEAM, VH_TEAM] }))
  assert.match(text, /PI: Amit Garg \(University Hospital\), Jane Doe \(Victoria Hospital\)/)
  assert.match(text, /^Refer to Amit Garg \(University Hospital\): mailto:uh@lhsc\.on\.ca/m)
  assert.match(text, /^Refer to Jane Doe \(Victoria Hospital\): mailto:vh@lhsc\.on\.ca/m)
  assert.equal((html.match(/mailto:/g) || []).length, 2)
})

test('a team that is not yet enrolling, or has referrals off, gets no button', () => {
  const { text } = build(study({ siteTeams: [UH_TEAM, { ...VH_TEAM, status: 'not_yet_enrolling' }] }))
  assert.match(text, /Jane Doe \(Victoria Hospital\)/)
  assert.doesNotMatch(text, /mailto:vh@lhsc\.on\.ca/)
  assert.match(text, /^Refer to Amit Garg \(University Hospital\): mailto:uh@lhsc\.on\.ca/m)

  const closed = build(study({ siteTeams: [{ ...UH_TEAM, acceptsReferrals: false }] }))
  assert.match(closed.text, /Referrals: currently closed/)
})

test('a study that predates teams still renders from its legacy fields', () => {
  const { text } = build(
    study({
      siteTeams: undefined,
      recruitmentSites: undefined,
      principalInvestigator: { name: 'Old PI' },
      localContact: { email: 'old@lhsc.on.ca' },
      acceptsReferrals: true,
    })
  )
  assert.match(text, /PI: Old PI/)
  assert.match(text, /^Refer a patient: mailto:old@lhsc\.on\.ca\?subject=Study%20referral%3A%20Kidney%20study&/m)
  assert.doesNotMatch(text, /Patients can be seen at/)
})

test('buildStudyReferralMailto names the team in the subject only when given one', () => {
  assert.match(
    buildStudyReferralMailto({ coordinatorEmail: 'a@b.ca', studyTitle: 'T', teamLabel: 'Victoria Hospital' }),
    /subject=Study%20referral%3A%20T%20\(Victoria%20Hospital%20team\)/
  )
  assert.match(buildStudyReferralMailto({ coordinatorEmail: 'a@b.ca', studyTitle: 'T' }), /subject=Study%20referral%3A%20T&/)
  assert.equal(buildStudyReferralMailto({ coordinatorEmail: '', studyTitle: 'T' }), '')
})
