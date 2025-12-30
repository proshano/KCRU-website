import crypto from 'crypto'
import { sanityFetch, writeClient } from '@/lib/sanity'
import { sanitizeString } from '@/lib/studySubmissions'

const ADMIN_SESSION_TYPE = 'adminSession'

export async function getAdminEmails() {
  const settings = await sanityFetch(`
    *[_type == "siteSettings"][0]{
      "approvalAdmins": studyApprovals.admins,
      "updateAdmins": studyUpdates.admins
    }
  `)
  const approvals = Array.isArray(settings?.approvalAdmins) ? settings.approvalAdmins : []
  const updates = Array.isArray(settings?.updateAdmins) ? settings.updateAdmins : []
  const normalized = [...approvals, ...updates]
    .map((email) => sanitizeString(email).toLowerCase())
    .filter(Boolean)
  return Array.from(new Set(normalized))
}

export async function isAdminEmail(email) {
  const normalized = sanitizeString(email).toLowerCase()
  if (!normalized) return false
  const admins = await getAdminEmails()
  return admins.includes(normalized)
}

export async function createAdminPasscodeSession({ email, codeTtlMinutes }) {
  const normalized = sanitizeString(email).toLowerCase()
  if (!normalized) {
    throw new Error('Email is required.')
  }
  const code = String(Math.floor(100000 + Math.random() * 900000))
  const codeHash = crypto.createHash('sha256').update(code).digest('hex')
  const createdAt = new Date().toISOString()
  const codeExpiresAt = new Date(Date.now() + Number(codeTtlMinutes) * 60 * 1000).toISOString()

  await writeClient.create({
    _type: ADMIN_SESSION_TYPE,
    email: normalized,
    codeHash,
    codeExpiresAt,
    createdAt,
    revoked: false,
  })

  return { code }
}

export async function verifyAdminPasscode({ email, code, sessionTtlHours }) {
  const normalized = sanitizeString(email).toLowerCase()
  const cleanedCode = sanitizeString(code)
  if (!normalized || !cleanedCode) {
    throw new Error('Email and passcode are required.')
  }

  const session = await sanityFetch(
    `*[_type == "${ADMIN_SESSION_TYPE}" && email == $email && revoked != true] | order(createdAt desc)[0]{
      _id,
      codeHash,
      codeExpiresAt,
      codeUsedAt
    }`,
    { email: normalized }
  )

  if (!session?._id || !session.codeHash) {
    throw new Error('Passcode not found. Request a new code.')
  }

  if (session.codeUsedAt) {
    throw new Error('Passcode already used. Request a new code.')
  }

  if (session.codeExpiresAt && Date.parse(session.codeExpiresAt) < Date.now()) {
    throw new Error('Passcode expired. Request a new code.')
  }

  const codeHash = crypto.createHash('sha256').update(cleanedCode).digest('hex')
  if (codeHash !== session.codeHash) {
    throw new Error('Invalid passcode.')
  }

  const token = crypto.randomBytes(32).toString('hex')
  const expiresAt = new Date(Date.now() + Number(sessionTtlHours) * 60 * 60 * 1000).toISOString()

  await writeClient
    .patch(session._id)
    .set({
      token,
      expiresAt,
      codeUsedAt: new Date().toISOString(),
    })
    .commit({ returnDocuments: false })

  return { token, email: normalized }
}

function isSessionValid(session) {
  if (!session || session.revoked) return false
  if (session.expiresAt && Date.parse(session.expiresAt) < Date.now()) return false
  return true
}

async function getLegacySession(token) {
  const legacyTypes = ['studyApprovalSession', 'studyUpdateAdminSession']
  for (const type of legacyTypes) {
    const session = await sanityFetch(
      `*[_type == "${type}" && token == $token][0]{ _id, email, expiresAt, revoked }`,
      { token }
    )
    if (isSessionValid(session)) {
      return session
    }
  }
  return null
}

export async function getAdminSession(token, { allowLegacy = true } = {}) {
  const normalized = sanitizeString(token)
  if (!normalized) return null
  const session = await sanityFetch(
    `*[_type == "${ADMIN_SESSION_TYPE}" && token == $token][0]{ _id, email, expiresAt, revoked }`,
    { token: normalized }
  )
  if (isSessionValid(session)) return session
  if (!allowLegacy) return null
  return getLegacySession(normalized)
}

export async function createAdminTokenSession({ email, sessionTtlHours }) {
  const normalized = sanitizeString(email).toLowerCase()
  if (!normalized) {
    throw new Error('Email is required.')
  }
  const token = crypto.randomBytes(32).toString('hex')
  const createdAt = new Date().toISOString()
  const expiresAt = new Date(Date.now() + Number(sessionTtlHours) * 60 * 60 * 1000).toISOString()

  await writeClient.create({
    _type: ADMIN_SESSION_TYPE,
    email: normalized,
    token,
    createdAt,
    expiresAt,
    revoked: false,
  })

  return { token, expiresAt }
}
