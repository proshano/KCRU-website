import AzureADProvider from 'next-auth/providers/azure-ad'
import {
  getAuthAccessForConfig as computeAuthAccessForConfig,
  normalizeAccessConfig,
} from './authAccessRules.js'

const ACCESS_CACHE_TTL_MS = 60 * 1000
let accessCache = null
let accessCacheAt = 0

async function fetchAccessConfig() {
  const { sanityFetch } = await import('./sanity.js')
  const settings = await sanityFetch(`
    *[_type == "siteSettings"][0]{
      "coordinatorEmails": studyApprovals.coordinatorEmails,
      "approvalAdmins": studyApprovals.admins,
      "updateAdmins": studyUpdates.admins,
      "coordinatorDomains": studyApprovals.coordinatorDomain
    }
  `)

  return normalizeAccessConfig({
    coordinators: settings?.coordinatorEmails,
    approvalAdmins: settings?.approvalAdmins,
    updateAdmins: settings?.updateAdmins,
    domains: settings?.coordinatorDomains
  })
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

export function getAuthAccessForConfig(email, config = {}) {
  return computeAuthAccessForConfig(email, config)
}

export async function getAuthAccess(email) {
  const config = await getAccessConfig()
  return getAuthAccessForConfig(email, config)
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
      if (email) {
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
