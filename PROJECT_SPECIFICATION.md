# Research Unit Website - Complete Project Specification

## Executive Summary

Build a modern web application for an independent academic clinical research unit specializing in nephrology. The unit operates across multiple hospital sites and a university but is positioned as its own entity, not a department of any institution. The site serves patients seeking clinical trials, referring physicians, prospective trainees, pharmaceutical sponsors, CROs, and funders.

## Technical Stack

| Layer | Technology | Rationale |
|-------|------------|-----------|
| Framework | Next.js 14+ (App Router) | React-based, serverless functions, ISR, Vercel-native |
| CMS | Sanity | Headless CMS with excellent editing UX for non-technical staff |
| Hosting | Vercel | Seamless Next.js deployment, cron jobs, edge functions |
| Styling | Tailwind CSS | Utility-first, consistent design system |
| Email | Resend (or SendGrid) | Transactional email for inquiry forms |

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         VERCEL                                   │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │                    Next.js App                           │    │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐   │    │
│  │  │ Public Pages │  │  API Routes  │  │  Cron Jobs   │   │    │
│  │  │              │  │              │  │  (daily)     │   │    │
│  │  │ - Home       │  │ - /api/      │  │              │   │    │
│  │  │ - Studies    │  │   inquiry    │  │ - Refresh    │   │    │
│  │  │ - Team       │  │ - /api/      │  │   pubs       │   │    │
│  │  │ - Pubs       │  │   publications│ │ - Refresh    │   │    │
│  │  │ - Sponsors   │  │ - /api/      │  │   trials     │   │    │
│  │  │ - Referrals  │  │   trials     │  │ - Refresh    │   │    │
│  │  │ - Training   │  │ - /api/      │  │   metrics    │   │    │
│  │  │              │  │   metrics    │  │              │   │    │
│  │  └──────────────┘  └──────────────┘  └──────────────┘   │    │
│  └─────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
          │                    │                    │
          ▼                    ▼                    ▼
    ┌──────────┐        ┌──────────────┐    ┌─────────────┐
    │  Sanity  │        │ External APIs │    │   Resend    │
    │  (CMS)   │        │              │    │  (Email)    │
    │          │        │ - PubMed     │    │             │
    │ Content: │        │ - OpenAlex   │    │ Study       │
    │ - Trials │        │ - ClinTrials │    │ inquiries   │
    │ - Team   │        │   .gov       │    │             │
    │ - News   │        │              │    │             │
    │ - Sites  │        │              │    │             │
    │ - etc.   │        │              │    │             │
    └──────────┘        └──────────────┘    └─────────────┘
