import assert from 'node:assert/strict'
import test from 'node:test'

import { planSiteAction } from '../scripts/sites.js'

const SITES = [
  { _id: 'site-uh', _rev: 'a', name: 'London Health Sciences Centre - University Hospital', shortName: 'LHSC-UH', coordinatesStudies: true, recruitsPatients: true, active: true, order: 1 },
  { _id: 'drafts.site-uh', _rev: 'a-draft', name: 'London Health Sciences Centre - University Hospital', shortName: 'LHSC-UH', order: 1 },
  { _id: 'site-kcc', _rev: 'b', name: 'Westmount', shortName: 'KCC', recruitsPatients: true, active: true, order: 2 },
  { _id: 'site-clinics', _rev: 'c', name: 'Kidney Care Centre - Clinics', shortName: 'KCC-Clinics', order: 3 },
]

test('list describes the published sites only', () => {
  const plan = planSiteAction({ action: 'list', sites: SITES })
  assert.deepEqual(plan.errors, [])
  assert.equal(plan.lines.length, 3)
  assert.match(plan.lines[0], /University Hospital \(LHSC-UH\) \[site-uh\] - coordinates studies, enrols patients/)
  // The app shows only sites whose active flag is true, so a missing flag reads as inactive.
  assert.match(plan.lines[2], /Kidney Care Centre - Clinics \(KCC-Clinics\) \[site-clinics\] - inactive/)
})

test('rename matches the site by short name and patches its Studio draft too', () => {
  const plan = planSiteAction({
    action: 'rename',
    sites: SITES,
    input: { target: 'lhsc-uh', name: 'University Hospital', shortName: 'UH' },
  })
  assert.deepEqual(plan.errors, [])
  assert.deepEqual(plan.mutations, [
    { patch: { id: 'site-uh', rev: 'a', set: { name: 'University Hospital', shortName: 'UH' } } },
    { patch: { id: 'drafts.site-uh', rev: 'a-draft', set: { name: 'University Hospital', shortName: 'UH' } } },
  ])
  assert.match(plan.lines[0], /and its Studio draft/)

  const unchanged = planSiteAction({ action: 'rename', sites: SITES, input: { target: 'Westmount', name: 'Westmount' } })
  assert.deepEqual(unchanged.mutations, [])
  assert.match(unchanged.lines[0], /nothing to change/)

  const missing = planSiteAction({ action: 'rename', sites: SITES, input: { target: 'Nowhere', name: 'X' } })
  assert.match(missing.errors[0], /No site matches "Nowhere"/)
})

test('create refuses a duplicate name and otherwise builds an active site after the last one', () => {
  const duplicate = planSiteAction({ action: 'create', sites: SITES, input: { name: 'westmount' } })
  assert.match(duplicate.errors[0], /already exists/)

  const plan = planSiteAction({
    action: 'create',
    sites: SITES,
    input: { name: "St. Joseph's Health Care", shortName: 'SJHC', coordinates: 'true', recruits: 'true' },
  })
  assert.deepEqual(plan.errors, [])
  assert.deepEqual(plan.mutations, [
    {
      create: {
        _type: 'site',
        name: "St. Joseph's Health Care",
        shortName: 'SJHC',
        type: 'academic_hospital',
        city: 'London',
        province: 'Ontario',
        coordinatesStudies: true,
        recruitsPatients: true,
        active: true,
        order: 4,
      },
    },
  ])
  assert.match(planSiteAction({ action: 'create', sites: SITES, input: { name: 'X', type: 'spaceport' } }).errors[0], /SITE_TYPE/)
})

test('set changes only the flags given and reports an empty request', () => {
  const plan = planSiteAction({ action: 'set', sites: SITES, input: { target: 'KCC', coordinates: 'true', recruits: 'true' } })
  assert.deepEqual(plan.mutations, [{ patch: { id: 'site-kcc', rev: 'b', set: { coordinatesStudies: true } } }])

  const activate = planSiteAction({ action: 'set', sites: SITES, input: { target: 'KCC-Clinics', recruits: 'true', active: 'true' } })
  assert.deepEqual(activate.mutations, [{ patch: { id: 'site-clinics', rev: 'c', set: { recruitsPatients: true, active: true } } }])
  assert.deepEqual(planSiteAction({ action: 'set', sites: SITES, input: { target: 'KCC', active: 'true' } }).mutations, [])

  const nothing = planSiteAction({ action: 'set', sites: SITES, input: { target: 'KCC' } })
  assert.match(nothing.errors[0], /Set at least one/)

  const unknown = planSiteAction({ action: 'frobnicate', sites: SITES })
  assert.match(unknown.errors[0], /SITE_ACTION must be/)
})
