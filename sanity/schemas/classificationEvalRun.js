const AXIS_FIELDS = ['topics', 'studyDesign', 'methodologicalFocus']

const tagArray = (name, title) => ({
  name,
  title,
  type: 'array',
  of: [{ type: 'string' }],
  readOnly: true,
})

const classificationEvalRun = {
  name: 'classificationEvalRun',
  title: 'Classification Evaluation Runs',
  type: 'document',
  description:
    'A sample of publications classified by the Jev decision model, stored beside the classification the site already holds so the two can be compared at /admin/classification-eval.',
  fields: [
    { name: 'label', title: 'Label', type: 'string' },
    { name: 'runAt', title: 'Run At', type: 'datetime', readOnly: true },
    {
      name: 'status',
      title: 'Status',
      type: 'string',
      readOnly: true,
      options: {
        list: [
          { title: 'ok', value: 'ok' },
          { title: 'partial (some papers failed)', value: 'partial' },
        ],
      },
    },
    { name: 'transport', title: 'Transport', type: 'string', readOnly: true },
    { name: 'model', title: 'Model', type: 'string', readOnly: true },
    { name: 'endpoint', title: 'Endpoint', type: 'url', readOnly: true },
    { name: 'requestedBy', title: 'Requested By', type: 'string', readOnly: true },
    {
      name: 'thresholds',
      title: 'Thresholds Used',
      type: 'object',
      readOnly: true,
      fields: [
        { name: 'topics', title: 'Topics', type: 'number' },
        { name: 'studyDesign', title: 'Study Design', type: 'number' },
        { name: 'methodologicalFocus', title: 'Methodological Focus', type: 'number' },
        { name: 'exclude', title: 'Exclude', type: 'number' },
      ],
    },
    {
      name: 'sample',
      title: 'Sample',
      type: 'object',
      readOnly: true,
      fields: [
        { name: 'requestedCount', title: 'Requested Count', type: 'number' },
        { name: 'seed', title: 'Seed', type: 'number' },
        { name: 'eligibleCount', title: 'Eligible Publications', type: 'number' },
        { name: 'totalPublications', title: 'Total Cached Publications', type: 'number' },
        { name: 'year', title: 'Year Filter', type: 'string' },
        { name: 'pmids', title: 'PMIDs', type: 'array', of: [{ type: 'string' }] },
      ],
    },
    {
      name: 'summary',
      title: 'Summary (at run thresholds)',
      type: 'object',
      readOnly: true,
      fields: [
        { name: 'papers', title: 'Papers', type: 'number' },
        { name: 'scored', title: 'Scored', type: 'number' },
        { name: 'errors', title: 'Errors', type: 'number' },
        { name: 'allExact', title: 'All Axes Exact', type: 'number' },
        { name: 'allExactRate', title: 'All Axes Exact Rate', type: 'number' },
        { name: 'meanLatencyMs', title: 'Mean Latency (ms)', type: 'number' },
        { name: 'inputTokens', title: 'Input Tokens', type: 'number' },
        { name: 'outputTokens', title: 'Output Tokens', type: 'number' },
        { name: 'estimatedUsd', title: 'Estimated Cost (USD)', type: 'number' },
        {
          name: 'axes',
          title: 'Per Axis',
          type: 'array',
          of: [
            {
              type: 'object',
              fields: [
                { name: 'key', title: 'Axis', type: 'string' },
                { name: 'label', title: 'Label', type: 'string' },
                { name: 'exactMatchRate', title: 'Exact Match Rate', type: 'number' },
                { name: 'precision', title: 'Precision', type: 'number' },
                { name: 'recall', title: 'Recall', type: 'number' },
                { name: 'f1', title: 'F1', type: 'number' },
              ],
            },
          ],
        },
      ],
    },
    {
      name: 'papers',
      title: 'Papers',
      type: 'array',
      readOnly: true,
      of: [
        {
          type: 'object',
          fields: [
            { name: 'pmid', title: 'PMID', type: 'string' },
            { name: 'title', title: 'Title', type: 'string' },
            { name: 'year', title: 'Year', type: 'number' },
            { name: 'journal', title: 'Journal', type: 'string' },
            { name: 'url', title: 'URL', type: 'url' },
            { name: 'abstractLength', title: 'Abstract Length', type: 'number' },
            { name: 'abstractTruncated', title: 'Abstract Truncated', type: 'boolean' },
            { name: 'abstractPreview', title: 'Abstract Preview', type: 'text', rows: 4 },
            { name: 'publicationTypeExcluded', title: 'Excluded by Publication Type', type: 'boolean' },
            {
              name: 'baseline',
              title: 'Stored Classification',
              type: 'object',
              fields: [
                { name: 'source', title: 'Source', type: 'string' },
                { name: 'provider', title: 'Provider', type: 'string' },
                { name: 'model', title: 'Model', type: 'string' },
                { name: 'runAt', title: 'Classified At', type: 'datetime' },
                ...AXIS_FIELDS.map((axis) => tagArray(axis, axis)),
                { name: 'exclude', title: 'Exclude', type: 'boolean' },
              ],
            },
            {
              name: 'jev',
              title: 'Jev Classification',
              type: 'object',
              fields: [
                ...AXIS_FIELDS.map((axis) => tagArray(axis, axis)),
                { name: 'exclude', title: 'Exclude', type: 'boolean' },
                { name: 'model', title: 'Model', type: 'string' },
                { name: 'latencyMs', title: 'Latency (ms)', type: 'number' },
                { name: 'inputTokens', title: 'Input Tokens', type: 'number' },
                { name: 'outputTokens', title: 'Output Tokens', type: 'number' },
                { name: 'error', title: 'Error', type: 'text', rows: 2 },
                {
                  name: 'probabilities',
                  title: 'Per-tag Probabilities',
                  type: 'array',
                  of: [
                    {
                      type: 'object',
                      fields: [
                        { name: 'axis', title: 'Axis', type: 'string' },
                        { name: 'tag', title: 'Tag', type: 'string' },
                        { name: 'p', title: 'Probability', type: 'number' },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
          preview: {
            select: { title: 'title', pmid: 'pmid', error: 'jev.error' },
            prepare({ title, pmid, error }) {
              return { title: title || `PMID ${pmid}`, subtitle: error ? `Error: ${error}` : `PMID ${pmid}` }
            },
          },
        },
      ],
    },
  ],
  orderings: [
    { title: 'Newest first', name: 'runAtDesc', by: [{ field: 'runAt', direction: 'desc' }] },
  ],
  preview: {
    select: { label: 'label', runAt: 'runAt', model: 'model', papers: 'summary.papers', rate: 'summary.allExactRate' },
    prepare({ label, runAt, model, papers, rate }) {
      const date = runAt ? new Date(runAt).toLocaleString() : ''
      const agreement = Number.isFinite(rate) ? `${Math.round(rate * 100)}% exact` : ''
      return {
        title: label || `Evaluation ${date}`,
        subtitle: [model, papers ? `${papers} papers` : '', agreement, date].filter(Boolean).join(' • '),
      }
    },
  },
}

export default classificationEvalRun
