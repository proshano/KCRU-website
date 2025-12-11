export default {
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
            { name: 'pmid', type: 'string', title: 'PMID' },
            { name: 'title', type: 'string', title: 'Title' },
            { name: 'authors', type: 'array', of: [{ type: 'string' }], title: 'Authors' },
            { name: 'journal', type: 'string', title: 'Journal' },
            { name: 'year', type: 'number', title: 'Year' },
            { name: 'month', type: 'string', title: 'Month' },
            { name: 'abstract', type: 'text', title: 'Abstract' },
            { name: 'doi', type: 'string', title: 'DOI' },
            { name: 'pubmedUrl', type: 'url', title: 'PubMed URL' },
            { name: 'laySummary', type: 'text', title: 'Lay Summary' },
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