```

## Project Structure

```
/research-unit-site
├── app/
│   ├── layout.js                    # Root layout with header/footer
│   ├── page.js                      # Homepage
│   ├── globals.css                  # Tailwind imports + custom styles
│   │
│   ├── studies/
│   │   ├── page.js                  # List of recruiting studies (patient-facing)
│   │   └── [slug]/
│   │       └── page.js              # Individual study detail + inquiry form
│   │
│   ├── team/
│   │   ├── page.js                  # Team listing
│   │   └── [slug]/
│   │       └── page.js              # Individual researcher profile
│   │
│   ├── publications/
│   │   └── page.js                  # Publications with citations
│   │
│   ├── for-sponsors/
│   │   └── page.js                  # Capabilities, track record, network
│   │
│   ├── for-physicians/
│   │   └── page.js                  # Referral information
│   │
│   ├── training/
│   │   ├── page.js                  # Opportunities + alumni
│   │   └── [slug]/
│   │       └── page.js              # Individual opportunity detail
│   │
│   ├── news/
│   │   ├── page.js                  # News listing
│   │   └── [slug]/
│   │       └── page.js              # Individual news post
│   │
│   └── api/
│       ├── inquiry/
│       │   └── route.js             # POST: study inquiry form handler
│       ├── publications/
│       │   └── route.js             # GET: cached PubMed + OpenAlex data
│       ├── trials/
│       │   └── route.js             # GET: cached ClinicalTrials.gov data
│       └── metrics/
│           └── route.js             # GET: cached researcher metrics
│
├── components/
│   ├── layout/
│   │   ├── Header.js
│   │   ├── Footer.js
│   │   └── Navigation.js
│   ├── ui/
│   │   ├── Button.js
│   │   ├── Card.js
│   │   ├── Badge.js
│   │   └── Form.js
│   ├── StudyCard.js
│   ├── StudyInquiryForm.js
│   ├── TeamCard.js
│   ├── PublicationItem.js           # Includes lay summary + share buttons
│   ├── ShareButtons.js              # X, Bluesky, LinkedIn share buttons
│   ├── SiteCard.js
│   ├── OpportunityCard.js
│   └── AlumnusCard.js
│
├── lib/
│   ├── sanity.js                    # Sanity client + all queries
│   ├── pubmed.js                    # PubMed E-utilities integration
│   ├── openalex.js                  # OpenAlex API integration
│   ├── clinicaltrials.js            # ClinicalTrials.gov API
│   ├── publications.js              # Combined PubMed + OpenAlex
│   ├── summaries.js                 # AI lay summary generation (multi-provider)
│   └── sharing.js                   # Social media share URLs
│
├── sanity/
│   ├── sanity.config.js
│   └── schemas/
│       ├── index.js
│       ├── siteSettings.js
│       ├── capabilities.js
│       ├── referralInfo.js
│       ├── researcher.js
│       ├── newsPost.js
│       ├── trialSummary.js
│       ├── traineeOpportunity.js
│       ├── alumnus.js
│       └── site.js
│
├── public/
│   └── (static assets)
│
├── vercel.json                      # Cron job configuration
├── tailwind.config.js
├── next.config.js
├── package.json
└── .env.local                       # Environment variables (not committed)
```

---

## Sanity Schemas (Complete Definitions)

### 1. siteSettings.js (Singleton)
Global site configuration.

```javascript
export default {
  name: 'siteSettings',
  title: 'Site Settings',
  type: 'document',
  __experimental_actions: ['update', 'publish'],
  fields: [
    {
      name: 'unitName',
      title: 'Research Unit Name',
      type: 'string',
      validation: Rule => Rule.required()
    },
    {
      name: 'tagline',
      title: 'Tagline',
      type: 'string'
    },
    {
      name: 'description',
      title: 'About / Description',
      type: 'text',
      rows: 4
    },
    {
      name: 'logo',
      title: 'Logo',
      type: 'image'
    },
    {
      name: 'contactEmail',
      title: 'Contact Email',
      type: 'string'
    },
    {
      name: 'phone',
      title: 'Phone',
      type: 'string'
    },
    {
      name: 'address',
      title: 'Address',
      type: 'text',
      rows: 3
    },
    {
      name: 'socialLinks',
      title: 'Social Media Links',
      type: 'object',
      fields: [
        { name: 'twitter', title: 'Twitter/X', type: 'url' },
        { name: 'linkedin', title: 'LinkedIn', type: 'url' },
        { name: 'github', title: 'GitHub', type: 'url' },
        { name: 'youtube', title: 'YouTube', type: 'url' }
      ]
    },
    {
      name: 'pubmedAffiliation',
      title: 'PubMed Affiliation Search Term',
      type: 'string',
      description: 'Used for fetching unit publications'
    }
  ]
}
```

### 2. researcher.js
Team member profiles.

```javascript
export default {
  name: 'researcher',
  title: 'Researcher',
  type: 'document',
  fields: [
    {
      name: 'name',
      title: 'Full Name',
      type: 'string',
      validation: Rule => Rule.required()
    },
    {
      name: 'slug',
      title: 'Slug',
      type: 'slug',
      options: { source: 'name' },
      validation: Rule => Rule.required()
    },
    {
      name: 'role',
      title: 'Role/Title',
      type: 'string',
      description: 'e.g., Principal Investigator, Research Associate, PhD Student'
    },
    {
      name: 'photo',
      title: 'Photo',
      type: 'image',
      options: { hotspot: true }
    },
    {
      name: 'email',
      title: 'Email',
      type: 'string'
    },
    {
      name: 'bio',
      title: 'Biography',
      type: 'text',
      rows: 4
    },
    {
      name: 'pubmedQuery',
      title: 'PubMed Search Query',
      type: 'string',
      description: 'e.g., "Smith J[Author] AND Western University[Affiliation]"'
    },
    {
      name: 'orcid',
      title: 'ORCID',
      type: 'string'
    },
    {
      name: 'twitter',
      title: 'Twitter/X Handle',
      type: 'string'
    },
    {
      name: 'linkedin',
      title: 'LinkedIn URL',
      type: 'url'
    },
    {
      name: 'order',
      title: 'Display Order',
      type: 'number',
      description: 'Lower numbers appear first'
    }
  ],
  orderings: [
    {
      title: 'Display Order',
      name: 'orderAsc',
      by: [{ field: 'order', direction: 'asc' }]
    }
  ]
}
```

### 3. trialSummary.js
Patient-facing study descriptions with inquiry routing.

```javascript
export default {
  name: 'trialSummary',
  title: 'Trial Summary (Patient-Facing)',
  type: 'document',
  fields: [
    {
      name: 'nctId',
      title: 'NCT ID',
      type: 'string',
      validation: Rule => Rule.regex(/^NCT\d{8}$/, {
        name: 'NCT format',
        invert: false
      }),
      description: 'e.g., NCT12345678 (optional for non-registered studies)'
    },
    {
      name: 'title',
      title: 'Patient-Friendly Title',
      type: 'string',
      description: 'Plain language title (not the official title)',
      validation: Rule => Rule.required()
    },
    {
      name: 'slug',
      title: 'Slug',
      type: 'slug',
      options: { source: 'title' },
      validation: Rule => Rule.required()
    },
    {
      name: 'status',
      title: 'Recruitment Status',
      type: 'string',
      options: {
        list: [
          { title: 'Recruiting', value: 'recruiting' },
          { title: 'Coming Soon', value: 'coming_soon' },
          { title: 'Closed', value: 'closed' }
        ]
      }
    },
    {
      name: 'coordinatorEmail',
      title: 'Coordinator Email',
      type: 'string',
      validation: Rule => Rule.required().email(),
      description: 'Inquiries will be sent here. Not displayed publicly.'
    },
    {
      name: 'condition',
      title: 'Condition Being Studied',
      type: 'string',
      description: 'In plain language, e.g., "Kidney disease requiring dialysis"'
    },
    {
      name: 'purpose',
      title: 'What is this study about?',
      type: 'text',
      rows: 4,
      description: 'Explain in simple terms what the study is testing'
    },
    {
      name: 'whoCanJoin',
      title: 'Who can join?',
      type: 'array',
      of: [{ type: 'string' }],
      description: 'Plain-language eligibility criteria'
    },
    {
      name: 'whoCannotJoin',
      title: 'Who cannot join?',
      type: 'array',
      of: [{ type: 'string' }],
      description: 'Key exclusion criteria in plain language'
    },
    {
      name: 'whatToExpect',
      title: 'What to expect',
      type: 'text',
      rows: 4,
      description: 'What participation involves (visits, procedures, time commitment)'
    },
    {
      name: 'duration',
      title: 'How long does participation last?',
      type: 'string'
    },
    {
      name: 'compensation',
      title: 'Compensation/Reimbursement',
      type: 'string',
      description: 'e.g., "Parking costs covered" or "Honorarium provided"'
    },
    {
      name: 'principalInvestigator',
      title: 'Principal Investigator',
      type: 'reference',
      to: [{ type: 'researcher' }]
    },
    {
      name: 'featured',
      title: 'Featured on homepage?',
      type: 'boolean',
      initialValue: false
    }
  ],
  preview: {
    select: {
      title: 'title',
      status: 'status',
      nctId: 'nctId'
    },
    prepare({ title, status, nctId }) {
      const statusEmoji = {
        recruiting: '🟢',
        coming_soon: '🟡',
        closed: '⚫'
      }
      return {
        title: `${statusEmoji[status] || ''} ${title}`,
        subtitle: nctId || 'No NCT ID'
      }
    }
  }
}
```

### 4. newsPost.js

```javascript
export default {
  name: 'newsPost',
  title: 'News Post',
  type: 'document',
  fields: [
    {
      name: 'title',
      title: 'Title',
      type: 'string',
      validation: Rule => Rule.required()
    },
    {
      name: 'slug',
      title: 'Slug',
      type: 'slug',
      options: { source: 'title' },
      validation: Rule => Rule.required()
    },
    {
      name: 'publishedAt',
      title: 'Published Date',
      type: 'datetime',
      initialValue: () => new Date().toISOString()
    },
    {
      name: 'author',
      title: 'Author',
      type: 'reference',
      to: [{ type: 'researcher' }]
    },
    {
      name: 'featuredImage',
      title: 'Featured Image',
      type: 'image',
      options: { hotspot: true }
    },
    {
      name: 'excerpt',
      title: 'Excerpt',
      type: 'text',
      rows: 3,
      description: 'Brief summary for listing pages'
    },
    {
      name: 'body',
      title: 'Body',
      type: 'array',
      of: [
        { type: 'block' },
        {
          type: 'image',
          options: { hotspot: true }
        }
      ]
    },
    {
      name: 'tags',
      title: 'Tags',
      type: 'array',
      of: [{ type: 'string' }],
      options: { layout: 'tags' }
    }
  ],
  orderings: [
    {
      title: 'Newest First',
      name: 'publishedAtDesc',
      by: [{ field: 'publishedAt', direction: 'desc' }]
    }
  ],
  preview: {
    select: {
      title: 'title',
      date: 'publishedAt',
      media: 'featuredImage'
    },
    prepare({ title, date, media }) {
      return {
        title,
        subtitle: date ? new Date(date).toLocaleDateString() : 'No date',
        media
      }
    }
  }
}
```

### 5. site.js
Research network sites (hospitals, clinics, etc.)

```javascript
export default {
  name: 'site',
  title: 'Research Site',
  type: 'document',
  fields: [
    {
      name: 'name',
      title: 'Site Name',
      type: 'string',
      validation: Rule => Rule.required(),
      description: 'e.g., "London Health Sciences Centre - University Hospital"'
    },
    {
      name: 'shortName',
      title: 'Short Name',
      type: 'string',
      description: 'e.g., "LHSC-UH"'
    },
    {
      name: 'type',
      title: 'Site Type',
      type: 'string',
      options: {
        list: [
          { title: 'Academic Hospital', value: 'academic_hospital' },
          { title: 'Community Hospital', value: 'community_hospital' },
          { title: 'Dialysis Centre', value: 'dialysis_centre' },
          { title: 'Private Clinic', value: 'private_clinic' },
          { title: 'University', value: 'university' },
          { title: 'Research Institute', value: 'research_institute' }
        ]
      }
    },
    {
      name: 'city',
      title: 'City',
      type: 'string'
    },
    {
      name: 'province',
      title: 'Province/State',
      type: 'string'
    },
    {
      name: 'capabilities',
      title: 'Site Capabilities',
      type: 'array',
      of: [{ type: 'string' }],
      options: { layout: 'tags' },
      description: 'e.g., "Phase I-IV trials", "Hemodialysis", "PD", "Biobanking"'
    },
    {
      name: 'patientVolume',
      title: 'Patient Volume',
      type: 'object',
      fields: [
        { name: 'description', title: 'Description', type: 'string' },
        { name: 'hemodialysis', title: 'Hemodialysis Patients', type: 'number' },
        { name: 'peritoneal', title: 'Peritoneal Dialysis Patients', type: 'number' },
        { name: 'ckd', title: 'CKD Patients', type: 'number' },
        { name: 'transplant', title: 'Transplant Patients', type: 'number' }
      ]
    },
    {
      name: 'active',
      title: 'Active Site?',
      type: 'boolean',
      initialValue: true
    },
    {
      name: 'order',
      title: 'Display Order',
      type: 'number'
    }
  ],
  orderings: [
    {
      title: 'Display Order',
      name: 'orderAsc',
      by: [{ field: 'order', direction: 'asc' }]
    }
  ],
  preview: {
    select: {
      title: 'name',
      type: 'type',
      city: 'city',
      active: 'active'
    },
    prepare({ title, type, city, active }) {
      return {
        title: active ? title : `${title} (inactive)`,
        subtitle: `${type?.replace('_', ' ')} • ${city || ''}`
      }
    }
  }
}
```

### 6. capabilities.js (Singleton)
For sponsors/CROs page.

```javascript
export default {
  name: 'capabilities',
  title: 'Capabilities (For Sponsors)',
  type: 'document',
  __experimental_actions: ['update', 'publish'],
  fields: [
    {
      name: 'headline',
      title: 'Headline',
      type: 'string',
      description: 'e.g., "Partner With Us on Clinical Research"'
    },
    {
      name: 'introduction',
      title: 'Introduction',
      type: 'text',
      rows: 4
    },
    {
      name: 'therapeuticAreas',
      title: 'Therapeutic Focus Areas',
      type: 'array',
      of: [
        {
          type: 'object',
          fields: [
            { name: 'area', title: 'Area', type: 'string' },
            { name: 'description', title: 'Description', type: 'text', rows: 2 }
          ]
        }
      ]
    },
    {
      name: 'coreCapabilities',
      title: 'Core Capabilities',
      type: 'array',
      of: [{ type: 'string' }],
      description: 'e.g., "Phase I-IV clinical trials", "Pragmatic trials", "Biomarker studies"'
    },
    {
      name: 'trackRecord',
      title: 'Track Record Highlights',
      type: 'array',
      of: [
        {
          type: 'object',
          fields: [
            { name: 'metric', title: 'Metric', type: 'string' },
            { name: 'value', title: 'Value', type: 'string' }
          ]
        }
      ],
      description: 'e.g., "Trials Completed: 45"'
    },
    {
      name: 'regulatoryExperience',
      title: 'Regulatory Experience',
      type: 'array',
      of: [{ type: 'string' }],
      options: { layout: 'tags' },
      description: 'e.g., Health Canada, FDA IND, GCP certified'
    },
    {
      name: 'previousSponsors',
      title: 'Previous Sponsors/Partners',
      type: 'array',
      of: [{ type: 'string' }],
      options: { layout: 'tags' }
    },
    {
      name: 'additionalServices',
      title: 'Additional Services',
      type: 'array',
      of: [
        {
          type: 'object',
          fields: [
            { name: 'service', title: 'Service', type: 'string' },
            { name: 'description', title: 'Description', type: 'text', rows: 2 }
          ]
        }
      ],
      description: 'e.g., Consulting, Protocol development'
    },
    {
      name: 'contactName',
      title: 'Partnership Contact Name',
      type: 'string'
    },
    {
      name: 'contactEmail',
      title: 'Partnership Contact Email',
      type: 'string'
    },
    {
      name: 'contactPhone',
      title: 'Partnership Contact Phone',
      type: 'string'
    }
  ]
}
```

### 7. referralInfo.js (Singleton)
For referring physicians.

```javascript
export default {
  name: 'referralInfo',
  title: 'Referral Information (For Physicians)',
  type: 'document',
  __experimental_actions: ['update', 'publish'],
  fields: [
    {
      name: 'headline',
      title: 'Headline',
      type: 'string'
    },
    {
      name: 'introduction',
      title: 'Introduction',
      type: 'text',
      rows: 3
    },
    {
      name: 'clinicalServices',
      title: 'Clinical Services',
      type: 'array',
      of: [
        {
          type: 'object',
          fields: [
            { name: 'service', title: 'Service', type: 'string' },
            { name: 'description', title: 'Description', type: 'text', rows: 2 },
            { name: 'referralCriteria', title: 'Referral Criteria', type: 'text', rows: 2 }
          ]
        }
      ]
    },
    {
      name: 'researchReferrals',
      title: 'Research Referrals',
      type: 'text',
      rows: 3,
      description: 'Info about referring patients for research studies'
    },
    {
      name: 'howToRefer',
      title: 'How to Refer',
      type: 'array',
      of: [{ type: 'block' }]
    },
    {
      name: 'referralFax',
      title: 'Referral Fax Number',
      type: 'string'
    },
    {
      name: 'referralPhone',
      title: 'Referral Phone Number',
      type: 'string'
    },
    {
      name: 'referralEmail',
      title: 'Referral Email',
      type: 'string'
    },
    {
      name: 'referralFormUrl',
      title: 'Referral Form URL',
      type: 'url'
    },
    {
      name: 'referralForm',
      title: 'Referral Form (PDF)',
      type: 'file',
      options: { accept: '.pdf' }
    },
    {
      name: 'urgentReferrals',
      title: 'Urgent Referral Instructions',
      type: 'text',
      rows: 3
    },
    {
      name: 'geographicArea',
      title: 'Geographic Area Served',
      type: 'string'
    }
  ]
}
```

### 8. traineeOpportunity.js

```javascript
export default {
  name: 'traineeOpportunity',
  title: 'Trainee Opportunity',
  type: 'document',
  fields: [
    {
      name: 'title',
      title: 'Position Title',
      type: 'string',
      validation: Rule => Rule.required()
    },
    {
      name: 'slug',
      title: 'Slug',
      type: 'slug',
      options: { source: 'title' }
    },
    {
      name: 'type',
      title: 'Position Type',
      type: 'string',
      options: {
        list: [
          { title: 'PhD Student', value: 'phd' },
          { title: 'MSc Student', value: 'msc' },
          { title: 'Postdoctoral Fellow', value: 'postdoc' },
          { title: 'Clinical Fellow', value: 'clinical_fellow' },
          { title: 'Research Assistant', value: 'ra' },
          { title: 'Summer Student', value: 'summer' },
          { title: 'Undergraduate Thesis', value: 'undergrad' },
          { title: 'Visiting Scholar', value: 'visiting' }
        ]
      }
    },
    {
      name: 'status',
      title: 'Status',
      type: 'string',
      options: {
        list: [
          { title: 'Open', value: 'open' },
          { title: 'Closed', value: 'closed' },
          { title: 'Always Accepting Inquiries', value: 'ongoing' }
        ]
      },
      initialValue: 'open'
    },
    {
      name: 'supervisor',
      title: 'Supervisor(s)',
      type: 'array',
      of: [{ type: 'reference', to: [{ type: 'researcher' }] }]
    },
    {
      name: 'description',
      title: 'Description',
      type: 'array',
      of: [{ type: 'block' }]
    },
    {
      name: 'researchArea',
      title: 'Research Area',
      type: 'string'
    },
    {
      name: 'qualifications',
      title: 'Qualifications',
      type: 'array',
      of: [{ type: 'string' }]
    },
    {
      name: 'funding',
      title: 'Funding Available?',
      type: 'string'
    },
    {
      name: 'startDate',
      title: 'Start Date',
      type: 'string'
    },
    {
      name: 'deadline',
      title: 'Application Deadline',
      type: 'date'
    },
    {
      name: 'howToApply',
      title: 'How to Apply',
      type: 'text',
      rows: 4
    },
    {
      name: 'contactEmail',
      title: 'Contact Email',
      type: 'string'
    }
  ],
  preview: {
    select: {
      title: 'title',
      type: 'type',
      status: 'status'
    },
    prepare({ title, type, status }) {
      const statusIndicator = status === 'open' ? '🟢' : status === 'ongoing' ? '🔵' : '⚫'
      return {
        title: `${statusIndicator} ${title}`,
        subtitle: type
      }
    }
  }
}
```

### 9. alumnus.js

```javascript
export default {
  name: 'alumnus',
  title: 'Trainee Alumni',
  type: 'document',
  fields: [
    {
      name: 'name',
      title: 'Name',
      type: 'string',
      validation: Rule => Rule.required()
    },
    {
      name: 'photo',
      title: 'Photo',
      type: 'image',
      options: { hotspot: true }
    },
    {
      name: 'trainingType',
      title: 'Training Type',
      type: 'string',
      options: {
        list: [
          { title: 'PhD', value: 'phd' },
          { title: 'MSc', value: 'msc' },
          { title: 'Postdoctoral Fellow', value: 'postdoc' },
          { title: 'Clinical Fellow', value: 'clinical_fellow' },
          { title: 'Research Assistant', value: 'ra' },
          { title: 'Undergraduate', value: 'undergrad' }
        ]
      }
    },
    {
      name: 'yearStarted',
      title: 'Year Started',
      type: 'number'
    },
    {
      name: 'yearCompleted',
      title: 'Year Completed',
      type: 'number'
    },
    {
      name: 'thesisTitle',
      title: 'Thesis/Project Title',
      type: 'string'
    },
    {
      name: 'supervisor',
      title: 'Supervisor(s)',
      type: 'array',
      of: [{ type: 'reference', to: [{ type: 'researcher' }] }]
    },
    {
      name: 'currentPosition',
      title: 'Current Position',
      type: 'string'
    },
    {
      name: 'currentOrganization',
      title: 'Current Organization',
      type: 'string'
    },
    {
      name: 'linkedin',
      title: 'LinkedIn URL',
      type: 'url'
    },
    {
      name: 'testimonial',
      title: 'Testimonial',
      type: 'text',
      rows: 3
    },
    {
      name: 'featured',
      title: 'Featured?',
      type: 'boolean',
      initialValue: false
    }
  ],
  orderings: [
    {
      title: 'Most Recent',
      name: 'yearDesc',
      by: [{ field: 'yearCompleted', direction: 'desc' }]
    }
  ],
  preview: {
    select: {
      title: 'name',
      type: 'trainingType',
      year: 'yearCompleted',
      current: 'currentPosition',
      media: 'photo'
    },
    prepare({ title, type, year, current, media }) {
      return {
        title,
        subtitle: `${type?.toUpperCase() || ''} ${year || ''} → ${current || ''}`,
        media
      }
    }
  }
}
```

### Schema Index (sanity/schemas/index.js)

```javascript
import siteSettings from './siteSettings'
import capabilities from './capabilities'
import referralInfo from './referralInfo'
import researcher from './researcher'
import newsPost from './newsPost'
import trialSummary from './trialSummary'
import traineeOpportunity from './traineeOpportunity'
import alumnus from './alumnus'
import site from './site'

