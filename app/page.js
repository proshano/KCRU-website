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
      maxAffiliation: 80
    })
    publications = pubData?.publications || []
    publicationsStats = pubData?.stats || publicationsStats
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
      label: 'Active\nstudies'
    },
    {
      value: publicationsStats.totalPublications || publications.length,
      label: 'Publications in last 3 years'
    },
    { value: '', label: '' },
    { value: '', label: '' },
  ]

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
                    <div className="text-[11px] text-[#888] mt-0.5 font-medium">
                      {researcher.role || 'Researcher'}
                    </div>
                  </Link>
                )
              })}
            </div>
          </div>
        </div>
      </section>

      {/* Stats Bar */}
      <div className="bg-white border-t border-b border-black/[0.06]">
        <div className="max-w-[1400px] mx-auto grid grid-cols-2 lg:grid-cols-4">
          {stats.map((stat, idx) => (
            <div
              key={idx}
              className={`py-7 px-6 md:px-12 flex items-center gap-4 ${
                idx < 3 ? 'border-r border-black/[0.06]' : ''
              } ${idx === 1 ? 'lg:border-r' : ''} ${idx >= 2 ? 'border-t lg:border-t-0 border-black/[0.06]' : ''}`}
            >
              <div className="text-[32px] font-bold text-purple tracking-tight leading-none">
                {stat.value}
              </div>
              <div className="text-[13px] text-[#666] font-medium leading-tight whitespace-pre-line">
                {stat.label}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Publications Ticker */}
      {publications.length > 0 && (
        <div className="ticker-wrapper">
          <div className="ticker">
            {/* First set */}
            {publications.slice(0, 6).map((pub, idx) => (
              <a
                key={`a-${idx}`}
                href={pub.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-3 px-12 whitespace-nowrap text-white text-sm font-medium hover:text-purple-light transition-colors"
              >
                <span className="w-1.5 h-1.5 bg-purple rounded-full flex-shrink-0" />
                <span>
                  <span className="text-purple-light">{pub.year}</span>
                  {' — '}
                  {pub.title?.length > 80 ? pub.title.slice(0, 80) + '...' : pub.title}
                </span>
              </a>
            ))}
            {/* Duplicate for seamless loop */}
            {publications.slice(0, 6).map((pub, idx) => (
              <a
                key={`b-${idx}`}
                href={pub.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-3 px-12 whitespace-nowrap text-white text-sm font-medium hover:text-purple-light transition-colors"
              >
                <span className="w-1.5 h-1.5 bg-purple rounded-full flex-shrink-0" />
                <span>
                  <span className="text-purple-light">{pub.year}</span>
                  {' — '}
                  {pub.title?.length > 80 ? pub.title.slice(0, 80) + '...' : pub.title}
                </span>
              </a>
            ))}
          </div>
        </div>
      )}
    </>
  )
}
