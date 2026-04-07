export function isTrialMatchingAssistantEnabled(settings) {
  return Boolean(settings?.trialMatchingAssistant?.enabled)
}
