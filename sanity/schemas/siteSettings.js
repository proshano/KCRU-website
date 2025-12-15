import { DEFAULT_CLASSIFICATION_PROMPT } from '../../lib/classificationPrompt.js'
import { DEFAULT_SYSTEM_PROMPT } from '../../lib/summaries.js'
import { ClassificationPromptInput } from '../components/ClassificationPromptInput.jsx'
import { SystemPromptInput } from '../components/SystemPromptInput.jsx'

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
      type: 'string'
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
    }
  ]
}