export const schemaTypes = [
  // Singletons
  siteSettings,
  capabilities,
  referralInfo,
  
  // Collections
  researcher,
  newsPost,
  trialSummary,
  traineeOpportunity,
  alumnus,
  site
]
```

---

## External API Integrations

### 1. PubMed E-utilities (lib/pubmed.js)

**Purpose:** Fetch publications by affiliation or researcher name.

**Endpoints:**
- `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi` - Search for PMIDs
- `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi` - Fetch details (returns JSON directly)

**Important:** Use `esummary` NOT `efetch`. It returns clean JSON, no XML parsing needed.

**Key functions:**
- `searchPubMed(query, maxResults)` → returns array of PMIDs
- `fetchPublicationDetails(pmids)` → returns parsed publication objects via esummary
- `getPublicationsForAffiliation(affiliation, maxResults)` → main entry point
- `getPublicationsForResearcher(authorName, affiliations)` → search by author with affiliation filter
- `getPublicationsInDateRange(affiliation, fromDate, toDate)` → date-filtered search

**Search query patterns:**
```javascript
// Author search - include all name field variants
const nameQuery = `(${author}[Author] OR ${author}[Investigator] OR ${author}[Full Author Name])`

// Affiliation search
const affQuery = affiliations.map(aff => `${aff}[Affiliation]`).join(' OR ')

