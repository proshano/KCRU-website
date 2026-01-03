const studySubmission = {
  name: 'studySubmission',
  title: 'Study Submissions',
  type: 'document',
  fields: [
    {
      name: 'title',
      title: 'Study Title',
      type: 'string'
    },
    {
      name: 'action',
      title: 'Action',
      type: 'string',
      options: {
        list: [
          { title: 'Create', value: 'create' },
          { title: 'Update', value: 'update' }
        ],
        layout: 'radio'
      }
    },
    {
      name: 'status',
      title: 'Status',
      type: 'string',
      options: {
        list: [
          { title: 'Pending', value: 'pending' },
          { title: 'Approved', value: 'approved' },
          { title: 'Rejected', value: 'rejected' },
          { title: 'Superseded', value: 'superseded' }
        ],
        layout: 'radio'
      },
      initialValue: 'pending'
    },
    {
      name: 'submittedAt',
      title: 'Submitted At',
      type: 'datetime'
    },
    {
      name: 'submittedBy',
      title: 'Submitted By',
      type: 'object',
      fields: [
        { name: 'email', title: 'Email', type: 'string' },
        { name: 'ip', title: 'IP', type: 'string' },
        { name: 'userAgent', title: 'User Agent', type: 'string' }
      ]
    },
    {
      name: 'reviewedAt',
      title: 'Reviewed At',
      type: 'datetime'
    },
    {
      name: 'reviewedBy',
      title: 'Reviewed By (email)',
      type: 'string'
    },
    {
      name: 'supersededAt',
      title: 'Superseded At',
      type: 'datetime'
    },
    {
      name: 'supersededBy',
      title: 'Superseded By',
      type: 'reference',
      to: [{ type: 'studySubmission' }]
    },
    {
      name: 'studyRef',
      title: 'Existing Study',
      type: 'reference',
      to: [{ type: 'trialSummary' }]
    },
    {
      name: 'payload',
      title: 'Submitted Changes',
      type: 'object',
      fields: [
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
        { name: 'emailTitle', title: 'Short Clinical Title', type: 'string' },
        { name: 'emailEligibilitySummary', title: 'Eligibility Statement', type: 'text', rows: 3 },
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
        { name: 'principalInvestigatorName', title: 'Principal Investigator (Other)', type: 'string' },
        {
          name: 'ctGovData',
          title: 'ClinicalTrials.gov Data',
          type: 'object',
          fields: [
            { name: 'briefTitle', title: 'Brief Title', type: 'string' },
            { name: 'officialTitle', title: 'Official Title', type: 'string' },
            { name: 'acronym', title: 'Acronym', type: 'string' },
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
      action: 'action',
      status: 'status',
      submittedAt: 'submittedAt'
    },
    prepare({ title, action, status, submittedAt }) {
      const actionLabel = action === 'update' ? 'Update' : 'Create'
      const date = submittedAt ? new Date(submittedAt).toLocaleDateString() : 'Unknown date'
      return {
        title: `${actionLabel}: ${title || 'Untitled study'}`,
        subtitle: `${status || 'pending'} - ${date}`
      }
    }
  },
  orderings: [
    {
      title: 'Submitted At (desc)',
      name: 'submittedAtDesc',
      by: [{ field: 'submittedAt', direction: 'desc' }]
    }
  ]
}

export default studySubmission
