import assert from 'node:assert/strict'
import test from 'node:test'

import { planSiteAction, siteIdFromName } from '../scripts/sites.js'

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

test('create is a no-op for an existing name or id and otherwise builds an active site after the last one', () => {
  const duplicate = planSiteAction({ action: 'create', sites: SITES, input: { name: 'westmount' } })
  assert.deepEqual(duplicate.errors, [])
  assert.deepEqual(duplicate.mutations, [])
  assert.match(duplicate.lines[0], /Westmount \(KCC\) \[site-kcc\].*already exists, nothing to create/)
  assert.equal(siteIdFromName("St. Joseph's Health Care"), 'site-st-joseph-s-health-care')
  assert.equal(siteIdFromName('Goderich satellite'), 'site-goderich-satellite')

  const plan = planSiteAction({
    action: 'create',
    sites: SITES,
    input: { name: "St. Joseph's Health Care", shortName: 'SJHC', coordinates: 'true', recruits: 'true' },
  })
  assert.deepEqual(plan.errors, [])
  assert.deepEqual(plan.mutations, [
    {
      createIfNotExists: {
        _id: 'site-st-joseph-s-health-care',
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
  // A second run of the same create, after the first was written, adds nothing.
  const written = [...SITES, plan.mutations[0].createIfNotExists]
  assert.deepEqual(planSiteAction({ action: 'create', sites: written, input: { name: "St. Joseph's Health Care" } }).mutations, [])
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
