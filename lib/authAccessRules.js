import { resolveCoordinatorDomains } from './coordinatorDomains.js'
import { sanitizeString } from './studySubmissions.js'

function normalizeEmail(value) {
  return sanitizeString(value).toLowerCase()
}

function normalizeEmailList(list) {
  if (!Array.isArray(list)) return []
  const normalized = list.map(normalizeEmail).filter(Boolean)
  return Array.from(new Set(normalized))
}

export function normalizeAccessConfig(config = {}) {
  return {
    coordinators: normalizeEmailList(config.coordinators),
    approvalAdmins: normalizeEmailList(config.approvalAdmins),
    updateAdmins: normalizeEmailList(config.updateAdmins),
    domains: resolveCoordinatorDomains(config.domains)
  }
}

export function getAuthAccessForConfig(email, config = {}) {
  const normalized = normalizeEmail(email)
  if (!normalized) {
    return {
      allowed: false,
      admin: false,
      approvals: false,
      updates: false,
      coordinator: false
    }
  }

  const normalizedConfig = normalizeAccessConfig(config)
  const inCoordinatorList = normalizedConfig.coordinators.includes(normalized)
  const inApprovalAdmins = normalizedConfig.approvalAdmins.includes(normalized)
  const inUpdateAdmins = normalizedConfig.updateAdmins.includes(normalized)
  const admin = inApprovalAdmins || inUpdateAdmins
  const coordinator = inCoordinatorList || inApprovalAdmins
  const approvals = inApprovalAdmins
  const updates = inUpdateAdmins
  const domainOk = normalizedConfig.domains.some((domain) => normalized.endsWith(`@${domain}`))
  const allowed = domainOk && (inCoordinatorList || admin)

  return {
    allowed,
    admin,
    approvals,
    updates,
    coordinator
  }
}
