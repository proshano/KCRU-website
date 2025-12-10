import Image from 'next/image'
import Link from 'next/link'
import { sanityFetch, queries, urlFor } from '@/lib/sanity'
import { getCachedPublicationsDisplay } from '@/lib/publications'
import FeaturedStudy from './components/FeaturedStudy'

export const revalidate = 3600

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

  // Get publications for the ticker and cached stats - strip researchers to plain objects to avoid circular refs
  let publications = []
  let publicationsStats = { totalPublications: 0 }
  let provenance = {}
  try {
    const strippedResearchers = (researchers || []).map(r => ({
      _id: r._id,
      name: r.name,
      pubmedQuery: r.pubmedQuery
    }))
    const pubData = await getCachedPublicationsDisplay({
      researchers: strippedResearchers,
      affiliation: settings?.pubmedAffiliation || '',
      maxPerResearcher: 120,
      maxAffiliation: 80,
      summariesPerRun: Infinity,
      llmOptions: {
        provider: settings.llmProvider || 'openrouter',
        model: settings.llmModel,
        apiKey: settings.llmApiKey,
        systemPrompt: settings.llmSystemPrompt
      }
    })
    publications = pubData?.publications || []
    publicationsStats = pubData?.stats || publicationsStats
    provenance = pubData?.provenance || {}
  } catch (e) {
    console.error('Failed to fetch publications:', e)
  }

  // Filter recruiting trials for featured study
  const recruitingTrials = trials.filter(t => t.status === 'recruiting')

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
  const stats = [
    {
      value: recruitingTrials.length || trials.length,
      label: 'Active studies',
      href: '/trials'
    },
    {
      value: publicationsStats.totalPublications || publications.length,
      label: 'Publications in last 3 years',
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
  const investigatorLookup = new Map((researchers || []).map(r => [r._id, r.name]))
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
      <section className="px-6 md:px-12 pt-12 pb-6 max-w-[1400px] mx-auto">
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
              <Link href="/contact" className="btn-secondary text-center flex-1">
                Refer a Patient
              </Link>
              <Link href="/capabilities" className="btn-secondary text-center flex-1">
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
                    className="px-6 py-5 flex items-center gap-4 transition hover:bg-purple/[0.05] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple focus-visible:ring-offset-2 focus-visible:ring-offset-white"
                  >
                    <div className="text-[32px] font-bold text-purple tracking-tight leading-none">
                      {stat.value}
                    </div>
                    <div className="text-[13px] text-[#666] font-medium leading-tight whitespace-pre-line">
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
                Investigators
              </h2>
              <Link href="/team" className="arrow-link text-[13px]">
                All profiles
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M5 12h14M12 5l7 7-7 7"/>
                </svg>
              </Link>
            </div>

            {/* Team Grid - 4x3 */}
            <div className="grid grid-cols-4 gap-5">
              {researchers.slice(0, 12).map((researcher) => {
                const slugValue = typeof researcher.slug === 'string' ? researcher.slug : researcher.slug?.current
                const href = slugValue ? `/team/${slugValue}` : '/team'
                const initials = researcher.name
                  ?.split(' ')
                  .map(n => n[0])
                  .join('')
                  .slice(0, 2)
                  .toUpperCase() || '?'

                return (
                  <Link key={researcher._id} href={href} className="team-member">
                    <div className="team-photo">
                      {researcher.photo ? (
                        <Image
                          src={urlFor(researcher.photo).width(140).height(140).fit('crop').url()}
                          alt={researcher.name || 'Researcher'}
                          width={140}
                          height={140}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <span className="text-[22px] font-semibold text-[#aaa]">{initials}</span>
                      )}
                    </div>
                    <div className="text-[13px] font-semibold text-[#1a1a1a] whitespace-nowrap overflow-hidden text-ellipsis">
                      {researcher.name}
                    </div>
                  </Link>
                )
              })}
            </div>
          </div>
        </div>
      </section>

      {/* Publications Ticker */}
      {tickerItems.length > 0 && (
        <>
        <style>{`
          @keyframes tickerAnim {
            0% { transform: translateX(0); }
            100% { transform: translateX(-50%); }
          }
        `}</style>
        <div style={{ background: '#1a1a1a', padding: '16px 0', overflow: 'hidden' }}>
          <div style={{ color: '#666', fontSize: '10px', fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', margin: '0 0 12px 48px' }}>
            Recent research
          </div>
          <div style={{ display: 'flex', gap: '20px', padding: '4px 48px 12px', animation: 'tickerAnim 60s linear infinite' }}>
            {[0, 1].map(loop => (
              tickerItems.map((pub, idx) => {
                const investigatorsLabel = (pub.investigators || []).join(', ')
                return (
                  <a
                    key={`${loop}-${pub.pmid || idx}`}
                    href={pub.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '6px',
                      width: '320px',
                      minWidth: '320px',
                      padding: '14px 18px',
                      borderRadius: '10px',
                      background: '#2a2a2a',
                      border: '1px solid #444',
                      textDecoration: 'none',
                      flexShrink: 0
                    }}
                  >
                    <div style={{ fontSize: '13px', fontWeight: 600, lineHeight: 1.35, color: '#ffffff' }}>
                      {pub.title}
                    </div>
                    {pub.journal && (
                      <div style={{ fontSize: '10px', fontWeight: 600, color: '#B8A0D2', letterSpacing: '0.02em' }}>
                        {pub.journal}
                      </div>
                    )}
                    {investigatorsLabel && (
                      <div style={{ fontSize: '11px', color: '#888', lineHeight: 1.4 }}>
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
