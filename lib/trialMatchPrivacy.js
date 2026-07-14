import net from 'node:net'

import { sanitizePatientProfile } from './patientProfileSchema.js'

function sanitizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

export function getTrustedClientIp(headers) {
  const realIp = sanitizeText(headers?.get?.('x-real-ip'))
  if (net.isIP(realIp)) return realIp

  const forwarded = sanitizeText(headers?.get?.('x-forwarded-for'))
  if (forwarded) {
    const addresses = forwarded.split(',').map((value) => value.trim()).filter(Boolean)
    const edgeAddress = addresses.at(-1)
    if (net.isIP(edgeAddress)) return edgeAddress
  }

  return 'unknown'
}

export function redactPotentialIdentifiers(value) {
  const original = sanitizeText(value)
  if (!original) return { text: '', hadRedaction: false }

  let redacted = original
  redacted = redacted.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted email]')
  redacted = redacted.replace(/\b(?:mrn|medical record number|health card(?: number)?|ohip)\s*[:#]?\s*[A-Za-z0-9 -]+\b/gi, '[redacted record number]')
  redacted = redacted.replace(/\b(?:dob|date of birth)\s*[:#]?\s*\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/gi, '[redacted date of birth]')
  redacted = redacted.replace(/\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/g, '[redacted date]')
  redacted = redacted.replace(/\b\d{6,}\b/g, '[redacted number]')
  redacted = redacted.replace(/\+?\d[\d\s().-]{7,}\d/g, '[redacted phone]')
  redacted = redacted.replace(/\b[A-Z]\d[A-Z][ -]?\d[A-Z]\d\b/gi, '[redacted postal code]')
  redacted = redacted.replace(/\b\d{5}(?:-\d{4})?\b/g, '[redacted postal code]')
  redacted = redacted.replace(
    /\b\d{1,6}\s+(?:[A-Za-z0-9.'-]+\s+){0,5}(?:street|st|road|rd|avenue|ave|drive|dr|lane|ln|court|ct|boulevard|blvd|way|highway|hwy|crescent|cres)\b\.?/gi,
    '[redacted street address]'
  )
  redacted = redacted.replace(
    /\b(?:patient|name(?:\s+is)?|called)\s+(?:is\s+)?[A-Z][A-Za-z'-]+(?:\s+[A-Z][A-Za-z'-]+){0,2}\b/gi,
    '[redacted name]'
  )
  redacted = redacted.replace(/\b(?:Mr|Mrs|Ms|Miss)\.?\s+[A-Z][A-Za-z'-]+(?:\s+[A-Z][A-Za-z'-]+)?\b/g, '[redacted name]')
  redacted = redacted.replace(/\b[A-Z][a-z'-]+(?:\s+[A-Z][a-z'-]+){1,2}\s+(?=(?:has|with|is)\b)/g, '[redacted name] ')

  return { text: redacted, hadRedaction: redacted !== original }
}

export function sanitizeTrialMatchMessages(value, { maxMessages = 12, maxMessageLength = 600 } = {}) {
  if (!Array.isArray(value)) return { messages: [], hadRedaction: false }

  let hadRedaction = false
  const messages = value
    .slice(-maxMessages)
    .map((message) => {
      if (!message || typeof message !== 'object') return null
      const role = message.role === 'assistant' ? 'assistant' : 'user'
      const redaction = redactPotentialIdentifiers(message.content)
      if (redaction.hadRedaction) hadRedaction = true
      if (!redaction.text) return null
      return { role, content: redaction.text.slice(0, maxMessageLength) }
    })
    .filter(Boolean)

  return { messages, hadRedaction }
}

export function sanitizeTrialMatchProfile(value) {
  const profile = sanitizePatientProfile(value)
  const diagnosis = redactPotentialIdentifiers(profile.diagnosis)
  const diagnosisLooksClinical = /\b(?:kidney|renal|neph|fsgs|iga|c3g|adpkd|alport|lupus|diabet|glomer|dialysis|transplant|protein|albumin|hypertens|vascul|amyloid|stone|cancer|carcinoma|failure|disease|syndrome|rejection|ckd|aki|minimal change)\b/i.test(diagnosis.text)
  const assumptions = Array.isArray(profile.urineProtein?.assumptions)
    ? profile.urineProtein.assumptions
    : []

  return {
    profile: {
      ...profile,
      diagnosis: diagnosisLooksClinical ? diagnosis.text : null,
      urineProtein: {
        ...profile.urineProtein,
        assumptions: [],
      },
    },
    hadRedaction: diagnosis.hadRedaction || assumptions.length > 0 || Boolean(profile.diagnosis && !diagnosisLooksClinical),
  }
}
