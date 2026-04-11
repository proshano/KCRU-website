import { sanityFetch } from '@/lib/sanity'
import { sanitizeString } from '@/lib/studySubmissions'

const DEFAULT_COORDINATOR_DOMAINS = ['lhsc.on.ca', 'sjhc.london.on.ca']
const DOMAIN_SPLIT_RE = /[\n,;]+/

function normalizeDomain(value) {
  return sanitizeString(value).toLowerCase().replace(/^@/, '')
}

export function normalizeCoordinatorDomains(value) {
  const items = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(DOMAIN_SPLIT_RE)
      : []

  const normalized = items.map(normalizeDomain).filter(Boolean)
  return Array.from(new Set(normalized))
}

export function resolveCoordinatorDomains(value) {
  const domains = normalizeCoordinatorDomains(value)
  if (!domains.length) return [...DEFAULT_COORDINATOR_DOMAINS]

  // Preserve backward compatibility for the legacy single-domain setting while
  // allowing the current LHSC and St. Joseph's domains without a content migration.
  if (domains.length === 1 && DEFAULT_COORDINATOR_DOMAINS.includes(domains[0])) {
    return [...DEFAULT_COORDINATOR_DOMAINS]
  }

  return domains
}

export function emailMatchesCoordinatorDomain(email, domains) {
  const normalizedEmail = sanitizeString(email).toLowerCase()
  if (!normalizedEmail) return false

  const allowedDomains = resolveCoordinatorDomains(domains)
  return allowedDomains.some((domain) => normalizedEmail.endsWith(`@${domain}`))
}

export function formatCoordinatorDomains(domains) {
  return resolveCoordinatorDomains(domains)
    .map((domain) => `@${domain}`)
    .join(', ')
}

export async function getCoordinatorDomains() {
  const settings = await sanityFetch(`
    *[_type == "siteSettings"][0]{
      "domains": studyApprovals.coordinatorDomain
    }
  `)

  return resolveCoordinatorDomains(
    settings?.domains || process.env.STUDY_COORDINATOR_DOMAIN || ''
  )
}
