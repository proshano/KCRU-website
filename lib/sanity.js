import { createClient } from '@sanity/client'
import imageUrlBuilder from '@sanity/image-url'

// Align with the Studio fallback so local dev works even if env vars are missing.
const projectId = process.env.NEXT_PUBLIC_SANITY_PROJECT_ID || 't6eeltne'
const dataset = process.env.NEXT_PUBLIC_SANITY_DATASET || 'production'

if (!projectId) {
  throw new Error('Missing Sanity projectId. Set NEXT_PUBLIC_SANITY_PROJECT_ID or adjust lib/sanity.js fallback.')
}

// Read-only client (uses CDN in production)
export const client = createClient({
  projectId,
  dataset,
  apiVersion: '2024-01-01',
  useCdn: process.env.NODE_ENV === 'production',
})

// Write client for mutations (requires SANITY_API_TOKEN)
export const writeClient = createClient({
  projectId,
  dataset,
  apiVersion: '2024-01-01',
  useCdn: false,
  token: process.env.SANITY_API_TOKEN,
})

// Image URL helper
const builder = imageUrlBuilder(client)

export function urlFor(source) {
  return builder.image(source)
}

// Common queries
export const queries = {
  // Get all researchers ordered by display order
  allResearchers: `
    *[_type == "researcher"] | order(order asc) {
      _id,
      name,
      slug,
      role,
      category,
      photo,
      email,
      bio,
      pubmedQuery,
      twitter,
      linkedin,
      orcid
    }
  `,

  // Get single researcher by slug
  researcherBySlug: `
    *[_type == "researcher" && (
      slug.current == $slug ||
      lower(slug.current) == $slugLower ||
      string(slug) == $slug ||
      lower(string(slug)) == $slugLower ||
      lower(slug.current) match $slugPattern
    )][0] {
      _id,
      name,
      slug,
      role,
      category,
      photo,
      email,
      bio,
      pubmedQuery,
      twitter,
      linkedin,
      orcid,
      "studies": *[_type == "trialSummary" && principalInvestigator._ref == ^._id] | order(status asc, title asc) {
        _id,
        title,
        slug,
        status,
        nctId,
        laySummary,
        ctGovData,
        "therapeuticAreas": therapeuticAreas[]-> { _id, name, shortLabel, slug }
      }
    }
  `,

  // Get recent news posts
  recentNews: `
    *[_type == "newsPost"] | order(publishedAt desc)[0...10] {
      _id,
      title,
      slug,
      publishedAt,
      excerpt,
      featuredImage,
      author-> { name, slug }
    }
  `,

  // Get all news posts
  allNews: `
    *[_type == "newsPost"] | order(publishedAt desc) {
      _id,
      title,
      slug,
      publishedAt,
      excerpt,
      featuredImage,
      author-> { name, slug }
    }
  `,

  // Get single news post by slug
  newsPostBySlug: `
    *[_type == "newsPost" && slug.current == $slug][0] {
      _id,
      title,
      slug,
      publishedAt,
      excerpt,
      body,
      featuredImage,
      author-> { name, slug, photo },
      tags
    }
  `,

  // Get site settings
  siteSettings: `
    *[_type == "siteSettings"][0] {
      unitName,
      tagline,
      taglineHighlight,
      taglineHighlights,
      description,
      logo,
      llmProvider,
      llmModel,
      llmApiKey,
      llmSystemPrompt,
      llmConcurrency,
      llmDelayMs,
      llmClassificationProvider,
      llmClassificationModel,
      llmClassificationApiKey,
      llmClassificationPrompt,
      affiliations[]{
        name,
        url,
        logo
      },
      contactEmail,
      phone,
      address,
      institutionAffiliation,
      socialLinks,
      pubmedAffiliation
    }
  `,

  // Get capabilities (for sponsors page)
  capabilities: `
    *[_type == "capabilities"][0] {
      headline,
      introduction,
      therapeuticAreas,
      coreCapabilities,
      infrastructure,
      patientVolume,
      trackRecord,
      regulatoryExperience,
      previousSponsors,
      additionalServices,
      contactName,
      contactEmail,
      contactPhone
    }
  `,

  // Get referral info (for physicians page)
  referralInfo: `
    *[_type == "referralInfo"][0] {
      headline,
      introduction,
      clinicalServices,
      researchReferrals,
      howToRefer,
      referralFax,
      referralPhone,
      referralEmail,
      referralFormUrl,
      "referralFormFile": referralForm.asset->url,
      urgentReferrals,
      geographicArea
    }
  `,

  // Get patient-facing trial summaries (public)
  trialSummaries: `
    *[_type == "trialSummary"] | order(status asc, title asc) {
      _id,
      nctId,
      title,
      slug,
      status,
      conditions,
      laySummary,
      eligibilityOverview,
      whatToExpect,
      duration,
      compensation,
      sex,
      therapeuticAreas[]-> { _id, name, shortLabel, "slug": slug.current, color },
      principalInvestigator-> { _id, name, slug, photo },
      localContact {
        name,
        role,
        email,
        phone,
        displayPublicly
      },
      featured,
      ctGovData {
        sponsor,
        url
      }
    }
  `,

  // Get recruiting trials only (public)
  recruitingTrials: `
    *[_type == "trialSummary" && status == "recruiting"] | order(featured desc, title asc) {
      _id,
      nctId,
      title,
      slug,
      conditions,
      laySummary,
      eligibilityOverview,
      therapeuticAreas[]-> { _id, name, shortLabel, slug },
      principalInvestigator-> { name }
    }
  `,

  // Get single trial by slug (public detail page)
  trialBySlug: `
    *[_type == "trialSummary" && slug.current == $slug][0] {
      _id,
      nctId,
      title,
      status,
      conditions,
      laySummary,
      eligibilityOverview,
      inclusionCriteria,
      exclusionCriteria,
      sex,
      whatToExpect,
      duration,
      compensation,
      therapeuticAreas[]-> { _id, name, shortLabel, "slug": slug.current, color },
      principalInvestigator-> { _id, name, slug, photo, title, email },
      localContact {
        name,
        role,
        email,
        phone,
        displayPublicly
      },
      sponsorWebsite,
      ctGovData {
        officialTitle,
        briefSummary,
        sponsor,
        enrollmentCount,
        startDate,
        completionDate,
        url
      }
    }
  `,

  // Get therapeutic areas for filtering
  therapeuticAreas: `
    *[_type == "therapeuticArea" && active == true] | order(order asc, name asc) {
      _id,
      name,
      shortLabel,
      "slug": slug.current,
      color,
      icon,
      "trialCount": count(*[_type == "trialSummary" && references(^._id) && status == "recruiting"])
    }
  `,

  // Get coordinator email for a trial (internal - for form routing only)
  trialCoordinator: `
    *[_type == "trialSummary" && slug.current == $slug][0] {
      "coordinatorEmail": localContact.email,
      title
    }
  `,

  // Get open trainee opportunities
  openOpportunities: `
    *[_type == "traineeOpportunity" && status in ["open", "ongoing"]] | order(type asc) {
      _id,
      title,
      slug,
      type,
      status,
      researchArea,
      supervisor[]-> { name, slug },
      funding,
      startDate,
      deadline
    }
  `,

  // Get all trainee opportunities
  allOpportunities: `
    *[_type == "traineeOpportunity"] | order(status asc, type asc) {
      _id,
      title,
      slug,
      type,
      status,
      researchArea,
      supervisor[]-> { name, slug },
      funding,
      startDate,
      deadline,
      description,
      qualifications,
      howToApply,
      contactEmail
    }
  `,

  // Get all active sites
  sites: `
    *[_type == "site" && active == true] | order(order asc) {
      _id,
      name,
      shortName,
      type,
      city,
      province,
      capabilities,
      patientVolume
    }
  `,

  // Get site summary for capabilities page
  siteSummary: `
    {
      "sites": *[_type == "site" && active == true] | order(order asc) {
        name,
        shortName,
        type,
        city,
        capabilities,
        patientVolume
      },
      "totalHD": math::sum(*[_type == "site" && active == true].patientVolume.hemodialysis),
      "totalPD": math::sum(*[_type == "site" && active == true].patientVolume.peritoneal),
      "totalCKD": math::sum(*[_type == "site" && active == true].patientVolume.ckd),
      "siteCount": count(*[_type == "site" && active == true])
    }
  `,

  // Get page content (headers, descriptions for all pages)
  pageContent: `
    *[_type == "pageContent"][0] {
      studiesEyebrow,
      studiesTitle,
      studiesDescription,
      teamEyebrow,
      teamTitle,
      teamDescription,
      publicationsTitle,
      publicationsDescription,
      newsEyebrow,
      newsTitle,
      newsDescription,
      contactTitle,
      contactDescription,
      contactLocationsTitle,
      trainingEyebrow,
      trainingTitle,
      trainingDescription
    }
  `,

  // Get contact page locations
  contactLocations: `
    *[_type == "contactLocation"][0] {
      locations[] {
        name,
        address,
        phone,
        fax,
        email,
        note,
        mapUrl
      }
    }
  `
}

// Fetch helper
export async function sanityFetch(query, params = {}) {
  return client.fetch(query, params)
}