// Date range
const dateQuery = `(${fromDate}[dp] : ${toDate}[dp])`

// Combined
const query = `${nameQuery} AND (${affQuery}) AND ${dateQuery}`
```

**esummary response structure:**
```javascript
// data.result contains objects keyed by PMID
{
  "12345678": {
    uid: "12345678",
    title: "Study of X...",
    authors: [{ name: "Smith J" }, { name: "Jones A" }],
    source: "Journal of Medicine",    // journal name
    pubdate: "2024 Jan",
    volume: "15",
    issue: "3",
    pages: "123-130",
    elocationid: "doi: 10.1234/example"
  }
}
```

**Output structure (after parsing):**
```javascript
{
  pmid: "12345678",
  title: "Study of X in patients with Y",
  authors: ["Smith J", "Jones A", "..."],
  journal: "Journal of Medicine",
  year: "2024",
  volume: "15",
  issue: "3",
  pages: "123-130",
  doi: "10.1234/example",
  url: "https://pubmed.ncbi.nlm.nih.gov/12345678/"
}
```

**Rate limits:** 3 requests/second without API key, 10 with key. Add `&api_key=YOUR_KEY` to requests.

### 5. AI Lay Summaries (lib/summaries.js)

**Purpose:** Generate plain-language 2-3 sentence summaries of publications for general audiences.

**Provider options (configure via env vars):**

| Provider | Model | Cost | Notes |
|----------|-------|------|-------|
| **OpenRouter** | gpt-oss-120b | **FREE** | Default, recommended |
| OpenRouter | meta-llama/llama-3.1-8b-instruct:free | FREE | Alternative free model |
| Groq | llama-3.1-8b-instant | Free tier | Fast, rate limited |
| Together.ai | Llama 3.1 8B | ~$0.0002/1K | Cheap, reliable |
| OpenAI | gpt-4o-mini | ~$0.00015/1K in | If you need OpenAI |
| Ollama | llama3.1:8b | Free | Self-hosted |

**Environment variables:**
```bash
# OpenRouter (default - FREE)
LLM_PROVIDER=openrouter
LLM_MODEL=openrouter/gpt-oss-120b
OPENROUTER_API_KEY=sk-or-...
SITE_URL=https://yoursite.com   # Required by OpenRouter for attribution
```

**Key functions:**
- `generateLaySummary(title, abstract)` → 2-3 sentence plain summary
- `generateSummariesBatch(publications)` → batch process with rate limiting
- `enrichWithSummaries(publications)` → add laySummary field to publications

**Caching strategy:** Summaries should be generated once and cached (in Sanity, Vercel KV, or database). Don't regenerate on every page load.

### 6. Social Sharing (lib/sharing.js)

**Purpose:** Generate share URLs for publications on X, Bluesky, and LinkedIn.

**Key functions:**
- `getShareUrls(publication)` → object with URLs for each platform
- `getShareButtons(publication)` → array of button data for React components
- `shareIcons` → inline SVGs for share buttons

**Share URL formats:**
```javascript
{
  twitter: `https://twitter.com/intent/tweet?text=${text}&url=${url}`,
  bluesky: `https://bsky.app/intent/compose?text=${textWithUrl}`,
  linkedin: `https://www.linkedin.com/sharing/share-offsite/?url=${url}`
}
```

**Share text:** Uses lay summary if available, falls back to title. Links to DOI if available, otherwise PubMed URL.

### 2. OpenAlex (lib/openalex.js)

**Purpose:** Citation counts, h-index, researcher metrics.

**Base URL:** `https://api.openalex.org`

