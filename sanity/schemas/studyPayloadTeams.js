/**
 * Study team fields as they travel inside submission payloads and drafts, in the
 * payload shape of lib/studyTeams.js (site and PI as ids). Shared by the
 * studySubmission and studyDraft schemas so the two cannot drift.
 */

const TEAM_STATUS_LIST = [
  { title: 'Enrolling', value: 'enrolling' },
  { title: 'Not yet enrolling', value: 'not_yet_enrolling' },
  { title: 'Closed', value: 'closed' }
]

export const studyTeamPayloadFields = [
  {
    name: 'siteTeams',
    title: 'Study Teams',
    type: 'array',
    of: [
      {
        type: 'object',
        name: 'siteTeamPayload',
        title: 'Study team',
        fields: [
          { name: 'siteId', title: 'Coordinating site id', type: 'string' },
          { name: 'status', title: 'Status', type: 'string', options: { list: TEAM_STATUS_LIST } },
          { name: 'principalInvestigatorId', title: 'Principal Investigator', type: 'string' },
          { name: 'principalInvestigatorName', title: 'Principal Investigator (Other)', type: 'string' },
          {
            name: 'contact',
            title: 'Contact',
            type: 'object',
            fields: [
              { name: 'name', title: 'Name', type: 'string' },
              { name: 'role', title: 'Role', type: 'string' },
              { name: 'email', title: 'Email', type: 'string' },
              { name: 'phone', title: 'Phone', type: 'string' },
              { name: 'displayPublicly', title: 'Display Publicly', type: 'boolean' }
            ]
          },
          { name: 'acceptsReferrals', title: 'Accepts Referrals', type: 'boolean' }
        ],
        preview: {
          select: { siteId: 'siteId', status: 'status', pi: 'principalInvestigatorName' },
          prepare({ siteId, status, pi }) {
            return { title: siteId || 'No site', subtitle: [status, pi].filter(Boolean).join(' • ') }
          }
        }
      }
    ]
  },
  {
    name: 'recruitmentSiteIds',
    title: 'Recruitment location ids',
    type: 'array',
    of: [{ type: 'string' }]
  }
]
