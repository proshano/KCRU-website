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
      title: 'LLM Provider (for summaries)',
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
      title: 'LLM Model',
      type: 'string',
      description: 'e.g., openrouter/gpt-4o-mini or meta-llama/llama-3.1-8b-instruct:free'
    },
    {
      name: 'llmApiKey',
      title: 'LLM API Key (server-only)',
      type: 'string',
      description: 'Optional override. Leave blank to use server env vars.'
    },
    {
      name: 'llmSystemPrompt',
      title: 'LLM System Prompt',
      type: 'text',
      rows: 4,
      description: 'Optional custom instructions for publication summaries. Defaults to: "You write summaries of medical research for a general sophisticated audience. Be accurate but avoid jargon. Explain what was studied, what was found, and why it matters but avoid statements about more research is needed. Do not make up information. Keep summaries to 2-3 sentences. Do not create abbreviations in the summary."'
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