**Key functions:**
- `findAuthor(name, affiliation)` → author profile with metrics
- `getAuthorByOrcid(orcid)` → more reliable lookup
- `getCitationsForDOIs(dois)` → batch citation lookup
- `getTeamMetrics(researchers)` → metrics for entire team

**Output structure (author):**
```javascript
{
  openAlexId: "A1234567",
  name: "Jane Smith",
  orcid: "0000-0001-2345-6789",
  worksCount: 87,
  citationCount: 2341,
  hIndex: 24,
  i10Index: 45,
  currentAffiliation: "Western University"
}
```

**Rate limits:** 100,000 requests/day. Include User-Agent header.

### 3. ClinicalTrials.gov (lib/clinicaltrials.js)

**Purpose:** Fetch active trials by institution or PI name.

**Base URL:** `https://clinicaltrials.gov/api/v2`

**Key functions:**
- `searchTrials({ sponsor, principalInvestigator, affiliation, status })` → array of trials
- `getTrialByNCTId(nctId)` → single trial details
- `getTrialsForResearchers(names)` → trials for multiple PIs

**Output structure:**
```javascript
{
  nctId: "NCT12345678",
  briefTitle: "Study of Drug X",
  officialTitle: "A Randomized...",
  url: "https://clinicaltrials.gov/study/NCT12345678",
  status: "RECRUITING",
  startDate: "2024-01",
  primaryCompletionDate: "2026-06",
  sponsor: "Pharma Inc",
  principalInvestigator: "Dr. Jane Smith",
  briefSummary: "This study evaluates...",
  conditions: ["Chronic Kidney Disease"],
  interventions: [{ type: "Drug", name: "Drug X" }],
  phase: "Phase 3",
  enrollment: { count: 500, type: "ESTIMATED" },
  canadianSites: [{ facility: "LHSC", city: "London", status: "Recruiting" }],
  totalSites: 45
}
```

