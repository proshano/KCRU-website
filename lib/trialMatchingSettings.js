export function isTrialMatchingAssistantEnabled(settings) {
  return Boolean(settings?.trialMatchingAssistant?.enabled)
}

function cleanSetting(value) {
  const text = String(value || '').replace(/\s+/g, ' ').trim()
  return text || undefined
}

export function resolveTrialMatchingLlmOptions(settings) {
  const assistant = settings?.trialMatchingAssistant || {}
  return {
    provider:
      cleanSetting(assistant.llmProvider) ||
      cleanSetting(settings?.trialSummaryLlmProvider) ||
      cleanSetting(settings?.llmProvider),
    model:
      cleanSetting(assistant.llmModel) ||
      cleanSetting(settings?.trialSummaryLlmModel) ||
      cleanSetting(settings?.llmModel),
  }
}
