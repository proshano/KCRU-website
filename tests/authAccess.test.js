import assert from 'node:assert/strict'
import test from 'node:test'

import { getAuthAccessForConfig } from '../lib/authAccessRules.js'

const baseConfig = {
  coordinators: ['coordinator@lhsc.on.ca', 'staff@sjhc.london.on.ca'],
  approvalAdmins: ['approvals@lhsc.on.ca'],
  updateAdmins: ['updates@sjhc.london.on.ca'],
  domains: 'lhsc.on.ca',
}

test('returns denied access when email is blank', () => {
  assert.deepEqual(getAuthAccessForConfig('', baseConfig), {
    allowed: false,
    admin: false,
    approvals: false,
    updates: false,
    coordinator: false,
  })
})

test('allows a coordinator on the LHSC allowlist', () => {
  assert.deepEqual(getAuthAccessForConfig('coordinator@lhsc.on.ca', baseConfig), {
    allowed: true,
    admin: false,
    approvals: false,
    updates: false,
    coordinator: true,
  })
})

test('allows a coordinator on the St. Josephs allowlist through the shared default domains', () => {
  assert.deepEqual(getAuthAccessForConfig('staff@sjhc.london.on.ca', baseConfig), {
    allowed: true,
    admin: false,
    approvals: false,
    updates: false,
    coordinator: true,
  })
})

test('grants approval admins coordinator and admin access', () => {
  assert.deepEqual(getAuthAccessForConfig('approvals@lhsc.on.ca', baseConfig), {
    allowed: true,
    admin: true,
    approvals: true,
    updates: true,
    coordinator: true,
  })
})

test('grants update admins coordinator and admin access', () => {
  assert.deepEqual(getAuthAccessForConfig('updates@sjhc.london.on.ca', baseConfig), {
    allowed: true,
    admin: true,
    approvals: true,
    updates: true,
    coordinator: true,
  })
})

test('denies emails outside the allowlists even when the domain matches', () => {
  assert.deepEqual(getAuthAccessForConfig('outsider@lhsc.on.ca', baseConfig), {
    allowed: false,
    admin: false,
    approvals: false,
    updates: false,
    coordinator: false,
  })
})

test('denies allowlisted emails outside the configured domains', () => {
  const config = {
    ...baseConfig,
    coordinators: ['staff@example.org'],
    domains: 'lhsc.on.ca, sjhc.london.on.ca',
  }

  assert.deepEqual(getAuthAccessForConfig('staff@example.org', config), {
    allowed: false,
    admin: false,
    approvals: false,
    updates: false,
    coordinator: true,
  })
})

test('honors custom domain lists without forcing the hospital defaults', () => {
  const config = {
    coordinators: ['partner@research.example.org'],
    approvalAdmins: [],
    updateAdmins: [],
    domains: 'research.example.org',
  }

  assert.deepEqual(getAuthAccessForConfig('partner@research.example.org', config), {
    allowed: true,
    admin: false,
    approvals: false,
    updates: false,
    coordinator: true,
  })

  assert.deepEqual(getAuthAccessForConfig('partner@lhsc.on.ca', config), {
    allowed: false,
    admin: false,
    approvals: false,
    updates: false,
    coordinator: false,
  })
})