### 4. Combined Publications (lib/publications.js)

**Purpose:** Merge PubMed bibliographic data with OpenAlex citations.

**Key functions:**
- `getEnrichedPublications(affiliation)` → publications with citation counts
- `getPublicationsForDisplay(affiliation)` → grouped by year with stats
- `getHighImpactPublications(affiliation, topN)` → most cited
- `getRecentPublications(affiliation, months)` → last N months

---

## API Routes

### POST /api/inquiry

**Purpose:** Handle study inquiry form submissions.

**Request body:**
```javascript
{
  trialSlug: "study-of-x",      // Required
  name: "John Doe",              // Required
  email: "john@example.com",     // Required
  phone: "555-1234",             // Optional
  role: "patient",               // Required: "patient" | "physician" | "other"
  message: "I'm interested..."   // Optional
}
```

**Flow:**
1. Validate required fields
2. Fetch coordinator email from Sanity using trialSlug
3. Send email via Resend/SendGrid
4. Return success response

**Coordinator email is never exposed to the client.**

### GET /api/publications

**Purpose:** Return cached publication data.

**Query params:**
- `refresh=true` - Force refresh from PubMed/OpenAlex

**Caching:** 24 hours in memory (or use Vercel KV for persistence).

### GET /api/trials

**Purpose:** Return cached ClinicalTrials.gov data.

