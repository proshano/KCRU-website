export default {
  name: 'studyDraft',
  title: 'Study Drafts',
  type: 'document',
  fields: [
    {
      name: 'email',
      title: 'Coordinator Email',
      type: 'string'
    },
    {
      name: 'savedAt',
      title: 'Saved At',
      type: 'datetime'
    },
    {
      name: 'title',
      title: 'Study Title',
      type: 'string'
    },
    {
      name: 'data',
      title: 'Draft Data',
      type: 'object',
      fields: [
        { name: 'id', title: 'Study ID', type: 'string' },
        { name: 'title', title: 'Title', type: 'string' },
        { name: 'slug', title: 'Slug', type: 'string' },
        { name: 'nctId', title: 'NCT ID', type: 'string' },
        {
          name: 'status',
          title: 'Recruitment Status',
          type: 'string',
          options: {
            list: [
              { title: 'Recruiting', value: 'recruiting' },
              { title: 'Coming Soon', value: 'coming_soon' },
              { title: 'Active, Not Recruiting', value: 'active_not_recruiting' },
              { title: 'Completed', value: 'completed' }
            ]
          }
        },
        { name: 'studyType', title: 'Study Type', type: 'string' },
        { name: 'phase', title: 'Phase', type: 'string' },
        { name: 'therapeuticAreaIds', title: 'Therapeutic Areas', type: 'array', of: [{ type: 'string' }] },
        { name: 'laySummary', title: 'Clinical Summary', type: 'text', rows: 4 },
        { name: 'inclusionCriteria', title: 'Inclusion Criteria', type: 'array', of: [{ type: 'string' }] },
        { name: 'exclusionCriteria', title: 'Exclusion Criteria', type: 'array', of: [{ type: 'string' }] },
        { name: 'sponsorWebsite', title: 'Study website (if available)', type: 'url' },
        { name: 'acceptsReferrals', title: 'Accepts Referrals', type: 'boolean' },
        { name: 'featured', title: 'Featured', type: 'boolean' },
        {
          name: 'localContact',
          title: 'Local Contact',
          type: 'object',
          fields: [
            { name: 'name', title: 'Name', type: 'string' },
            { name: 'role', title: 'Role', type: 'string' },
            { name: 'email', title: 'Email', type: 'string' },
            { name: 'phone', title: 'Phone', type: 'string' },
            { name: 'displayPublicly', title: 'Display Publicly', type: 'boolean' }
          ]
        },
        { name: 'principalInvestigatorId', title: 'Principal Investigator', type: 'string' },
        {
          name: 'ctGovData',
          title: 'ClinicalTrials.gov Data',
          type: 'object',
          fields: [
            { name: 'briefTitle', title: 'Brief Title', type: 'string' },
            { name: 'officialTitle', title: 'Official Title', type: 'string' },
            { name: 'briefSummary', title: 'Brief Summary', type: 'text' },
            { name: 'detailedDescription', title: 'Detailed Description', type: 'text' },
            { name: 'overallStatus', title: 'Overall Status', type: 'string' },
            { name: 'phase', title: 'Phase', type: 'string' },
            { name: 'studyType', title: 'Study Type', type: 'string' },
            { name: 'sponsor', title: 'Sponsor', type: 'string' },
            { name: 'enrollmentCount', title: 'Enrollment Count', type: 'number' },
            { name: 'startDate', title: 'Start Date', type: 'string' },
            { name: 'completionDate', title: 'Completion Date', type: 'string' },
            { name: 'interventions', title: 'Interventions', type: 'array', of: [{ type: 'string' }] },
            { name: 'eligibilityCriteriaRaw', title: 'Eligibility Criteria', type: 'text' },
            { name: 'lastSyncedAt', title: 'Last Synced', type: 'datetime' },
            { name: 'url', title: 'ClinicalTrials.gov URL', type: 'url' }
          ]
        }
      ]
    }
  ],
  preview: {
    select: {
      title: 'title',
      email: 'email',
      savedAt: 'savedAt'
    },
    prepare({ title, email, savedAt }) {
      const date = savedAt ? new Date(savedAt).toLocaleString() : 'Unknown date'
      return {
        title: title || 'Untitled draft',
        subtitle: `${email || 'Unknown coordinator'} - saved ${date}`
      }
    }
  },
  orderings: [
    {
      title: 'Saved At (desc)',
      name: 'savedAtDesc',
      by: [{ field: 'savedAt', direction: 'desc' }]
    }
  ]
}
