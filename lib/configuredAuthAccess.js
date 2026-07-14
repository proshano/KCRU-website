import { getAuthAccessForConfig } from './authAccessRules.js'

export async function getConfiguredAuthAccess(email) {
  const { sanityFetch } = await import('./sanity.js')
  const settings = await sanityFetch(`
    *[_type == "siteSettings"][0]{
      "coordinators": studyApprovals.coordinatorEmails,
      "approvalAdmins": studyApprovals.admins,
      "updateAdmins": studyUpdates.admins,
      "domains": studyApprovals.coordinatorDomain
    }
  `)

  return getAuthAccessForConfig(email, settings || {})
}
