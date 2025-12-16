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
import pubmedClassification from './pubmedClassification'
import pageContent from './pageContent'
import contactRouting from './contactRouting'
import contactLocation from './contactLocation'
import contactSubmission from './contactSubmission'

export const schemaTypes = [
  // Singletons (one instance)
  siteSettings,
  capabilities,
  referralInfo,
  pubmedCache,
  pubmedClassification,
  pageContent,
  contactRouting,
  contactLocation,
  
  // Collections
  researcher,
  newsPost,
  trialSummary,
  therapeuticArea,
  traineeOpportunity,
  alumnus,
  site,
  contactSubmission
]