**Query params:**
- `refresh=true` - Force refresh
- `status=active|completed|all` - Filter by status

**Caching:** 12 hours.

### GET /api/metrics

**Purpose:** Return cached researcher metrics from OpenAlex.

**Query params:**
- `refresh=true` - Force refresh

**Caching:** 24 hours.

---

## Cron Jobs (vercel.json)

```json
{
  "crons": [
    {
      "path": "/api/publications?refresh=true",
      "schedule": "0 6 * * *"
    },
    {
      "path": "/api/trials?refresh=true",
      "schedule": "0 7 * * *"
    },
    {
      "path": "/api/metrics?refresh=true",
      "schedule": "0 8 * * *"
    }
  ]
}
```

All data sources refresh daily, staggered to avoid rate limits.

---

## Page Requirements

### Homepage (/)
- Hero section with unit name and tagline
- Featured recruiting studies (2-3)
- Recent news (2-3 posts)
- Quick links to main sections
- Team highlight or key metrics

### Studies (/studies)
- List all recruiting studies
- Each card shows: title, condition, brief description
- Filter by status (recruiting, coming soon)
- Link to individual study pages

### Study Detail (/studies/[slug])
- Full study description in plain language
- Who can join / Who cannot join
- What to expect
- Duration, compensation
- PI name (linked to team profile)
- **Inquiry form** (name, email, phone, role, message)
- Link to ClinicalTrials.gov if NCT ID exists

### Team (/team)
- Grid of researcher cards
- Photo, name, role
- Link to individual profiles

### Team Member (/team/[slug])
- Full bio
- Photo
- Contact info
- ORCID, social links
- Publications by this researcher (optional, via PubMed query)
- Citation metrics from OpenAlex

### Publications (/publications)
- Grouped by year
- Each shows: title, authors, journal, citation count
- **AI-generated lay summary** (2-3 sentences in plain language)
- **Social share buttons** (X, Bluesky, LinkedIn)
- Links to PubMed and DOI
- Stats summary (total pubs, total citations, open access count)

### For Sponsors (/for-sponsors)
- Introduction / value proposition
- Therapeutic focus areas
- Research network (sites with patient volumes, auto-aggregated)
- Track record metrics
- Core capabilities
- Regulatory experience
- Previous sponsors
- Additional services (consulting, etc.)
- Partnership contact information

### For Physicians (/for-physicians)
- Introduction
- Clinical services offered
- How to refer (step by step)
- Referral contact (fax, phone, email)
- Downloadable referral form
- Geographic area served
- Urgent referral instructions

### Training (/training)
- Open opportunities
- How to apply
- Alumni section with outcomes
- Featured testimonials

### Training Opportunity (/training/[slug])
- Full description
- Supervisor(s)
- Qualifications
- Funding info
- How to apply
- Contact

### News (/news)
- List of posts, newest first
- Featured image, title, excerpt, date

### News Post (/news/[slug])
- Full article with rich text
- Author info
- Published date
- Tags

---

## Sanity Queries (lib/sanity.js)

Include a `queries` object with all GROQ queries needed:

