import { getServerSession } from 'next-auth/next'
import { authOptions, getAuthAccess } from '@/lib/auth'
import { sanitizeString } from '@/lib/studySubmissions'

export const EMPTY_ACCESS = {
  admin: false,
  approvals: false,
  updates: false,
  coordinator: false
}

export function normalizeAccess(access) {
  return {
    admin: Boolean(access?.admin),
    approvals: Boolean(access?.approvals),
    updates: Boolean(access?.updates),
    coordinator: Boolean(access?.coordinator)
  }
}

export function hasAnyAccess(access) {
  return Object.values(normalizeAccess(access)).some(Boolean)
}

export function hasRequiredAccess(access, requirements = {}) {
  const normalized = normalizeAccess(access)
  if (requirements.admin && !normalized.admin) return false
  if (requirements.approvals && !normalized.approvals) return false
  if (requirements.updates && !normalized.updates) return false
  if (requirements.coordinator && !normalized.coordinator) return false
  return true
}

export async function getSessionAccess() {
  const session = await getServerSession(authOptions)
  const email = sanitizeString(session?.user?.email).toLowerCase()
  if (!email) return null

  let access = normalizeAccess(session?.user?.access)
  if (!hasAnyAccess(access)) {
    const computed = await getAuthAccess(email)
    access = normalizeAccess(computed)
  }

  return { email, access }
}
