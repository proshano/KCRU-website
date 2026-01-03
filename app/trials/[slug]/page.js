import Link from 'next/link'
import Image from 'next/image'
import { notFound } from 'next/navigation'
import { sanityFetch, queries, urlFor } from '@/lib/sanity'
import { buildOpenGraph, buildTwitterMetadata, getSiteBaseUrl, normalizeDescription, resolveSiteTitle } from '@/lib/seo'
import JsonLd from '@/app/components/JsonLd'
import ReferralForm from './ReferralForm'

// Revalidate every 12 hours
export const revalidate = 43200

export async function generateMetadata({ params }) {
  const { slug } = await params
  const [trialRaw, settingsRaw] = await Promise.all([
    sanityFetch(queries.trialBySlug, { slug }),
    sanityFetch(queries.siteSettings)
  ])
  
  if (!trialRaw) return { title: 'Study Not Found' }

  const trial = JSON.parse(JSON.stringify(trialRaw))
  const settings = JSON.parse(JSON.stringify(settingsRaw || {}))
  const siteTitle = resolveSiteTitle(settings)
  const title = trial.title
  const description = normalizeDescription(
    trial.seo?.description ||
    trial.laySummary ||
    `Learn about the ${trial.title} study from ${siteTitle}.`
  )
  const canonical = `/trials/${trial.slug?.current || slug}`
  
  return {
    title,
    description,
    alternates: {
      canonical
    },
    openGraph: buildOpenGraph({
      settings,
      title,
      description,
      path: canonical
    }),
    twitter: buildTwitterMetadata({
      settings,
      title,
      description
    })
  }
}

const statusConfig = {
  recruiting: { 
    label: 'Actively Recruiting', 
    style: 'text-emerald-800 bg-emerald-50 border-emerald-200',
    message: ''
  },
  coming_soon: { 
    label: 'Coming Soon', 
    style: 'text-amber-800 bg-amber-50 border-amber-200',
    message: 'This study will begin recruiting soon.'
  },
  active_not_recruiting: { 
    label: 'Active, Not Recruiting', 
    style: 'text-purple bg-purple/10 border-purple/30',
    message: 'This study is ongoing but no longer accepting new participants.'
  },
  completed: { 
    label: 'Completed', 
    style: 'text-gray-500 bg-gray-50 border-gray-200',
    message: 'This study has been completed.'
  },
}