```javascript
export const queries = {
  siteSettings: `*[_type == "siteSettings"][0] { ... }`,
  allResearchers: `*[_type == "researcher"] | order(order asc) { ... }`,
  researcherBySlug: `*[_type == "researcher" && slug.current == $slug][0] { ... }`,
  recentNews: `*[_type == "newsPost"] | order(publishedAt desc)[0...10] { ... }`,
  newsPostBySlug: `*[_type == "newsPost" && slug.current == $slug][0] { ... }`,
  capabilities: `*[_type == "capabilities"][0] { ... }`,
  referralInfo: `*[_type == "referralInfo"][0] { ... }`,
  trialSummaries: `*[_type == "trialSummary"] | order(status asc, title asc) { ... }`,
  recruitingTrials: `*[_type == "trialSummary" && status == "recruiting"] { ... }`,
  trialBySlug: `*[_type == "trialSummary" && slug.current == $slug][0] { ... }`,
  trialCoordinator: `*[_type == "trialSummary" && slug.current == $slug][0] { coordinatorEmail, title }`,
  openOpportunities: `*[_type == "traineeOpportunity" && status in ["open", "ongoing"]] { ... }`,
  allOpportunities: `*[_type == "traineeOpportunity"] | order(status asc, type asc) { ... }`,
  alumni: `*[_type == "alumnus"] | order(yearCompleted desc) { ... }`,
  featuredAlumni: `*[_type == "alumnus" && featured == true] { ... }`,
  sites: `*[_type == "site" && active == true] | order(order asc) { ... }`,
  siteSummary: `{ "sites": ..., "totalHD": math::sum(...), ... }`
}
```

**Important:** Public queries must NOT return coordinator emails. Only `trialCoordinator` query (used server-side) returns the email.

---

## Environment Variables

```bash
# .env.local

# Sanity
NEXT_PUBLIC_SANITY_PROJECT_ID=your_project_id
NEXT_PUBLIC_SANITY_DATASET=production
SANITY_API_TOKEN=your_write_token

# Email (Resend example)
RESEND_API_KEY=re_xxxxxxxxxxxx
EMAIL_FROM=noreply@yourresearchunit.com

# PubMed API key for higher rate limits (optional but recommended)
PUBMED_API_KEY=your_ncbi_api_key

# AI Summaries - OpenRouter (FREE, default)
LLM_PROVIDER=openrouter
LLM_MODEL=openrouter/gpt-oss-120b
OPENROUTER_API_KEY=sk-or-...
SITE_URL=https://yourresearchunit.com

# Alternative providers (if not using OpenRouter):
# LLM_PROVIDER=groq
# LLM_MODEL=llama-3.1-8b-instant
# GROQ_API_KEY=...

# LLM_PROVIDER=openai
# LLM_MODEL=gpt-4o-mini
# OPENAI_API_KEY=sk-...
```

---

## Design Guidelines

### Visual Style
- Clean, professional, trustworthy (medical/academic context)
- Accessible (WCAG 2.1 AA)
- Mobile-responsive
- Minimal but not sterile

### Color Suggestions
- Primary: Deep blue or teal (medical trust)
- Secondary: Warm accent for CTAs
- Neutral: Grays for text and backgrounds
- Status colors: Green (recruiting), Yellow (coming soon), Gray (closed)

### Typography
- Sans-serif for body (Inter, Open Sans)
- Consider serif for headings if going for academic feel
- Clear hierarchy

### Key UI Patterns
- Cards for studies, team members, opportunities
- Status badges for trial recruitment status
- Clear CTAs for inquiry forms
- Breadcrumbs for nested pages
- Sticky header with navigation

---

## Testing Checklist

- [ ] All Sanity schemas create/edit correctly in Studio
- [ ] Public pages render with Sanity data
- [ ] Study inquiry form submits and emails coordinator
- [ ] Coordinator email never exposed in client-side code or network requests
- [ ] PubMed integration fetches and parses correctly
- [ ] OpenAlex enrichment adds citation counts
- [ ] ClinicalTrials.gov integration works
- [ ] Cron jobs refresh data
- [ ] Mobile responsive
- [ ] Accessibility audit passes
- [ ] Forms validate properly
- [ ] Error states handled gracefully
- [ ] 404 pages work for invalid slugs

---

## Deployment Steps

1. Create Sanity project: `npx sanity init`
2. Deploy Sanity Studio: `npx sanity deploy`
3. Push code to GitHub
4. Connect repo to Vercel
5. Add environment variables in Vercel dashboard
6. Deploy
7. Configure custom domain (optional)
8. Set up email provider (Resend/SendGrid)
9. Test inquiry form end-to-end
10. Populate initial content in Sanity

---

## Notes for the AI Agent

1. **Coordinator email privacy is critical.** The `coordinatorEmail` field must only be accessed server-side in the inquiry API route. It should never appear in any client-side code, page props, or network responses visible to users.

2. **The unit is independent.** Do not frame content as "University X's department" or "Hospital Y's program." The unit operates across multiple institutions but is its own entity.

3. **Plain language for patients.** Study descriptions should be readable by non-medical audiences. The official ClinicalTrials.gov data is supplementary; the Sanity-managed summaries are primary.

4. **Patient volume aggregation.** The capabilities page should auto-calculate totals from individual site entries, not hardcode numbers.

5. **ISR (Incremental Static Regeneration)** should be used for pages that pull from Sanity to keep them fresh without rebuilding the entire site.

6. **Error handling:** API integrations (PubMed, OpenAlex, ClinicalTrials.gov) should fail gracefully. If external APIs are down, show cached data with a note, or hide that section—don't break the page.

7. **The inquiry form is the primary conversion point** for patients and physicians. It should be prominent, simple, and work flawlessly.

8. **AI summaries must be cached.** Generate lay summaries once when publications are fetched/refreshed, then store them (in Vercel KV, database, or as part of the cached publication data). Do NOT call the LLM on every page load. Consider a separate cron job or on-demand generation with caching.

9. **Social share buttons** should open in new windows/tabs. The share text should use the lay summary if available (more engaging than the academic title).
