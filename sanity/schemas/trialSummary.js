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
 * - Local contact info (always manual)
 * - Site references for filtering
 */

import NctIdInput from '../components/NctIdInput'
import AutoSlugInput from '../components/AutoSlugInput'

export default {
  name: 'trialSummary',
  title: 'Studies',
  type: 'document',
  groups: [
    { name: 'basic', title: 'Basic Info', default: true },
    { name: 'eligibility', title: 'Eligibility' },
    { name: 'localInfo', title: 'Local Info' },
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
      name: 'localContact',
      title: 'Local Study Contact',
      type: 'object',
      group: 'localInfo',
      description: 'Contact person for inquiries at your site(s). This is NOT synced from ClinicalTrials.gov.',
      fields: [
        {
          name: 'name',
          title: 'Contact Name',
          type: 'string',
          description: 'e.g., Mikhaela Moore, RN'
        },
        {
          name: 'role',
          title: 'Role',
          type: 'string',
          description: 'e.g., Study Coordinator, Research Nurse'
        },
        {
          name: 'email',
          title: 'Email',
          type: 'string',
          validation: Rule => Rule.email()
        },
        {
          name: 'phone',
          title: 'Phone',
          type: 'string'
        },
        {
          name: 'displayPublicly',
          title: 'Display contact info publicly?',
          type: 'boolean',
          initialValue: false,
          description: 'If false, contact info is used for inquiry routing only'
        }
      ]
    },
    {
      name: 'recruitmentSites',
      title: 'Recruitment Sites',
      type: 'array',
      group: 'localInfo',
      of: [{ type: 'reference', to: [{ type: 'site' }] }],
      description: 'Which of your sites are recruiting for this study?'
    },
    {
      name: 'principalInvestigator',
      title: 'Principal Investigator',
      type: 'reference',
      group: 'localInfo',
      to: [{ type: 'researcher' }],
      description: 'Local PI (linked to team profile)'
    },
    {
      name: 'sponsorWebsite',
      title: 'Study website (if available)',
      type: 'url',
      group: 'localInfo',
      description: 'Link to the study page (sponsor or registry)'
    },
    {
      name: 'acceptsReferrals',
      title: 'Accepts Referrals',
      type: 'boolean',
      group: 'localInfo',
      initialValue: false,
      description: 'Enable the "Refer a Patient" form on this study page. Requires a coordinator email to be set above.'
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
      area0: 'therapeuticAreas.0.shortLabel',
      area1: 'therapeuticAreas.1.shortLabel',
      area2: 'therapeuticAreas.2.shortLabel',
      area3: 'therapeuticAreas.3.shortLabel'
    },
    prepare({ title, status, nctId, area0, area1, area2, area3 }) {
      const statusEmoji = {
        recruiting: '🟢',
        coming_soon: '🟡',
        active_not_recruiting: '🟣',
        completed: '⚫'
      }
      const areaTags = [area0, area1, area2, area3].filter(Boolean).join(', ')
      return {
        title: `${statusEmoji[status] || '⚪'} ${title}`,
        subtitle: [nctId, areaTags].filter(Boolean).join(' • ')
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
