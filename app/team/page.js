import Image from 'next/image'
import Link from 'next/link'
import { sanityFetch, queries, urlFor } from '@/lib/sanity'
import { buildOpenGraph, buildTwitterMetadata, normalizeDescription, resolveSiteTitle } from '@/lib/seo'

export const revalidate = 3600 // 1 hour

export async function generateMetadata() {
  const [settingsRaw, pageContentRaw] = await Promise.all([
    sanityFetch(queries.siteSettings),
    sanityFetch(queries.pageContent)
  ])

  const settings = JSON.parse(JSON.stringify(settingsRaw || {}))
  const content = JSON.parse(JSON.stringify(pageContentRaw || {}))
  const siteTitle = resolveSiteTitle(settings)
  const title = content.teamTitle || 'Team'
  const description = normalizeDescription(
    content.teamDescription || `Meet the team at ${siteTitle}.`
  )
  const canonical = '/team'

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

export default async function TeamPage() {
  const [researchersRaw, pageContentRaw] = await Promise.all([
    sanityFetch(queries.allResearchers),
    sanityFetch(queries.pageContent)
  ])
  // Strip Sanity data to plain JSON to break any circular references
  const researchers = JSON.parse(JSON.stringify(researchersRaw || []))
  const content = JSON.parse(JSON.stringify(pageContentRaw || {}))

  // Page content with fallbacks
  const eyebrow = content.teamEyebrow || 'Our Team'
  const title = content.teamTitle || ''
  const description = content.teamDescription || ''

  const normalizeCategory = (category) => {
    const value = (category || '').toString().toLowerCase()
    if (!value || value === 'investigator' || value === 'clinical') return 'clinical'
    if (value === 'phd' || value === 'phd scientist' || value === 'phd_scientist') return 'phd'
    if (value === 'staff' || value === 'research staff') return 'staff'
    return 'clinical'
  }

  const normalizedResearchers = (researchers || []).map(person => ({
    ...person,
    category: normalizeCategory(person.category)
  }))

  const grouped = {
    clinical: [],
    phd: [],
    staff: []
  }

  normalizedResearchers.forEach(person => {
    const category = normalizeCategory(person.category)
    if (grouped[category]) {
      grouped[category].push(person)
    } else {
      grouped.clinical.push(person)
    }
  })

  const sections = [
    { key: 'clinical', title: 'Clinical Investigators' },
    { key: 'phd', title: 'PhD Scientists' },
    { key: 'staff', title: 'Research Staff' }
  ]

  const computeArcPositions = (count) => {
    const visibleCount = Math.min(count, 4)
    if (visibleCount <= 0) return []

    // Compute positions relative to the photo itself so it stays correct regardless
    // of grid column width. We stagger tags along an arc, keeping pills horizontal.
    // Anchor on the photo's right edge so pills never overlap the portrait.
    const edgeGap = 0
    const ySpread = visibleCount === 1 ? 0 : 46
    const xBump = 8

    return Array.from({ length: visibleCount }).map((_, idx) => {
      const t = visibleCount === 1 ? 0.5 : idx / (visibleCount - 1)
      const y = (t - 0.5) * 2 * ySpread
      const norm = ySpread === 0 ? 0 : Math.abs(y) / ySpread
      const x = edgeGap + xBump * (1 - norm * norm)

      return {
        x,
        y
      }
    })
  }

  return (
    <main className="max-w-[1600px] mx-auto px-6 md:px-12 py-12 space-y-8">
      <header>
        <h2 className="text-sm font-semibold text-[#888] uppercase tracking-[0.08em] mb-2">
          {eyebrow}
        </h2>
        {title && (
          <h1 className="text-4xl font-bold tracking-tight">{title}</h1>
        )}
        {description && (
          <p className="text-[#666] mt-3 max-w-2xl">{description}</p>
        )}
      </header>

      {(!normalizedResearchers || normalizedResearchers.length === 0) && (
        <p className="text-[#666]">No team members found yet.</p>
      )}

      {normalizedResearchers.length > 0 && sections.map(section => {
        const list = grouped[section.key] || []
        if (list.length === 0) return null

        return (
          <section key={section.key} className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-2xl font-bold tracking-tight">{section.title}</h2>
            </div>
            <div className="grid gap-x-6 gap-y-6 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4">
              {list.map((person) => {
                const slugValue = typeof person.slug === 'string' ? person.slug : person.slug?.current
                const href = slugValue ? `/team/${slugValue}` : null
                const initials = person.name
                  ?.split(' ')
                  .map(n => n[0])
                  .join('')
                  .slice(0, 2)
                  .toUpperCase() || '?'

                // Get research tags for this person
                const visibleTags = (person.researchTags || []).filter(Boolean).slice(0, 4)
                const arcPositions = computeArcPositions(visibleTags.length)

                const cardBody = (
                  <div className="team-member">
                    <div className="relative w-full flex pt-1">
                      {/* Photo and name wrapper - keeps name centered under photo */}
                      <div className="flex flex-col items-center">
                        <div className="relative" style={{ width: '132px', height: '132px' }}>
                          {visibleTags.length > 0 && (
                            <div className="absolute inset-0 pointer-events-none z-0">
                              {visibleTags.map((tag, idx) => {
                                const position = arcPositions[idx]
                                return (
                                  <span
                                    key={idx}
                                    className="absolute inline-block px-2.5 py-1 text-xs font-medium rounded-full bg-purple/10 text-purple shadow-sm whitespace-nowrap"
                                    style={{
                                      top: `calc(50% + ${position?.y ?? 0}px)`,
                                      left: `calc(100% + ${position?.x ?? 0}px)`,
                                      transform: 'translate(0, -50%)'
                                    }}
                                  >
                                    {tag}
                                  </span>
                                )
                              })}
                            </div>
                          )}
                          <div
                            className="team-photo relative z-10"
                            style={{ width: '132px', height: '132px' }}
                          >
                            {person.photo ? (
                              <Image
                                src={urlFor(person.photo).width(165).height(165).fit('crop').url()}
                                alt={person.name || 'Researcher'}
                                width={165}
                                height={165}
                                className="w-full h-full object-cover"
                              />
                            ) : (
                              <span className="text-[24px] font-semibold text-[#aaa]">{initials}</span>
                            )}
                          </div>
                        </div>
                        <div className="text-sm font-semibold text-[#1a1a1a] mt-2 whitespace-nowrap text-center">
                          {person.name}
                        </div>
                      </div>
                    </div>
                  </div>
                )

                const social = <SocialLinks key={`${person._id}-social`} person={person} />

                return href ? (
                  <div key={person._id} className="flex flex-col">
                    <Link href={href}>{cardBody}</Link>
                    {social}
                  </div>
                ) : (
                  <div key={person._id} className="flex flex-col">
                    {cardBody}
                    {social}
                  </div>
                )
              })}
            </div>
          </section>
        )
      })}
    </main>
  )
}

function SocialLinks({ person }) {
  const hasLinks = person.twitter || person.linkedin
  if (!hasLinks) return null
  return (
    <div className="flex flex-wrap gap-2 mt-2 text-xs text-purple font-medium">
      {person.twitter && (
        <a
          href={`https://twitter.com/${person.twitter.replace('@', '')}`}
          target="_blank"
          rel="noopener noreferrer"
          className="hover:underline"
        >
          X
        </a>
      )}
      {person.linkedin && (
        <a
          href={person.linkedin}
          target="_blank"
          rel="noopener noreferrer"
          className="hover:underline"
        >
          LinkedIn
        </a>
      )}
    </div>
  )
}
