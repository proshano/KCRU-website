import assert from 'node:assert/strict'
import test from 'node:test'

import {
  getTrustedClientIp,
  redactPotentialIdentifiers,
  sanitizeTrialMatchMessages,
  sanitizeTrialMatchProfile,
} from '../lib/trialMatchPrivacy.js'

function headers(values) {
  return { get: (name) => values[name.toLowerCase()] || null }
}

test('redacts names, street addresses, and Canadian postal codes from patient text', () => {
  const result = redactPotentialIdentifiers(
    'Patient John Smith lives at 123 Main Street, Toronto, ON M5V 2T6 and has IgA nephropathy.'
  )
  assert.equal(result.hadRedaction, true)
  assert.equal(result.text.includes('John Smith'), false)
  assert.equal(result.text.includes('123 Main Street'), false)
  assert.equal(result.text.includes('M5V 2T6'), false)
  assert.match(result.text, /IgA nephropathy/i)
})

test('redacts common direct identifiers while preserving clinical values', () => {
  const result = sanitizeTrialMatchMessages([
    {
      role: 'user',
      content: 'DOB 01/02/1970, john@example.com, phone 519-555-1234, eGFR 40 and ACR 45 mg/mmol.',
    },
  ])
  assert.equal(result.hadRedaction, true)
  assert.equal(result.messages[0].content.includes('john@example.com'), false)
  assert.equal(result.messages[0].content.includes('519-555-1234'), false)
  assert.match(result.messages[0].content, /eGFR 40/i)
  assert.match(result.messages[0].content, /ACR 45 mg\/mmol/i)
})

test('drops caller-supplied profile free text that is not a clinical diagnosis', () => {
  const result = sanitizeTrialMatchProfile({
    diagnosis: 'John Smith, 123 Main Street, Toronto, john@example.com',
    urineProtein: { assumptions: ['Call John Smith at 519-555-1234'] },
  })
  assert.equal(result.profile.diagnosis, null)
  assert.deepEqual(result.profile.urineProtein.assumptions, [])
  assert.equal(result.hadRedaction, true)
})

test('keeps a non-identifying kidney diagnosis', () => {
  const result = sanitizeTrialMatchProfile({ diagnosis: 'IgA nephropathy' })
  assert.equal(result.profile.diagnosis, 'IgA nephropathy')
  assert.equal(result.hadRedaction, false)
})

test('uses a syntactically valid edge address instead of a caller-controlled first hop', () => {
  assert.equal(
    getTrustedClientIp(headers({ 'x-forwarded-for': 'spoofed, 203.0.113.8' })),
    '203.0.113.8'
  )
  assert.equal(
    getTrustedClientIp(headers({ 'x-real-ip': '198.51.100.10', 'x-forwarded-for': '203.0.113.8' })),
    '198.51.100.10'
  )
  assert.equal(getTrustedClientIp(headers({ 'x-forwarded-for': 'spoofed' })), 'unknown')
})
