export default {
  name: 'pubmedClassification',
  title: 'PubMed Classification',
  type: 'document',
  fields: [
    {
      name: 'pmid',
      title: 'PMID',
      type: 'string',
      description: 'PubMed ID',
      validation: (Rule) => Rule.required(),
    },
    {
      name: 'topics',
      title: 'Topics',
      type: 'array',
      of: [{ type: 'string' }],
    },
    {
      name: 'studyDesign',
      title: 'Study Design',
      type: 'array',
      of: [{ type: 'string' }],
    },
    {
      name: 'methodologicalFocus',
      title: 'Methodological Focus',
      type: 'array',
      of: [{ type: 'string' }],
    },
    {
      name: 'exclude',
      title: 'Exclude',
      type: 'boolean',
      initialValue: false,
    },
    {
      name: 'summary',
      title: 'Summary (for reference)',
      type: 'text',
      rows: 3,
      description: 'Optional reference copy of lay summary used during classification.',
    },
    {
      name: 'promptText',
      title: 'Prompt Text',
      type: 'text',
      rows: 6,
      description: 'Prompt used for this classification run.',
    },
    {
      name: 'promptVersion',
      title: 'Prompt Version/Hash',
      type: 'string',
      description: 'Optional hash/version to track prompt.',
    },
    {
      name: 'provider',
      title: 'LLM Provider',
      type: 'string',
    },
    {
      name: 'model',
      title: 'LLM Model',
      type: 'string',
    },
    {
      name: 'runAt',
      title: 'Classified At',
      type: 'datetime',
    },
    {
      name: 'status',
      title: 'Status',
      type: 'string',
      options: {
        list: [
          { title: 'ok', value: 'ok' },
          { title: 'error', value: 'error' },
        ],
      },
    },
    {
      name: 'error',
      title: 'Error',
      type: 'text',
      rows: 2,
    },
  ],
  preview: {
    select: {
      title: 'pmid',
      subtitle: 'runAt',
    },
  },
}
