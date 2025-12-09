export default {
  name: 'capabilities',
  title: 'Capabilities (For Sponsors)',
  type: 'document',
  __experimental_actions: ['update', 'publish'], // Singleton
  fields: [
    {
      name: 'headline',
      title: 'Headline',
      type: 'string',
      description: 'e.g., "Partner With Us on Clinical Research"'
    },
    {
      name: 'introduction',
      title: 'Introduction',
      type: 'text',
      rows: 4
    },
    {
      name: 'therapeuticAreas',
      title: 'Therapeutic Focus Areas',
      type: 'array',
      of: [
        {
          type: 'object',
          fields: [
            { name: 'area', title: 'Area', type: 'string' },
            { name: 'description', title: 'Description', type: 'text', rows: 2 }
          ]
        }
      ]
    },
    {
      name: 'coreCapabilities',
      title: 'Core Capabilities',
      type: 'array',
      of: [{ type: 'string' }],
      description: 'e.g., "Phase I-IV clinical trials", "Pragmatic trials", "Biomarker studies"'
    },
    {
      name: 'trackRecord',
      title: 'Track Record Highlights',
      type: 'array',
      of: [
        {
          type: 'object',
          fields: [
            { name: 'metric', title: 'Metric', type: 'string' },
            { name: 'value', title: 'Value', type: 'string' }
          ]
        }
      ],
      description: 'e.g., "Trials Completed: 45", "Average Enrollment Rate: 2.3 patients/site/month"'
    },
    {
      name: 'regulatoryExperience',
      title: 'Regulatory Experience',
      type: 'array',
      of: [{ type: 'string' }],
      options: { layout: 'tags' },
      description: 'e.g., Health Canada, FDA IND, GCP certified'
    },
    {
      name: 'previousSponsors',
      title: 'Previous Sponsors/Partners',
      type: 'array',
      of: [{ type: 'string' }],
      options: { layout: 'tags' },
      description: 'Companies you\'ve worked with (if shareable)'
    },
    {
      name: 'additionalServices',
      title: 'Additional Services',
      type: 'array',
      of: [
        {
          type: 'object',
          fields: [
            { name: 'service', title: 'Service', type: 'string' },
            { name: 'description', title: 'Description', type: 'text', rows: 2 }
          ]
        }
      ],
      description: 'e.g., Consulting, Protocol development, Site feasibility'
    },
    {
      name: 'contactName',
      title: 'Partnership Contact Name',
      type: 'string'
    },
    {
      name: 'contactEmail',
      title: 'Partnership Contact Email',
      type: 'string'
    },
    {
      name: 'contactPhone',
      title: 'Partnership Contact Phone',
      type: 'string'
    }
  ]
}

