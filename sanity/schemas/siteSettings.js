import { DEFAULT_CLASSIFICATION_PROMPT } from '../../lib/classificationPrompt.js'
import {
  DEFAULT_SYSTEM_PROMPT,
  TRIAL_SUMMARY_SYSTEM_PROMPT,
  TRIAL_COMMUNICATION_TITLE_PROMPT,
  TRIAL_COMMUNICATION_ELIGIBILITY_PROMPT,
} from '../../lib/summaries.js'
import { ClassificationPromptInput } from '../components/ClassificationPromptInput.jsx'
import { SystemPromptInput } from '../components/SystemPromptInput.jsx'
import { TrialSummaryPromptInput } from '../components/TrialSummaryPromptInput.jsx'
import { TrialCommunicationTitlePromptInput } from '../components/TrialCommunicationTitlePromptInput.jsx'
import { TrialCommunicationEligibilityPromptInput } from '../components/TrialCommunicationEligibilityPromptInput.jsx'

export default {
  name: 'siteSettings',
  title: 'Site Settings',
  type: 'document',
  // Singleton - only one instance
  __experimental_actions: ['update', 'publish'],
  fields: [
    {
      name: 'maintenanceMode',
      title: 'Maintenance Mode',
      type: 'object',
      fields: [
        {
          name: 'enabled',
          title: 'Enable Maintenance Mode',
          type: 'boolean',
          description: 'Turn on to show under construction page to visitors',
          initialValue: false
        },
        {
          name: 'password',
          title: 'Access Password',
          type: 'string',
          description: 'Password for privileged access during maintenance'
        },
        {
          name: 'title',
          title: 'Title',
          type: 'string',
          initialValue: 'Under Construction'
        },
        {
          name: 'message',
          title: 'Message',
          type: 'text',
          rows: 3,
          initialValue: 'We\'re updating our website. Enter the password to preview the new site.'
        },
        {
          name: 'contactInfo',
          title: 'Contact Information',
          type: 'string',
          initialValue: 'For access, contact the research unit.'
        }
      ]
    },
    {
      name: 'unitName',
      title: 'Research Unit Name',
      type: 'string',
      validation: Rule => Rule.required()
    },
    {
      name: 'tagline',
      title: 'Tagline',
      type: 'string'
    },
    {
      name: 'taglineHighlight',
      title: 'Tagline Highlight',
      type: 'string',
      description: 'Exact text within the tagline to show in purple (optional).'
    },
    {
      name: 'taglineHighlights',
      title: 'Tagline Highlights (multiple)',
      type: 'array',
      of: [{ type: 'string' }],
      description: 'Optional list of exact phrases to highlight in purple.'
    },
    {
      name: 'description',
      title: 'About / Description',
      type: 'text',
      rows: 4
    },
    {
      name: 'logo',
      title: 'Logo',
      type: 'image'
    },
    {
      name: 'llmProvider',
      title: 'LLM Provider (summaries)',
      type: 'string',
      initialValue: 'openrouter',
      options: {
        list: [
          { title: 'OpenRouter', value: 'openrouter' },
          { title: 'OpenAI', value: 'openai' },
          { title: 'Together', value: 'together' },
          { title: 'Groq', value: 'groq' },
          { title: 'Ollama', value: 'ollama' },
          { title: 'Anthropic', value: 'anthropic' }
        ]
      },
      description: 'Defaults to OpenRouter; leave blank to use environment defaults'
    },
    {
      name: 'llmModel',
      title: 'LLM Model (summaries)',
      type: 'string',
      description: 'e.g., openrouter/gpt-4o-mini or meta-llama/llama-3.1-8b-instruct:free'
    },
    {
      name: 'llmApiKey',
      title: 'LLM API Key (summaries; server-only)',
      type: 'string',
      description: 'Optional override. Leave blank to use server env vars.'
    },
    {
      name: 'llmSystemPrompt',
      title: 'LLM System Prompt (summaries)',
      type: 'text',
      rows: 4,
      description: 'Optional custom instructions for publication summaries.',
      initialValue: DEFAULT_SYSTEM_PROMPT,
      components: {
        input: SystemPromptInput
      }
    },
    {
      name: 'trialSummaryLlmProvider',
      title: 'LLM Provider (trial summaries)',
      type: 'string',
      options: {
        list: [
          { title: 'OpenRouter', value: 'openrouter' },
          { title: 'OpenAI', value: 'openai' },
          { title: 'Together', value: 'together' },
          { title: 'Groq', value: 'groq' },
          { title: 'Ollama', value: 'ollama' },
          { title: 'Anthropic', value: 'anthropic' }
        ]
      },
      description: 'Leave blank to use environment defaults.'
    },
    {
      name: 'trialSummaryLlmModel',
      title: 'LLM Model (trial summaries)',
      type: 'string',
      description: 'e.g., google/gemma-2-9b-it or openrouter/gpt-4o-mini'
    },
    {
      name: 'trialSummaryLlmApiKey',
      title: 'LLM API Key (trial summaries; server-only)',
      type: 'string',
      description: 'Optional override. Leave blank to use server env vars.'
    },
    {
      name: 'trialSummarySystemPrompt',
      title: 'LLM System Prompt (trial summaries)',
      type: 'text',
      rows: 6,
      description: 'Optional custom instructions for trial summaries.',
      initialValue: TRIAL_SUMMARY_SYSTEM_PROMPT,
      components: {
        input: TrialSummaryPromptInput
      }
    },
    {
      name: 'trialCommunicationsLlmProvider',
      title: 'LLM Provider (clinical communications)',
      type: 'string',
      options: {
        list: [
          { title: 'OpenRouter', value: 'openrouter' },
          { title: 'OpenAI', value: 'openai' },
          { title: 'Together', value: 'together' },
          { title: 'Groq', value: 'groq' },
          { title: 'Ollama', value: 'ollama' },
          { title: 'Anthropic', value: 'anthropic' }
        ]
      },
      description: 'Optional override for short clinical titles and eligibility statements.'
    },
    {
      name: 'trialCommunicationsLlmModel',
      title: 'LLM Model (clinical communications)',
      type: 'string',
      description: 'Optional override for short clinical titles and eligibility statements.'
    },
    {
      name: 'trialCommunicationsLlmApiKey',
      title: 'LLM API Key (clinical communications; server-only)',
      type: 'string',
      description: 'Optional override. Leave blank to use server env vars.'
    },
    {
      name: 'trialCommunicationsTitlePrompt',
      title: 'LLM Prompt (short clinical title)',
      type: 'text',
      rows: 8,
      description: 'Leave empty to use the built-in default prompt.',
      initialValue: TRIAL_COMMUNICATION_TITLE_PROMPT,
      components: {
        input: TrialCommunicationTitlePromptInput
      }
    },
    {
      name: 'trialCommunicationsEligibilityPrompt',
      title: 'LLM Prompt (eligibility statement)',
      type: 'text',
      rows: 8,
      description: 'Leave empty to use the built-in default prompt.',
      initialValue: TRIAL_COMMUNICATION_ELIGIBILITY_PROMPT,
      components: {
        input: TrialCommunicationEligibilityPromptInput
      }
    },
    {
      name: 'llmConcurrency',
      title: 'LLM Concurrency',
      type: 'number',
      description: 'Number of parallel LLM requests. Default: 1 for free models. Increase to 3-5 for paid models.',
      initialValue: 1
    },
    {
      name: 'llmDelayMs',
      title: 'LLM Delay (ms)',
      type: 'number',
      description: 'Delay between batches in milliseconds. Default: 2000 for free models. Reduce to 500-1000 for paid models.',
      initialValue: 2000
    },
    {
      name: 'llmClassificationProvider',
      title: 'LLM Provider (classification)',
      type: 'string',
      options: {
        list: [
          { title: 'OpenRouter', value: 'openrouter' },
          { title: 'OpenAI', value: 'openai' },
          { title: 'Together', value: 'together' },
          { title: 'Groq', value: 'groq' },
          { title: 'Ollama', value: 'ollama' },
          { title: 'Anthropic', value: 'anthropic' }
        ]
      },
      description: 'Optional override for classification; falls back to summary provider if blank.'
    },
    {
      name: 'llmClassificationModel',
      title: 'LLM Model (classification)',
      type: 'string',
      description: 'Optional override for classification; falls back to summary model if blank.'
    },
    {
      name: 'llmClassificationApiKey',
      title: 'LLM API Key (classification; server-only)',
      type: 'string',
      description: 'Optional override for classification; falls back to summary key/env if blank.'
    },
    {
      name: 'llmClassificationPrompt',
      title: 'LLM Classification Prompt',
      type: 'text',
      rows: 30,
      description: 'Leave empty to use the built-in default. Click "Copy default into field" only if you want to edit it.',
      initialValue: DEFAULT_CLASSIFICATION_PROMPT,
      components: {
        input: ClassificationPromptInput
      }
    },
    {
      name: 'affiliations',
      title: 'Affiliations (optional)',
      type: 'array',
      of: [
        {
          type: 'object',
          fields: [
            { name: 'name', title: 'Name', type: 'string' },
            { name: 'url', title: 'URL', type: 'url' },
            { name: 'logo', title: 'Logo', type: 'image' }
          ]
        }
      ],
      description: 'e.g., Western University, London Health Sciences Centre'
    },
    {
      name: 'contactEmail',
      title: 'Contact Email',
      type: 'string',
      description: 'Optional fallback used when a contact reason does not provide a target email.'
    },
    {
      name: 'phone',
      title: 'Phone',
      type: 'string'
    },
    {
      name: 'address',
      title: 'Address',
      type: 'text',
      rows: 3
    },
    {
      name: 'institutionAffiliation',
      title: 'Institution Affiliation',
      type: 'string',
      description: 'e.g., Western University, London Health Sciences Centre'
    },
    {
      name: 'socialLinks',
      title: 'Social Media Links',
      type: 'object',
      fields: [
        { name: 'twitter', title: 'Twitter/X', type: 'url' },
        { name: 'linkedin', title: 'LinkedIn', type: 'url' },
        { name: 'github', title: 'GitHub', type: 'url' },
        { name: 'youtube', title: 'YouTube', type: 'url' }
      ]
    },
    {
      name: 'pubmedAffiliation',
      title: 'PubMed Affiliation Search Term',
      type: 'string',
      description: 'Used for fetching unit publications, e.g., "Lilibeth Caberto Kidney Clinical Research Unit"'
    },
    {
      name: 'altmetric',
      title: 'Altmetric Donuts',
      type: 'object',
      description: 'Show Altmetric donut badges on publications to display social media and news attention.',
      fields: [
        {
          name: 'enabled',
          title: 'Enable Altmetric donuts',
          type: 'boolean',
          description: 'When enabled, publications will display Altmetric attention score donuts (requires DOI or PMID).',
          initialValue: false
        }
      ]
    },
    {
      name: 'studyApprovals',
      title: 'Study Approvals',
      type: 'object',
      description: 'Configure who can approve study submissions and receive approval notifications.',
      fields: [
        {
          name: 'coordinatorDomain',
          title: 'Coordinator Email Domain',
          type: 'string',
          description: 'Only emails at this domain can submit studies (e.g., lhsc.on.ca).',
          initialValue: 'lhsc.on.ca'
        },
        {
          name: 'admins',
          title: 'Approval Admin Emails',
          type: 'array',
          of: [{ type: 'string' }],
          description: 'Only these emails can request approval links and receive submission notifications.',
          validation: Rule =>
            Rule.custom((items = []) => {
              const invalid = (items || []).find((item) => item && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(item))
              return invalid ? 'Provide valid email addresses.' : true
            })
        }
      ]
    },
    {
      name: 'studyUpdates',
      title: 'Study Update Emails',
      type: 'object',
      description: 'Configure study update email settings and admin access.',
      fields: [
        {
          name: 'admins',
          title: 'Update Admin Emails',
          type: 'array',
          of: [{ type: 'string' }],
          description: 'Only these emails can access the study update admin portal.',
          validation: Rule =>
            Rule.custom((items = []) => {
              const invalid = (items || []).find((item) => item && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(item))
              return invalid ? 'Provide valid email addresses.' : true
            })
        },
        {
          name: 'subjectTemplate',
          title: 'Email Subject Template',
          type: 'string',
          description: 'Use {{month}} for the month label.',
          initialValue: 'Monthly study updates - {{month}}'
        },
        {
          name: 'introText',
          title: 'Intro Text',
          type: 'text',
          rows: 2,
          description: 'Shown when there are studies to share.'
        },
        {
          name: 'emptyIntroText',
          title: 'Empty Intro Text',
          type: 'text',
          rows: 2,
          description: 'Shown when there are no recruiting studies.'
        },
        {
          name: 'outroText',
          title: 'Closing Text',
          type: 'text',
          rows: 2,
          description: 'Optional closing line before preferences link.'
        },
        {
          name: 'signature',
          title: 'Signature',
          type: 'string',
          description: 'Footer signature line.',
          initialValue: 'London Kidney Clinical Research'
        },
        {
          name: 'maxStudies',
          title: 'Max Studies Per Email',
          type: 'number',
          description: 'Overrides STUDY_UPDATE_MAX_STUDIES if set.',
          validation: Rule => Rule.min(1).max(12)
        }
      ]
    }
  ]
}
