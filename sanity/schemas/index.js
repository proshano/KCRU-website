import researcher from './researcher'
import newsPost from './newsPost'
import siteSettings from './siteSettings'
import capabilities from './capabilities'
import trialSummary from './trialSummary'
import referralInfo from './referralInfo'
import traineeOpportunity from './traineeOpportunity'
import alumnus from './alumnus'
import site from './site'
import pubmedCache from './pubmedCache'
import contactRouting from './contactRouting'
import contactSubmission from './contactSubmission'
import contactLocation from './contactLocation'

export const schemaTypes = [
  // Singletons (one instance)
  siteSettings,
  capabilities,
  referralInfo,
  pubmedCache,
  contactRouting,
  contactLocation,
  
  // Collections
  researcher,
  newsPost,
  trialSummary,
  traineeOpportunity,
  alumnus,
  site,
  contactSubmission
]

