import Image from 'next/image'
import Link from 'next/link'
import { sanityFetch, queries, urlFor } from '@/lib/sanity'
import { getCachedPublicationsDisplay, getPublicationsSinceYear } from '@/lib/publications'
import FeaturedStudy from './components/FeaturedStudy'

export const revalidate = 600

export default async function HomePage() {
  const [settingsRaw, trialsRaw = [], researchersRaw = [], newsRaw = []] = await Promise.all([
    sanityFetch(queries.siteSettings),
    sanityFetch(queries.trialSummaries),
    sanityFetch(queries.allResearchers),
    sanityFetch(queries.recentNews),
  ])

  // Strip ALL Sanity data to plain JSON to break any circular references
  const settings = JSON.parse(JSON.stringify(settingsRaw || {}))
  const trials = JSON.parse(JSON.stringify(trialsRaw || []))
  const researchers = JSON.parse(JSON.stringify(researchersRaw || []))
  const news = JSON.parse(JSON.stringify(newsRaw || []))

  const normalizeCategory = (category) => {
    const value = (category || '').toString().toLowerCase()
    if (!value || value === 'investigator' || value === 'clinical') return 'clinical'
    if (value === 'phd' || value === 'phd scientist' || value === 'phd_scientist') return 'phd'
    if (value === 'staff' || value === 'research staff') return 'staff'
    return 'clinical'
  }

  const normalizedResearchers = (researchers || []).map(r => ({
    ...r,
    category: normalizeCategory(r.category)
  }))

  const clinicalInvestigators = normalizedResearchers.filter(r => r.category === 'clinical')
  const featuredResearchers = clinicalInvestigators.length > 0 ? clinicalInvestigators : normalizedResearchers

  // Get publications for the ticker and cached stats - strip researchers to plain objects to avoid circular refs
  let publications = []
  let publicationsStats = { totalPublications: 0 }
  let provenance = {}
  try {
    const strippedResearchers = (normalizedResearchers || []).map(r => ({
      _id: r._id,
      name: r.name,
      pubmedQuery: r.pubmedQuery
    }))
    const pubData = await getCachedPublicationsDisplay({
      researchers: strippedResearchers,
      maxPerResearcher: 1000,
      summariesPerRun: Infinity,
      llmOptions: {
        provider: settings.llmProvider || 'openrouter',
        model: settings.llmModel,
        apiKey: settings.llmApiKey,
        systemPrompt: settings.llmSystemPrompt
      }
    })
    // Filter out excluded publications (corrections, errata, etc.) for accurate counts
    publications = (pubData?.publications || []).filter(pub => pub.exclude !== true)
    publicationsStats = { totalPublications: publications.length }
    provenance = pubData?.provenance || {}
  } catch (e) {
    console.error('Failed to fetch publications:', e)
  }

  // Filter trials by status
  const recruitingTrials = trials.filter(t => t.status === 'recruiting')
  const activeTrials = trials.filter(t => 
    t.status === 'recruiting' || 
    t.status === 'coming_soon' || 
    t.status === 'active_not_recruiting' ||
    t.status === 'closed' // legacy status
  )

  const tagline = settings?.tagline?.trim() || 'Fighting kidney disease through research.'
  const taglineHighlight = settings?.taglineHighlight?.trim()
  const taglineHighlights = Array.isArray(settings?.taglineHighlights)
    ? settings.taglineHighlights.map(h => h?.trim()).filter(Boolean)
    : []

  const renderTagline = () => {
    const highlights = []
    if (taglineHighlight) highlights.push(taglineHighlight)
    highlights.push(...taglineHighlights)

    if (!highlights.length) return tagline

    let parts = [tagline]

    highlights.forEach(highlight => {
      const nextParts = []
      parts.forEach(part => {
        if (typeof part !== 'string') {
          nextParts.push(part)
          return
        }

        if (!part.includes(highlight)) {
          nextParts.push(part)
          return
        }

        const splitParts = part.split(highlight)
        splitParts.forEach((p, idx) => {
          if (p) nextParts.push(p)
          if (idx < splitParts.length - 1) {
            nextParts.push(
              <span key={`${highlight}-${idx}-${nextParts.length}`} className="text-purple">
                {highlight}
              </span>
            )
          }
        })
      })
      parts = nextParts
    })

    return parts
  }

  // Stats from data
  const publicationsSinceYear = getPublicationsSinceYear()
  const stats = [
    {
      value: activeTrials.length,
      label: 'Active studies',
      href: '/trials'
    },
    {
      value: publicationsStats.totalPublications || publications.length,
      label: `Publications since ${publicationsSinceYear}`,
      href: '/publications'
    }
  ]

  const formatPublishedLabel = pub => {
    if (pub?.publishedAt) {
      const dt = new Date(pub.publishedAt)
      if (!Number.isNaN(dt.getTime())) {
        return dt.toLocaleString('en-US', { month: 'short', year: 'numeric' })
      }
    }
    if (pub?.year) return pub.year
    return 'Recent'
  }

  // Sort publications by year (most recent first), then by number of investigators (more first)
  const investigatorLookup = new Map((normalizedResearchers || []).map(r => [r._id, r.name]))
  const sortedPubs = [...(publications || [])].sort((a, b) => {
    const yearA = parseInt(a.year, 10) || 0
    const yearB = parseInt(b.year, 10) || 0
    if (yearB !== yearA) return yearB - yearA  // newest first
    
    // Within same year, prioritize papers with more investigators for variety
    const invCountA = (provenance?.[a.pmid] || []).length
    const invCountB = (provenance?.[b.pmid] || []).length
    return invCountB - invCountA
  })
  
  const tickerItems = sortedPubs.slice(0, 20).map(pub => {
    // Get all investigators linked to this publication from provenance
    const linkedInvestigators = (provenance?.[pub.pmid] || [])
      .map(id => investigatorLookup.get(id))
      .filter(Boolean)
    
    return {
      ...pub,
      investigators: linkedInvestigators
    }
  })

  return (
    <>
      {/* Hero Section */}
      <section className="px-6 md:px-12 pt-12 pb-4 max-w-[1400px] mx-auto">
        <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-start">
          {/* Left side - Hero content */}
          <div className="flex flex-col">
            <h1 className="text-4xl sm:text-5xl font-bold leading-[1.1] tracking-tight mb-5">
              {renderTagline()}
            </h1>
            <p className="text-[17px] leading-relaxed text-[#555] max-w-[440px] mb-8">
              {settings?.description || 'We conduct large pragmatic trials focused on patients with kidney failure—a population facing exceptional risks yet underrepresented in medical evidence.'}
            </p>

            {/* CTA Buttons */}
            <div className="flex gap-3.5 mb-0">
              <Link href="/trials" className="btn-primary text-center flex-1">
                View Active Studies
              </Link>
              <Link href="/contact?reason=donation" className="btn-secondary text-center flex-1">
                Donate
              </Link>
              <Link href="/contact?reason=industry" className="btn-secondary text-center flex-1">
                Partner With Us
              </Link>
            </div>

            {/* Featured Study Card */}
            {recruitingTrials.length > 0 && (
              <FeaturedStudy trials={recruitingTrials} />
            )}

            {/* Inline stats below featured study */}
            <div className="mt-6 bg-white border border-black/[0.07] rounded-xl shadow-sm overflow-hidden">
              <div className="grid grid-cols-1 sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x divide-black/[0.06]">
                {stats.map((stat, idx) => (
                  <Link
                    key={idx}
                    href={stat.href}
                    className="flex flex-col items-center justify-center text-center transition hover:bg-purple/[0.05] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple focus-visible:ring-offset-2 focus-visible:ring-offset-white"
                    style={{ padding: '32px 24px' }}
                  >
                    <div style={{ fontSize: 48, fontWeight: 700, color: 'var(--color-purple)', letterSpacing: '-0.02em', lineHeight: 1, marginBottom: 8 }}>
                      {stat.value}
                    </div>
                    <div style={{ fontSize: 18, color: '#666', fontWeight: 500, lineHeight: 1.3 }}>
                      {stat.label}
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          </div>

          {/* Right side - Team showcase */}
          <div>
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-sm font-semibold text-[#888] uppercase tracking-[0.08em]">
                Clinical Investigators
              </h2>
              <Link href="/team" className="arrow-link text-[13px]">
                All profiles
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M5 12h14M12 5l7 7-7 7"/>
                </svg>
              </Link>
            </div>

            {/* Team Grid - 4x3 */}
            <div className="grid grid-cols-4 gap-x-3 gap-y-2">
              {featuredResearchers.slice(0, 12).map((researcher) => {
                const slugValue = typeof researcher.slug === 'string' ? researcher.slug : researcher.slug?.current
                const href = slugValue ? `/team/${slugValue}` : '/team'
                const initials = researcher.name
                  ?.split(' ')
                  .map(n => n[0])
                  .join('')
                  .slice(0, 2)
                  .toUpperCase() || '?'

                return (
                  <Link key={researcher._id} href={href} className="team-member flex flex-col items-center">
                    <div className="team-photo" style={{ width: 135, height: 135 }}>
                      {researcher.photo ? (
                        <Image
                          src={urlFor(researcher.photo).width(170).height(170).fit('crop').url()}
                          alt={researcher.name || 'Researcher'}
                          width={135}
                          height={135}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <span className="text-[24px] font-semibold text-[#aaa]">{initials}</span>
                      )}
                    </div>
                    <div className="hidden sm:block text-[13px] font-semibold text-[#1a1a1a] whitespace-nowrap overflow-hidden text-ellipsis text-center">
                      {researcher.name}
                    </div>
                  </Link>
                )
              })}
            </div>

            {/* Investigator Affiliations */}
            {settings?.affiliations?.length > 0 && (
              <div className="mt-6">
                <h3 className="text-sm font-semibold text-[#888] uppercase tracking-[0.08em] mb-1">
                  Investigator Affiliations
                </h3>
                <div
                  className="flex flex-wrap items-center justify-center"
                  style={{ columnGap: 28, rowGap: 12 }}
                >
                  {settings.affiliations.map((affiliation, idx) => {
                    // Check if logo exists and has an asset reference
                    const hasValidLogo = affiliation.logo && affiliation.logo.asset && affiliation.logo.asset._ref
                    if (!hasValidLogo) return null
                    
                    // Parse the asset reference to build the URL
                    // Format: image-{id}-{dimensions}-{format}
                    const ref = affiliation.logo.asset._ref
                    const [, id, dimensions, format] = ref.split('-')
                    const isSvg = format === 'svg'
                    
                    let logoUrl
                    if (isSvg) {
                      // For SVGs, construct the CDN URL directly
                      logoUrl = `https://cdn.sanity.io/images/${process.env.NEXT_PUBLIC_SANITY_PROJECT_ID}/${process.env.NEXT_PUBLIC_SANITY_DATASET}/${id}-${dimensions}.${format}`
                    } else {
                      try {
                        logoUrl = urlFor(affiliation.logo).url()
                      } catch (e) {
                        console.error('Failed to generate logo URL for:', affiliation.name, e)
                        return null
                      }
                    }
                    
                    const logoImage = (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={logoUrl}
                        alt={affiliation.name || 'Affiliation'}
                        style={{ objectFit: 'contain', width: 'auto', height: 'auto', maxWidth: 140, maxHeight: 60 }}
                      />
                    )
                    return affiliation.url ? (
                      <a
                        key={idx}
                        href={affiliation.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="hover:opacity-70 transition-opacity"
                      >
                        {logoImage}
                      </a>
                    ) : (
                      <div key={idx}>{logoImage}</div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

	      {/* Publications Ticker */}
	      {tickerItems.length > 0 && (
	        <>
	        <style>{`
	          @keyframes tickerAnim {
	            0% { transform: translate3d(0, 0, 0); }
	            100% { transform: translate3d(-50%, 0, 0); }
	          }
	          @-webkit-keyframes tickerAnim {
	            0% { transform: translate3d(0, 0, 0); }
	            100% { transform: translate3d(-50%, 0, 0); }
	          }
	          .ticker-track {
	            display: flex;
	            gap: 20px;
	            padding: 4px 48px 8px;
	            width: max-content;
	            min-width: 100%;
	            animation: tickerAnim 70s linear infinite;
	            -webkit-animation: tickerAnim 70s linear infinite;
	            animation-play-state: running;
	            will-change: transform;
	          }
	          .ticker-track:hover,
	          .ticker-track:focus-within {
	            animation-play-state: paused;
	            -webkit-animation-play-state: paused;
	          }
	          @media (max-width: 768px) {
	            .ticker-track {
	              animation-duration: 55s;
	              -webkit-animation-duration: 55s;
	            }
	          }
	          @media (prefers-reduced-motion: reduce) {
	            .ticker-track {
	              animation-duration: 140s;
	              -webkit-animation-duration: 140s;
	            }
	          }
	          .ticker-card {
	            display: flex;
	            flex-direction: column;
	            gap: 6px;
            width: 320px;
            min-width: 320px;
            padding: 14px 18px;
            border-radius: 10px;
            background: #2a2a2a;
            border: 1px solid #444;
            text-decoration: none;
            flex-shrink: 0;
            transition: transform 140ms ease, box-shadow 160ms ease, border-color 140ms ease;
          }
          .ticker-card:hover,
          .ticker-card:focus-visible {
            transform: translateY(-2px) scale(1.02);
            box-shadow: 0 12px 28px rgba(0, 0, 0, 0.35);
            border-color: #6c4ba5;
            outline: none;
          }
          .ticker-card:active {
            transform: translateY(0) scale(0.99);
          }
          .ticker-title {
            font-size: 13px;
            font-weight: 600;
            line-height: 1.35;
            color: #ffffff;
          }
          .ticker-journal {
            font-size: 10px;
            font-weight: 600;
            color: #B8A0D2;
            letter-spacing: 0.02em;
          }
          .ticker-authors {
            font-size: 11px;
            color: #888;
            line-height: 1.4;
          }
        `}</style>
        <div style={{ background: '#1a1a1a', padding: '10px 0', overflow: 'hidden' }}>
          <div style={{ color: '#666', fontSize: '10px', fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', margin: '0 0 10px 48px' }}>
            Recent research
          </div>
          <div className="ticker-track">
            {[0, 1].map(loop => (
              tickerItems.map((pub, idx) => {
                const investigatorsLabel = (pub.investigators || []).join(', ')
                const pubUrl = pub?.url || (pub?.pmid ? `https://pubmed.ncbi.nlm.nih.gov/${pub.pmid}/` : '#')
                return (
                  <a
                    key={`${loop}-${pub.pmid || idx}`}
                    href={pubUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="ticker-card"
                  >
                    <div className="ticker-title">
                      {pub.title}
                    </div>
                    {pub.journal && (
                      <div className="ticker-journal">
                        {pub.journal}
                      </div>
                    )}
                    {investigatorsLabel && (
                      <div className="ticker-authors">
                        {investigatorsLabel}
                      </div>
                    )}
                  </a>
                )
              })
            ))}
          </div>
        </div>
        </>
      )}
    </>
  )
}
