import researcher from './researcher'
import newsPost from './newsPost'
import siteSettings from './siteSettings'
import capabilities from './capabilities'
import trialSummary from './trialSummary'
import referralInfo from './referralInfo'
import traineeOpportunity from './traineeOpportunity'
import alumnus from './alumnus'
import site from './site'

export const schemaTypes = [
  // Singletons (one instance)
  siteSettings,
  capabilities,
  referralInfo,
  
  // Collections
  researcher,
  newsPost,
  trialSummary,
  traineeOpportunity,
  alumnus,
  site
]

