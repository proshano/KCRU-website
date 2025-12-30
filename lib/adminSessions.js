import crypto from 'crypto'
import { sanityFetch, writeClient } from '@/lib/sanity'
import { sanitizeString } from '@/lib/studySubmissions'

const ADMIN_SESSION_TYPE = 'adminSession'
const ADMIN_SCOPES = {
  approvals: 'approvals',
  updates: 'updates',
  any: 'any',
}

function normalizeEmailList(list) {
  if (!Array.isArray(list)) return []
  const normalized = list
    .map((email) => sanitizeString(email).toLowerCase())
    .filter(Boolean)
  return Array.from(new Set(normalized))
}

export function normalizeAdminScope(scope) {
  const normalized = sanitizeString(scope).toLowerCase()
  if (normalized === ADMIN_SCOPES.approvals || normalized === 'approval') return ADMIN_SCOPES.approvals
  if (normalized === ADMIN_SCOPES.updates || normalized === 'update') return ADMIN_SCOPES.updates
  if (normalized === ADMIN_SCOPES.any || normalized === 'all') return ADMIN_SCOPES.any
  return ADMIN_SCOPES.any
}

export function getAdminScopeLabel(scope) {
  const normalized = normalizeAdminScope(scope)
  if (normalized === ADMIN_SCOPES.approvals) return 'study approvals'
  if (normalized === ADMIN_SCOPES.updates) return 'study updates'
  return 'admin'
}

async function getAdminLists() {
  const settings = await sanityFetch(`
    *[_type == "siteSettings"][0]{
      "approvalAdmins": studyApprovals.admins,
      "updateAdmins": studyUpdates.admins
    }
  `)
  return {
    approvals: normalizeEmailList(settings?.approvalAdmins),
    updates: normalizeEmailList(settings?.updateAdmins),
  }
}

export async function getAdminEmails(scope = ADMIN_SCOPES.any) {
  const lists = await getAdminLists()
  const normalizedScope = normalizeAdminScope(scope)
  if (normalizedScope === ADMIN_SCOPES.approvals) return lists.approvals
  if (normalizedScope === ADMIN_SCOPES.updates) return lists.updates
  return Array.from(new Set([...lists.approvals, ...lists.updates]))
}

export async function getAdminAccess(email) {
  const normalized = sanitizeString(email).toLowerCase()
  if (!normalized) return { approvals: false, updates: false }
  const lists = await getAdminLists()
  return {
    approvals: lists.approvals.includes(normalized),
    updates: lists.updates.includes(normalized),
  }
}

export async function isAdminEmail(email, scope = ADMIN_SCOPES.any) {
  const normalized = sanitizeString(email).toLowerCase()
  if (!normalized) return false
  const admins = await getAdminEmails(scope)
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

export async function getScopedAdminSession(token, { scope = ADMIN_SCOPES.any, allowLegacy = true } = {}) {
  const session = await getAdminSession(token, { allowLegacy })
  if (!session) {
    return { session: null, error: 'Unauthorized', status: 401 }
  }
  const allowed = await isAdminEmail(session.email, scope)
  if (!allowed) {
    return {
      session: null,
      error: `Not authorized for ${getAdminScopeLabel(scope)} access.`,
      status: 403,
    }
  }
  return { session, error: null, status: 200 }
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