export default async function TrialDetailPage({ params }) {
  const { slug } = await params
  const trialRaw = await sanityFetch(queries.trialBySlug, { slug })
  
  if (!trialRaw) notFound()
  
  const trial = JSON.parse(JSON.stringify(trialRaw))
  const config = statusConfig[trial.status] || statusConfig.recruiting
  const isRecruiting = trial.status === 'recruiting'
  const showStatusBanner = !isRecruiting
  const ctGovUrl = trial.ctGovData?.url || (trial.nctId ? `https://clinicaltrials.gov/study/${trial.nctId}` : null)
  const recaptchaSiteKey = process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY || ''
  const studySlug = trial.slug?.current || trial.slug
  const baseUrl = getSiteBaseUrl()
  const canonicalUrl = `${baseUrl}/trials/${studySlug}`
  const schemaStatusMap = {
    recruiting: 'Recruiting',
    coming_soon: 'NotYetRecruiting',
    active_not_recruiting: 'ActiveNotRecruiting',
    completed: 'Completed',
    closed: 'Completed'
  }
  const schemaStatus = schemaStatusMap[trial.status]
  const schemaDescription = normalizeDescription(
    trial.seo?.description || trial.laySummary || trial.ctGovData?.briefSummary || `Learn about the ${trial.title} study.`,
    280
  )
  const keywords = (trial.therapeuticAreas || []).map(area => area?.name).filter(Boolean)
  const piName = trial.principalInvestigator?.name || trial.principalInvestigatorName

  const trialSchema = {
    '@context': 'https://schema.org',
    '@type': 'ClinicalTrial',
    name: trial.title,
    url: canonicalUrl
  }

  if (schemaDescription) trialSchema.description = schemaDescription
  if (schemaStatus) trialSchema.status = schemaStatus
  if (trial.nctId) {
    trialSchema.identifier = {
      '@type': 'PropertyValue',
      propertyID: 'NCT',
      value: trial.nctId
    }
  }
  if (trial.ctGovData?.sponsor) {
    trialSchema.sponsor = {
      '@type': 'Organization',
      name: trial.ctGovData.sponsor
    }
  }
  if (piName) {
    trialSchema.principalInvestigator = {
      '@type': 'Person',
      name: piName
    }
  }
  if (trial.ctGovData?.startDate) trialSchema.startDate = trial.ctGovData.startDate
  if (trial.ctGovData?.completionDate) trialSchema.endDate = trial.ctGovData.completionDate
  if (keywords.length) trialSchema.keywords = keywords.join(', ')

  return (
    <main className="max-w-4xl mx-auto px-6 md:px-12 py-12">
      <JsonLd data={trialSchema} />
      {/* Breadcrumb */}
      <nav className="mb-8">
        <Link href="/trials" className="text-sm text-gray-500 hover:text-purple transition">
          ← Back to all studies
        </Link>
      </nav>

      {/* Status banner (hidden when recruiting, shown for other statuses) */}
      {showStatusBanner && (
        <div className={`mb-8 p-4 rounded-lg border ${config.style}`}>
          <div className="flex items-center gap-3">
            <span className="font-semibold">{config.label}</span>
          </div>
          <p className="text-sm mt-1 opacity-80">{config.message}</p>
        </div>
      )}

      {/* Title section */}
      <header className="mb-10">
        <h1 className="text-3xl md:text-4xl font-bold tracking-tight mb-4">
          {trial.title}
        </h1>
        

        {/* Meta info */}
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3 text-sm text-gray-500">
          {trial.nctId && (
            <span className="font-mono">{trial.nctId}</span>
          )}
          {trial.ctGovData?.sponsor && (
            <span>Sponsor: {trial.ctGovData.sponsor}</span>
          )}
          {piName && (
            <InvestigatorBadge researcher={trial.principalInvestigator} name={piName} />
          )}
        </div>
      </header>

      {/* Call-to-action - shown near top for visibility */}
      {isRecruiting && (
        <section className="mb-8 p-6 bg-purple/5 rounded-xl border border-purple/20">
          <div className="flex items-start gap-3 mb-4">
            <span className="relative flex h-3 w-3 mt-1">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
              <span className="relative inline-flex h-3 w-3 rounded-full bg-emerald-500" />
            </span>
            <div>
              <p className="font-semibold text-emerald-800">{config.label}</p>
              {config.message && <p className="text-sm text-emerald-900/80">{config.message}</p>}
            </div>
          </div>
          
          {trial.localContact?.displayPublicly && trial.localContact?.name && (
            <div className="mb-4">
              <p className="font-medium">{trial.localContact.name}</p>
              {trial.localContact.role && (
                <p className="text-sm text-gray-600">{trial.localContact.role}</p>
              )}
              <div className="flex flex-wrap gap-4 mt-2">
                {trial.localContact.email && (
                  <a 
                    href={`mailto:${trial.localContact.email}`}
                    className="text-sm text-purple hover:underline"
                  >
                    {trial.localContact.email}
                  </a>
                )}
                {trial.localContact.phone && (
                  <a 
                    href={`tel:${trial.localContact.phone}`}
                    className="text-sm text-purple hover:underline"
                  >
                    {trial.localContact.phone}
                  </a>
                )}
              </div>
            </div>
          )}

          <div className="flex flex-wrap gap-3 mt-4">
            <ReferralForm
              acceptsReferrals={trial.acceptsReferrals}
              studySlug={studySlug}
              studyTitle={trial.title}
              coordinatorEmail={trial.localContact?.email}
              recaptchaSiteKey={recaptchaSiteKey}
            />
            {ctGovUrl && (
              <a
                href={ctGovUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-5 py-2.5 border border-gray-300 text-gray-700 font-medium rounded-lg hover:bg-gray-50 transition"
              >
                View on ClinicalTrials.gov ↗
              </a>
            )}
          </div>
        </section>
      )}

      {/* Summary */}
      {trial.laySummary && (
        <section className="mb-10">
          <h2 className="text-xl font-bold mb-3">About This Study</h2>
          <p className="text-gray-700 leading-relaxed">{trial.laySummary}</p>
        </section>
      )}

      {/* Eligibility - THE KEY SECTION */}
      <section className="mb-10 p-6 bg-gray-50 rounded-xl border border-gray-200">
        <h2 className="text-xl font-bold mb-4">Who Can Participate?</h2>
        
        {/* Detailed criteria */}
        <div className="grid md:grid-cols-2 gap-6">
          {trial.inclusionCriteria?.length > 0 && (
            <div>
              <h3 className="font-semibold text-emerald-700 mb-3 flex items-center gap-2">
                <span className="text-lg">✓</span> Inclusion Criteria
              </h3>
              <ul className="space-y-2">
                {trial.inclusionCriteria.map((item, i) => (
                  <li key={i} className="flex gap-2 text-sm text-gray-700">
                    <span className="text-emerald-500 flex-shrink-0">•</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {trial.exclusionCriteria?.length > 0 && (
            <div>
              <h3 className="font-semibold text-red-700 mb-3 flex items-center gap-2">
                <span className="text-lg">✗</span> Exclusion Criteria
              </h3>
              <ul className="space-y-2">
                {trial.exclusionCriteria.map((item, i) => (
                  <li key={i} className="flex gap-2 text-sm text-gray-700">
                    <span className="text-red-400 flex-shrink-0">•</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </section>

      {/* External links (study website; CT.gov already linked above) */}
      {trial.sponsorWebsite && (
        <section className="flex flex-wrap gap-4 text-sm">
          <a
            href={trial.sponsorWebsite}
            target="_blank"
            rel="noopener noreferrer"
            className="text-gray-500 hover:text-purple transition"
          >
            Study website ↗
          </a>
        </section>
      )}
    </main>
  )
}

function InvestigatorBadge({ researcher, name }) {
  const slugValue = researcher?.slug?.current || researcher?.slug
  const href = slugValue ? `/team/${slugValue}` : null
  const displayName = name || researcher?.name

  if (!displayName) return null

  const content = (
    <>
      <Avatar photo={researcher?.photo} name={displayName} />
      <span className="text-purple font-medium text-sm">{displayName}</span>
    </>
  )

  return href ? (
    <Link
      href={href}
      className="inline-flex items-center gap-2 border border-black/[0.08] px-3 py-1.5 hover:border-purple transition-colors bg-white rounded"
    >
      {content}
    </Link>
  ) : (
    <span className="inline-flex items-center gap-2 border border-black/[0.08] px-3 py-1.5 bg-white rounded">
      {content}
    </span>
  )
}

function Avatar({ photo, name }) {
  if (photo) {
    const src = urlFor(photo).width(64).height(64).fit('crop').url()
    return (
      <Image
        src={src}
        alt={name || ''}
        width={24}
        height={24}
        className="h-6 w-6 rounded-full object-cover"
      />
    )
  }
  return (
    <span className="h-6 w-6 rounded-full bg-[#E8E5E0] text-xs flex items-center justify-center text-[#888] font-semibold">
      {name?.slice(0, 1)?.toUpperCase() || '?'}
    </span>
  )
}
