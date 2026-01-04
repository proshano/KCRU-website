import { createClient } from '@sanity/client'
import imageUrlBuilder from '@sanity/image-url'

const projectId = process.env.NEXT_PUBLIC_SANITY_PROJECT_ID
const dataset = process.env.NEXT_PUBLIC_SANITY_DATASET

if (!projectId) {
  throw new Error('Missing NEXT_PUBLIC_SANITY_PROJECT_ID. Set it in the environment.')
}

if (!dataset) {
  throw new Error('Missing NEXT_PUBLIC_SANITY_DATASET. Set it in the environment.')
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
      researchTags,
      twitter,
      linkedin,
      orcid,
      googleScholar,
      github
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
      _updatedAt,
      name,
      slug,
      role,
      category,
      photo,
      email,
      bio,
      pubmedQuery,
      researchTags,
      twitter,
      linkedin,
      orcid,
      googleScholar,
      github,
      seo {
        description,
        generatedAt,
        source
      },
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
      _updatedAt,
      title,
      slug,
      publishedAt,
      excerpt,
      body,
      featuredImage,
      author-> { name, slug, photo },
      tags,
      seo {
        description,
        generatedAt,
        source
      }
    }
  `,

  // Get site settings
  siteSettings: `
    *[_type == "siteSettings"][0] {
      _id,
      _updatedAt,
      unitName,
      tagline,
      taglineHighlight,
      taglineHighlights,
      description,
      logo,
      seo {
        title,
        description,
        shareImage,
        llmSummary,
        llmTopics,
        llmGeneratedAt,
        publicationTopics,
        publicationHighlights,
        publicationGeneratedAt
      },
      llmProvider,
      llmModel,
      llmApiKey,
      llmSystemPrompt,
      trialSummaryLlmProvider,
      trialSummaryLlmModel,
      trialSummaryLlmApiKey,
      trialSummarySystemPrompt,
      trialCommunicationsLlmProvider,
      trialCommunicationsLlmModel,
      trialCommunicationsLlmApiKey,
      trialCommunicationsTitlePrompt,
      trialCommunicationsEligibilityPrompt,
      llmConcurrency,
      llmDelayMs,
      llmClassificationProvider,
      llmClassificationModel,
      llmClassificationApiKey,
      llmClassificationPrompt,
      studyUpdates{
        subjectTemplate,
        introText,
        emptyIntroText,
        outroText,
        signature,
        maxStudies,
        sendEmpty
      },
      publicationNewsletter{
        subjectTemplate,
        introText,
        emptyIntroText,
        outroText,
        signature,
        windowMode,
        windowDays,
        maxPublications,
        sendEmpty
      },
      affiliations[]{
        name,
        url,
        logo
      },
      contactEmail,
      replyToEmail,
      phone,
      address,
      institutionAffiliation,
      socialLinks,
      pubmedAffiliation,
      altmetric {
        enabled
      }
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

  // Get trial summaries (public)
  trialSummaries: `
    *[_type == "trialSummary"] | order(status asc, title asc) {
      _id,
      nctId,
      title,
      slug,
      status,
      laySummary,
      therapeuticAreas[]-> { _id, name, shortLabel, "slug": slug.current, color },
      principalInvestigator-> { _id, name, slug, photo },
      principalInvestigatorName,
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
      laySummary,
      therapeuticAreas[]-> { _id, name, shortLabel, slug },
      principalInvestigator-> { name },
      principalInvestigatorName
    }
  `,

  // Get single trial by slug (public detail page)
  trialBySlug: `
    *[_type == "trialSummary" && slug.current == $slug][0] {
      _id,
      _updatedAt,
      nctId,
      title,
      slug,
      status,
      laySummary,
      seo {
        description,
        generatedAt,
        source
      },
      inclusionCriteria,
      exclusionCriteria,
      acceptsReferrals,
      therapeuticAreas[]-> { _id, name, shortLabel, "slug": slug.current, color },
      principalInvestigator-> { _id, name, slug, photo, title, email },
      principalInvestigatorName,
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
      "trialCount": count(*[_type == "trialSummary" && references(^._id) && status != "completed"])
    }
  `,

  // Get coordinator email for a trial (internal - for form routing only)
  trialCoordinator: `
    *[_type == "trialSummary" && slug.current == $slug][0] {
      _id,
      title,
      acceptsReferrals,
      "coordinatorEmail": localContact.email
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

  sitemapResearchers: `
    *[_type == "researcher" && defined(slug.current)] {
      "slug": slug.current,
      _updatedAt
    }
  `,

  sitemapTrials: `
    *[_type == "trialSummary" && defined(slug.current)] {
      "slug": slug.current,
      _updatedAt
    }
  `,

  sitemapNews: `
    *[_type == "newsPost" && defined(slug.current)] {
      "slug": slug.current,
      _updatedAt,
      publishedAt
    }
  `,

  seoNewsPosts: `
    *[_type == "newsPost"] | order(_updatedAt desc) {
      _id,
      _updatedAt,
      title,
      slug,
      excerpt,
      body,
      tags,
      seo {
        description,
        generatedAt,
        source
      }
    }
  `,

  seoResearchers: `
    *[_type == "researcher"] | order(_updatedAt desc) {
      _id,
      _updatedAt,
      name,
      slug,
      role,
      category,
      bio,
      researchTags,
      seo {
        description,
        generatedAt,
        source
      }
    }
  `,

  seoTrials: `
    *[_type == "trialSummary"] | order(_updatedAt desc) {
      _id,
      _updatedAt,
      title,
      slug,
      status,
      laySummary,
      therapeuticAreas[]-> { name },
      principalInvestigator-> { name },
      principalInvestigatorName,
      ctGovData {
        officialTitle,
        briefSummary,
        sponsor
      },
      seo {
        description,
        generatedAt,
        source
      }
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
  `,

  // Get contact routing configuration
  contactRouting: `
    *[_type == "contactRouting"][0] {
      options[] {
        key,
        label,
        description,
        email,
        showOceanLink,
        oceanUrl,
        messagePlaceholder,
        successMessage
      }
    }
  `
}

// Fetch helper
export async function sanityFetch(query, params = {}) {
  return client.fetch(query, params)
}
