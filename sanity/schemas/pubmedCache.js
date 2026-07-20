const pubmedCache = {
  name: 'pubmedCache',
  title: 'PubMed Cache',
  type: 'document',
  // Hidden from main list - managed programmatically
  liveEdit: true,
  fields: [
    {
      name: 'cacheKey',
      title: 'Cache Key',
      type: 'string',
      description: 'Unique key identifying the cache parameters',
      readOnly: true,
    },
    {
      name: 'lastRefreshedAt',
      title: 'Last Refreshed',
      type: 'datetime',
      readOnly: true,
    },
    {
      name: 'refreshInProgress',
      title: 'Refresh In Progress',
      type: 'boolean',
      initialValue: false,
    },
    {
      name: 'refreshStartedAt',
      title: 'Refresh Started At',
      type: 'datetime',
      description: 'When the current refresh started (for timeout detection)',
    },
    {
      name: 'publications',
      title: 'Publications',
      type: 'array',
      of: [
        {
          type: 'object',
          fields: [
            { name: 'publicationKey', type: 'string', title: 'Canonical Publication Key' },
            { name: 'pmid', type: 'string', title: 'PMID' },
            { name: 'title', type: 'string', title: 'Title' },
            { name: 'publishedAt', type: 'datetime', title: 'Published At' },
            { name: 'authors', type: 'array', of: [{ type: 'string' }], title: 'Authors' },
            { name: 'journal', type: 'string', title: 'Journal' },
            { name: 'year', type: 'number', title: 'Year' },
            { name: 'month', type: 'string', title: 'Month' },
            { name: 'abstract', type: 'text', title: 'Abstract or Article Body Text' },
            {
              name: 'abstractContentType',
              type: 'string',
              title: 'Publication Text Type',
              options: {
                list: [
                  { title: 'Abstract', value: 'abstract' },
                  { title: 'Article body fallback', value: 'article_body' },
                ],
              },
            },
            { name: 'abstractSource', type: 'string', title: 'Publication Text Source' },
            { name: 'doi', type: 'string', title: 'DOI' },
            { name: 'source', type: 'string', title: 'Primary Metadata Source' },
            { name: 'sources', type: 'array', of: [{ type: 'string' }], title: 'Discovery Sources' },
            { name: 'openAlexId', type: 'string', title: 'OpenAlex ID' },
            { name: 'europePmcId', type: 'string', title: 'Europe PMC ID' },
            { name: 'publicationTypes', type: 'array', of: [{ type: 'string' }], title: 'PubMed Publication Types' },
            { name: 'url', type: 'url', title: 'Publication URL' },
            { name: 'pubmedUrl', type: 'url', title: 'PubMed URL' },
            { name: 'laySummary', type: 'text', title: 'Lay Summary' },
            { name: 'topics', type: 'array', of: [{ type: 'string' }], title: 'Topics' },
            { name: 'studyDesign', type: 'array', of: [{ type: 'string' }], title: 'Study Design' },
            { name: 'methodologicalFocus', type: 'array', of: [{ type: 'string' }], title: 'Methodological Focus' },
            { name: 'exclude', type: 'boolean', title: 'Exclude from display' },
          ],
        },
      ],
    },
    {
      name: 'provenance',
      title: 'Provenance',
      type: 'array',
      description: 'Maps PMIDs to researcher IDs',
      of: [
        {
          type: 'object',
          fields: [
            { name: 'publicationKey', type: 'string', title: 'Canonical Publication Key' },
            { name: 'pmid', type: 'string', title: 'PMID' },
            { name: 'researcherIds', type: 'array', of: [{ type: 'string' }], title: 'Researcher IDs' },
          ],
        },
      ],
    },
    {
      name: 'stats',
      title: 'Statistics',
      type: 'object',
      fields: [
        { name: 'totalPublications', type: 'number', title: 'Total Publications' },
        { name: 'totalWithSummary', type: 'number', title: 'With Summaries' },
        { name: 'lastSummaryModel', type: 'string', title: 'Last Summary Model' },
      ],
    },
  ],
  preview: {
    select: {
      lastRefreshed: 'lastRefreshedAt',
      total: 'stats.totalPublications',
      summaries: 'stats.totalWithSummary',
    },
    prepare({ lastRefreshed, total, summaries }) {
      const date = lastRefreshed ? new Date(lastRefreshed).toLocaleDateString() : 'Never'
      return {
        title: 'PubMed Publications Cache',
        subtitle: `${total || 0} publications, ${summaries || 0} summaries • Last refresh: ${date}`,
      }
    },
  },
}

export default pubmedCache
