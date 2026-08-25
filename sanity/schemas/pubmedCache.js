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
            {
              name: 'attributionAuthors',
              type: 'array',
              title: 'Structured Authors for Attribution',
              readOnly: true,
              of: [
                {
                  type: 'object',
                  fields: [
                    { name: 'given', type: 'string', title: 'Given Name' },
                    { name: 'family', type: 'string', title: 'Family Name' },
                    { name: 'displayName', type: 'string', title: 'Display Name' },
                    { name: 'orcid', type: 'string', title: 'ORCID' },
                    { name: 'affiliations', type: 'array', of: [{ type: 'string' }], title: 'Affiliations' },
                  ],
                },
              ],
            },
            {
              name: 'attributionQueryPaths',
              type: 'array',
              of: [{ type: 'string' }],
              title: 'Attribution Query Paths',
              readOnly: true,
            },
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
            {
              name: 'lastSeenAt',
              type: 'datetime',
              title: 'Last Seen In Discovery',
              description: 'When a refresh last rediscovered this publication upstream',
              readOnly: true,
            },
            {
              name: 'missingRuns',
              type: 'number',
              title: 'Consecutive Missed Runs',
              description: 'Clean refreshes in a row that did not return this publication. Pruned once the threshold is reached; runs with source failures do not count.',
              readOnly: true,
            },
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
      name: 'doiBackfillFailures',
      title: 'DOI Backfill Failures',
      type: 'array',
      description: 'DOIs where every abstract source came back empty. Retried on a weekly interval instead of every refresh; entries disappear once the DOI gains an abstract or leaves the publication set.',
      readOnly: true,
      of: [
        {
          type: 'object',
          fields: [
            { name: 'doi', type: 'string', title: 'DOI' },
            { name: 'lastAttemptedAt', type: 'datetime', title: 'Last Attempted' },
            { name: 'attempts', type: 'number', title: 'Consecutive Failed Attempts' },
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
