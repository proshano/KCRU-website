import AzureADProvider from 'next-auth/providers/azure-ad'
import { sanityFetch } from '@/lib/sanity'
import { sanitizeString } from '@/lib/studySubmissions'

const ACCESS_CACHE_TTL_MS = 60 * 1000
let accessCache = null
let accessCacheAt = 0

function normalizeEmail(value) {
  return sanitizeString(value).toLowerCase()
}

function normalizeEmailList(list) {
  if (!Array.isArray(list)) return []
  const normalized = list.map(normalizeEmail).filter(Boolean)
  return Array.from(new Set(normalized))
}

function normalizeDomain(value) {
  const cleaned = sanitizeString(value).toLowerCase().replace(/^@/, '')
  return cleaned || ''
}

async function fetchAccessConfig() {
  const settings = await sanityFetch(`
    *[_type == "siteSettings"][0]{
      "coordinatorEmails": studyApprovals.coordinatorEmails,
      "approvalAdmins": studyApprovals.admins,
      "updateAdmins": studyUpdates.admins,
      "coordinatorDomain": studyApprovals.coordinatorDomain
    }
  `)

  return {
    coordinators: normalizeEmailList(settings?.coordinatorEmails),
    approvalAdmins: normalizeEmailList(settings?.approvalAdmins),
    updateAdmins: normalizeEmailList(settings?.updateAdmins),
    domain: normalizeDomain(settings?.coordinatorDomain)
  }
}

async function getAccessConfig() {
  const now = Date.now()
  if (accessCache && now - accessCacheAt < ACCESS_CACHE_TTL_MS) {
    return accessCache
  }
  accessCache = await fetchAccessConfig()
  accessCacheAt = now
  return accessCache
}

function hasAccessValues(access) {
  if (!access || typeof access !== 'object') return false
  return Object.values(access).some(Boolean)
}

export async function getAuthAccess(email) {
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

  const config = await getAccessConfig()
  const inCoordinatorList = config.coordinators.includes(normalized)
  const inApprovalAdmins = config.approvalAdmins.includes(normalized)
  const inUpdateAdmins = config.updateAdmins.includes(normalized)
  const admin = inApprovalAdmins || inUpdateAdmins
  const coordinator = inCoordinatorList || admin
  const approvals = admin || inApprovalAdmins
  const updates = admin || inUpdateAdmins
  const domainOk = !config.domain || normalized.endsWith(`@${config.domain}`)
  const allowed = domainOk && (inCoordinatorList || admin)

  return {
    allowed,
    admin,
    approvals,
    updates,
    coordinator
  }
}

export const authOptions = {
  secret: process.env.NEXTAUTH_SECRET,
  session: {
    strategy: 'jwt'
  },
  providers: [
    AzureADProvider({
      clientId: process.env.AZURE_AD_CLIENT_ID,
      clientSecret: process.env.AZURE_AD_CLIENT_SECRET,
      tenantId: process.env.AZURE_AD_TENANT_ID,
      authorization: { params: { scope: 'openid profile email' } },
      profile(profile) {
        const email = profile.email || profile.preferred_username || profile.upn || null
        const name = profile.name || profile.preferred_username || email || null

        return {
          id: profile.sub,
          name,
          email,
          image: null
        }
      }
    })
  ],
  callbacks: {
    async signIn({ user, profile }) {
      const email = user?.email || profile?.email || profile?.preferred_username || profile?.upn
      const access = await getAuthAccess(email)
      return access.allowed
    },
    async jwt({ token, user, profile }) {
      if (user?.name) token.name = user.name
      if (user?.email) token.email = user.email
      if (profile) {
        token.name = token.name || profile.name || profile.preferred_username
        token.email = token.email || profile.email || profile.preferred_username || profile.upn
      }
      const email = token.email || user?.email || profile?.email || profile?.preferred_username || profile?.upn
      if (email && (!hasAccessValues(token.access) || user || profile)) {
        const access = await getAuthAccess(email)
        token.access = {
          admin: access.admin,
          approvals: access.approvals,
          updates: access.updates,
          coordinator: access.coordinator
        }
      }
      return token
    },
    async session({ session, token }) {
      if (session?.user) {
        session.user.name = token.name || session.user.name || null
        session.user.email = token.email || session.user.email || null
        session.user.access = token.access || {
          admin: false,
          approvals: false,
          updates: false,
          coordinator: false
        }
      }
      return session
    }
  },
  pages: {
    signIn: '/login'
  }
}
