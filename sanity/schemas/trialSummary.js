/**
 * Clinical Trial / Study Schema
 * 
 * Supports two modes:
 * 1. NCT-registered studies: Auto-fetch from ClinicalTrials.gov, manual local info
 * 2. Non-registered studies: Fully manual entry
 * 
 * Key features:
 * - Auto-synced eligibility criteria
 * - LLM-generated clinical summary
 * - Study teams: one per coordinating site, each with its own PI, contact and
 *   referral switch (always manual)
 * - Recruitment locations, separate from the coordinating sites
 *
 * The single principalInvestigator / localContact / acceptsReferrals fields are
 * legacy. `npm run migrate:site-teams` converts them into one team; the app reads
 * teams only through resolveStudyTeams() in lib/studyTeams.js, which still
 * understands the old fields on records the migration has not reached.
 */

import NctIdInput from '../components/NctIdInput'
import AutoSlugInput from '../components/AutoSlugInput'

const hasSiteTeams = ({ document }) => Array.isArray(document?.siteTeams) && document.siteTeams.length > 0

const trialSummary = {
  name: 'trialSummary',
  title: 'Studies',
  type: 'document',
  groups: [
    { name: 'basic', title: 'Basic Info', default: true },
    { name: 'eligibility', title: 'Eligibility' },
    { name: 'localInfo', title: 'Local Info' },
    { name: 'email', title: 'Clinical Communications' },
    { name: 'syncedData', title: 'ClinicalTrials.gov Data' },
  ],
  fields: [
    // ============================================
    // BASIC INFO (Manual + Key Fields)
    // ============================================
    {
      name: 'nctId',
      title: 'NCT ID',
      type: 'string',
      group: 'basic',
      components: {
        input: NctIdInput
      },
      validation: Rule => [
        Rule.regex(/^NCT\d{8}$/i, {
          name: 'NCT format',
          invert: false
        }).warning('Enter a valid NCT ID (e.g., NCT12345678) to auto-fetch study data'),
        // Check for duplicate NCT IDs
        Rule.custom(async (nctId, context) => {
          if (!nctId) return true
          
          const { document, getClient } = context
          const client = getClient({ apiVersion: '2024-01-01' })
          
          // Query for other documents with the same NCT ID
          const duplicates = await client.fetch(
            `*[_type == "trialSummary" && nctId == $nctId && _id != $currentId && !(_id in path("drafts.**"))] { _id, title }`,
            { 
              nctId: nctId.toUpperCase(), 
              currentId: document._id.replace('drafts.', '') 
            }
          )
          
          if (duplicates.length > 0) {
            return `This NCT ID is already used by: "${duplicates[0].title}"`
          }
          
          return true
        })
      ],
      description: 'Enter the NCT ID and click "Fetch Details" to auto-populate study information.'
    },
    {
      name: 'title',
      title: 'Display Title',
      type: 'string',
      group: 'basic',
      description: 'Study title shown on website. Can override the official title.',
      validation: Rule => Rule.required()
    },
    {
      name: 'slug',
      title: 'URL Slug',
      type: 'slug',
      group: 'basic',
      options: { source: 'title' },
      components: { input: AutoSlugInput },
      validation: Rule => Rule.required(),
      description: 'Auto-generated from title'
    },
    {
      name: 'status',
      title: 'Recruitment Status',
      type: 'string',
      group: 'basic',
      options: {
        list: [
          { title: '🟢 Recruiting', value: 'recruiting' },
          { title: '🟡 Coming Soon', value: 'coming_soon' },
          { title: '🟣 Active, Not Recruiting', value: 'active_not_recruiting' },
          { title: '⚫ Completed', value: 'completed' }
        ],
        layout: 'radio'
      },
      description: 'Local recruitment status (may differ from ClinicalTrials.gov for multi-site studies)'
    },
    {
      name: 'studyType',
      title: 'Study Type',
      type: 'string',
      group: 'basic',
      options: {
        list: [
          { title: 'Interventional', value: 'interventional' },
          { title: 'Observational', value: 'observational' }
        ]
      }
    },
    {
      name: 'phase',
      title: 'Phase',
      type: 'string',
      group: 'basic',
      options: {
        list: [
          { title: 'Phase 1', value: 'phase1' },
          { title: 'Phase 1/2', value: 'phase1_2' },
          { title: 'Phase 2', value: 'phase2' },
          { title: 'Phase 2/3', value: 'phase2_3' },
          { title: 'Phase 3', value: 'phase3' },
          { title: 'Phase 4', value: 'phase4' },
          { title: 'N/A', value: 'na' }
        ]
      }
    },
    {
      name: 'therapeuticAreas',
      title: 'Therapeutic Areas',
      type: 'array',
      group: 'basic',
      of: [{ type: 'reference', to: [{ type: 'therapeuticArea' }] }],
      options: {
        filter: 'active == true'
      },
      description: 'Used for filtering and sending targeted emails to relevant clinicians. Select all that apply.'
    },
    {
      name: 'laySummary',
      title: 'Clinical Summary',
      type: 'text',
      group: 'basic',
      rows: 4,
      description: 'AI-generated or manually written summary for clinicians. 3-5 sentences.'
    },
    {
      name: 'featured',
      title: 'Featured on homepage?',
      type: 'boolean',
      group: 'basic',
      initialValue: false
    },

    // ============================================
    // LOCAL INFO (Always Manual)
    // ============================================
    {
      name: 'siteTeams',
      title: 'Study Teams',
      type: 'array',
      group: 'localInfo',
      description:
        'One team for each site that coordinates this study (its PI, coordinator contact and whether that team takes referrals). Most studies have one team; a study run from both Victoria Hospital and University Hospital has two.',
      of: [
        {
          type: 'object',
          name: 'siteTeam',
          title: 'Study team',
          fields: [
            {
              name: 'site',
              title: 'Coordinating site',
              type: 'reference',
              to: [{ type: 'site' }],
              options: { filter: 'coordinatesStudies == true && active == true' },
              // A warning rather than an error while migrated studies still need a site,
              // so an unrelated Studio edit is not blocked. Becomes required once the
              // legacy fields are removed.
              validation: Rule => Rule.required().warning('Choose the coordinating site for this team.')
            },
            {
              name: 'status',
              title: 'Team status',
              type: 'string',
              options: {
                list: [
                  { title: 'Enrolling', value: 'enrolling' },
                  { title: 'Not yet enrolling (site still in startup)', value: 'not_yet_enrolling' },
                  { title: 'Closed', value: 'closed' }
                ],
                layout: 'radio'
              },
              initialValue: 'enrolling',
              description: 'Each site starts up on its own, so one team can be enrolling while the other is not yet open.'
            },
            {
              name: 'principalInvestigator',
              title: 'Principal Investigator',
              type: 'reference',
              to: [{ type: 'researcher' }],
              description: 'The PI at this site (linked to a team profile).'
            },
            {
              name: 'principalInvestigatorName',
              title: 'Principal Investigator (Other)',
              type: 'string',
              description: 'Use when the PI is not in the team roster.',
              validation: Rule =>
                Rule.custom((value, context) => {
                  if (value || context?.parent?.principalInvestigator) return true
                  return 'Choose a principal investigator or enter a name.'
                }).warning()
            },
            {
              name: 'contact',
              title: 'Team contact',
              type: 'object',
              description: 'The coordinator who answers inquiries and referrals for this team.',
              fields: [
                { name: 'name', title: 'Contact Name', type: 'string', description: 'e.g., Mikhaela Moore, RN' },
                { name: 'role', title: 'Role', type: 'string', description: 'e.g., Study Coordinator, Research Nurse' },
                { name: 'email', title: 'Email', type: 'string', validation: Rule => Rule.email() },
                { name: 'phone', title: 'Phone', type: 'string' },
                {
                  name: 'displayPublicly',
                  title: 'Display contact info publicly?',
                  type: 'boolean',
                  initialValue: false,
                  description: 'If false, the contact is used for referral routing only.'
                }
              ]
            },
            {
              name: 'acceptsReferrals',
              title: 'Accepts Referrals',
              type: 'boolean',
              initialValue: false,
              description: 'Offer the "Refer a patient" form for this team. Requires a contact email.'
            }
          ],
          preview: {
            select: {
              site: 'site.name',
              status: 'status',
              pi: 'principalInvestigator.name',
              piOther: 'principalInvestigatorName'
            },
            prepare({ site, status, pi, piOther }) {
              return {
                title: site || 'No coordinating site',
                subtitle: [pi || piOther, status].filter(Boolean).join(' • ')
              }
            }
          }
        }
      ],
      validation: Rule => [
        Rule.min(1).warning('Add at least one study team.'),
        Rule.custom((teams = []) => {
          const siteIds = (teams || []).map((team) => team?.site?._ref).filter(Boolean)
          return new Set(siteIds).size === siteIds.length ? true : 'Each site can have only one team.'
        })
      ]
    },
    {
      name: 'recruitmentSites',
      title: 'Recruitment Locations',
      type: 'array',
      group: 'localInfo',
      of: [{ type: 'reference', to: [{ type: 'site' }] }],
      options: { filter: 'recruitsPatients == true && active == true' },
      description: 'Where patients can be seen and enrolled for this study. Separate from the coordinating sites above.'
    },

    // Legacy single PI and contact. Hidden once a study has teams; removed by
    // `npm run migrate:site-teams -- --apply --remove-legacy`.
    {
      name: 'localContact',
      title: 'Local Study Contact (legacy)',
      type: 'object',
      group: 'localInfo',
      hidden: hasSiteTeams,
      description: 'Replaced by the contact on each study team.',
      fields: [
        { name: 'name', title: 'Contact Name', type: 'string' },
        { name: 'role', title: 'Role', type: 'string' },
        { name: 'email', title: 'Email', type: 'string', validation: Rule => Rule.email() },
        { name: 'phone', title: 'Phone', type: 'string' },
        { name: 'displayPublicly', title: 'Display contact info publicly?', type: 'boolean', initialValue: false }
      ]
    },
    {
      name: 'principalInvestigator',
      title: 'Principal Investigator (legacy)',
      type: 'reference',
      group: 'localInfo',
      hidden: hasSiteTeams,
      to: [{ type: 'researcher' }],
      description: 'Replaced by the PI on each study team.'
    },
    {
      name: 'principalInvestigatorName',
      title: 'Principal Investigator (Other, legacy)',
      type: 'string',
      group: 'localInfo',
      hidden: hasSiteTeams,
      description: 'Replaced by the PI on each study team.'
    },
    {
      name: 'acceptsReferrals',
      title: 'Accepts Referrals (legacy)',
      type: 'boolean',
      group: 'localInfo',
      hidden: hasSiteTeams,
      description: 'Replaced by the referral switch on each study team.'
    },
    {
      name: 'sponsorWebsite',
      title: 'Study website (if available)',
      type: 'url',
      group: 'localInfo',
      description: 'Link to the study page (sponsor or registry)'
    },
    {
      name: 'emailTitle',
      title: 'Short clinical title',
      type: 'string',
      group: 'email',
      description:
        'Short title for clinical communications (emails, outreach, referral requests). Example: "SGLT2 inhibitor in CKD trial". Not shown on the public site.'
    },
    {
      name: 'emailEligibilitySummary',
      title: 'Eligibility statement',
      type: 'text',
      group: 'email',
      rows: 3,
      description:
        'Short inclusion-only statement for clinical communications and referral outreach. Keep it simple and focus on major inclusion criteria; the coordinator will confirm full eligibility.'
    },
    {
      name: 'seo',
      title: 'SEO (auto)',
      type: 'object',
      hidden: true,
      fields: [
        { name: 'description', title: 'Meta Description', type: 'text', rows: 2, readOnly: true },
        { name: 'generatedAt', title: 'Generated At', type: 'datetime', readOnly: true },
        { name: 'source', title: 'Source', type: 'string', readOnly: true }
      ]
    },

    // ============================================
    // ELIGIBILITY (Synced + Manual Override)
    // ============================================
    {
      name: 'inclusionCriteria',
      title: 'Inclusion Criteria',
      type: 'array',
      group: 'eligibility',
      of: [{ type: 'string' }],
      description: 'Key inclusion criteria (fetched from ClinicalTrials.gov or entered manually)'
    },
    {
      name: 'exclusionCriteria',
      title: 'Exclusion Criteria',
      type: 'array',
      group: 'eligibility',
      of: [{ type: 'string' }],
      description: 'Key exclusion criteria (fetched from ClinicalTrials.gov or entered manually)'
    },
    // ============================================
    // SYNCED DATA FROM CLINICALTRIALS.GOV
    // ============================================
    {
      name: 'ctGovData',
      title: 'ClinicalTrials.gov Data',
      type: 'object',
      group: 'syncedData',
      description: 'Auto-fetched data. Do not edit manually - use "Sync from ClinicalTrials.gov" action.',
      options: { collapsible: true, collapsed: true },
      fields: [
        { name: 'briefTitle', title: 'Brief Title', type: 'string', readOnly: true },
        { name: 'officialTitle', title: 'Official Title', type: 'string', readOnly: true },
        { name: 'acronym', title: 'Acronym', type: 'string', readOnly: true },
        { name: 'briefSummary', title: 'Brief Summary', type: 'text', readOnly: true },
        { name: 'detailedDescription', title: 'Detailed Description', type: 'text', readOnly: true },
        { name: 'overallStatus', title: 'Overall Status', type: 'string', readOnly: true },
        { name: 'phase', title: 'Phase', type: 'string', readOnly: true },
        { name: 'studyType', title: 'Study Type', type: 'string', readOnly: true },
        { name: 'sponsor', title: 'Sponsor', type: 'string', readOnly: true },
        { name: 'enrollmentCount', title: 'Enrollment', type: 'number', readOnly: true },
        { name: 'startDate', title: 'Start Date', type: 'string', readOnly: true },
        { name: 'completionDate', title: 'Completion Date', type: 'string', readOnly: true },
        { name: 'interventions', title: 'Interventions', type: 'array', of: [{ type: 'string' }], readOnly: true },
        { name: 'eligibilityCriteriaRaw', title: 'Raw Eligibility Text', type: 'text', readOnly: true },
        { name: 'lastSyncedAt', title: 'Last Synced', type: 'datetime', readOnly: true },
        { name: 'url', title: 'ClinicalTrials.gov URL', type: 'url', readOnly: true }
      ]
    },

  ],

  preview: {
    select: {
      title: 'title',
      status: 'status',
      nctId: 'nctId',
      team0: 'siteTeams.0.site.shortName',
      team1: 'siteTeams.1.site.shortName',
      area0: 'therapeuticAreas.0.shortLabel',
      area1: 'therapeuticAreas.1.shortLabel',
      area2: 'therapeuticAreas.2.shortLabel',
      area3: 'therapeuticAreas.3.shortLabel'
    },
    prepare({ title, status, nctId, team0, team1, area0, area1, area2, area3 }) {
      const statusEmoji = {
        recruiting: '🟢',
        coming_soon: '🟡',
        active_not_recruiting: '🟣',
        completed: '⚫'
      }
      const teamTags = [team0, team1].filter(Boolean).join(', ')
      const areaTags = [area0, area1, area2, area3].filter(Boolean).join(', ')
      return {
        title: `${statusEmoji[status] || '⚪'} ${title}`,
        subtitle: [nctId, teamTags, areaTags].filter(Boolean).join(' • ')
      }
    }
  },

  orderings: [
    {
      title: 'Status, then Title',
      name: 'statusTitle',
      by: [
        { field: 'status', direction: 'asc' },
        { field: 'title', direction: 'asc' }
      ]
    },
    {
      title: 'Recently Updated',
      name: 'updatedDesc',
      by: [{ field: '_updatedAt', direction: 'desc' }]
    }
  ]
}

export default trialSummary
