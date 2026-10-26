const pubmedClassification = {
  name: 'pubmedClassification',
  title: 'PubMed Classification',
  type: 'document',
  fields: [
    {
      name: 'pmid',
      title: 'PMID',
      type: 'string',
      description: 'PubMed ID (empty for a paper known only by its DOI)',
    },
    {
      name: 'publicationKey',
      title: 'Publication Key',
      type: 'string',
      description: 'The paper\'s identity in the publication cache (doi:… or pmid:…); how a DOI-only paper is matched',
      readOnly: true,
    },
    {
      name: 'title',
      title: 'Publication Title',
      type: 'string',
      description: 'Title of the publication (for searchability)',
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
      name: 'backend',
      title: 'Classifier',
      type: 'string',
      description: 'chat (LLM prompt) or jev (decision model: Jev or GPT-6 Luna Decisions, named in LLM Model); "chat" with a fallback note means the decision model failed for this paper.',
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
      pmid: 'pmid',
      publicationKey: 'publicationKey',
      pubTitle: 'title',
      runAt: 'runAt',
      topics: 'topics',
    },
    prepare({ pmid, publicationKey, pubTitle, runAt, topics }) {
      const topicStr = topics?.length ? topics.slice(0, 2).join(', ') : ''
      const date = runAt ? new Date(runAt).toLocaleDateString() : ''
      return {
        title: pubTitle || (pmid ? `PMID: ${pmid}` : publicationKey || 'Classification'),
        subtitle: [topicStr, date].filter(Boolean).join(' • '),
      }
    },
  },
}

export default pubmedClassification
