import researcher from './researcher'
import newsPost from './newsPost'
import siteSettings from './siteSettings'
import capabilities from './capabilities'
import trialSummary from './trialSummary'
import therapeuticArea from './therapeuticArea'
import referralInfo from './referralInfo'
import traineeOpportunity from './traineeOpportunity'
import alumnus from './alumnus'
import site from './site'
import pubmedCache from './pubmedCache'
import pageContent from './pageContent'

export const schemaTypes = [
  // Singletons (one instance)
  siteSettings,
  capabilities,
  referralInfo,
  pubmedCache,
  pageContent,
  
  // Collections
  researcher,
  newsPost,
  trialSummary,
  therapeuticArea,
  traineeOpportunity,
  alumnus,
  site
]

