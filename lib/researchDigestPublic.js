import { RESEARCH_DIGEST_PREF } from './researchDigestConfig.js'

export function isResearchDigestPublicEnabled(siteSettings = {}) {
  return siteSettings?.researchDigest?.publicEnabled === true
}

export function getPublicCorrespondenceOptions(options = [], siteSettings = {}) {
  if (isResearchDigestPublicEnabled(siteSettings)) return options
  return options.filter((option) => option?.value !== RESEARCH_DIGEST_PREF)
}
