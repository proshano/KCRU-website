import Image from 'next/image'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { sanityFetch, queries, urlFor } from '@/lib/sanity'
import { getCachedPublicationsDisplay, getPublicationsSinceYear } from '@/lib/publications'
import PublicationsBrowser from '@/app/publications/PublicationsBrowser'

export const revalidate = 86400 // use cache; refresh daily

function formatGeneratedAt(ts) {
  if (!ts) return null
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/New_York',
      year: 'numeric',
      month: 'short',
      day: '2-digit',
    }).format(new Date(ts))
  } catch (err) {
    console.error('Failed to format generatedAt', err)
    return null
  }
}

export default async function TeamMemberPage({ params }) {
  const resolvedParams = await params
  const slugRaw = resolvedParams?.slug
  const slug = typeof slugRaw === 'string' ? decodeURIComponent(slugRaw).replace(/^\/+|\/+$/g, '') : ''
  if (!slug) return notFound()
  const slugLower = slug.toLowerCase()
  const slugPattern = `^${slugLower}$`

  const [profileRaw, researchersRaw, settingsRaw] = await Promise.all([
    sanityFetch(queries.researcherBySlug, { slug, slugLower, slugPattern }),
    sanityFetch(queries.allResearchers),
    sanityFetch(queries.siteSettings),
  ])
  if (!profileRaw) return notFound()

  // Strip Sanity data to plain JSON to break any circular references
  const profile = JSON.parse(JSON.stringify(profileRaw))
  const researchers = JSON.parse(JSON.stringify(researchersRaw || []))
  const settings = JSON.parse(JSON.stringify(settingsRaw || {}))
  const altmetricEnabled = settings?.altmetric?.enabled === true

  // Extract only the fields needed for publications to avoid circular references
  const strippedResearchers = (researchers || []).map(r => ({
    _id: r._id,
    name: r.name,
    slug: r.slug,
    pubmedQuery: r.pubmedQuery
  }))
  let publicationsBundle = null
  if (profile.pubmedQuery) {
    try {
      const fullBundle = await getCachedPublicationsDisplay({
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
      const researcherPubs = filterPublicationsForResearcher(fullBundle, profile._id, profile.name)
      // Filter out excluded publications (corrections, errata, etc.)
      const filteredPubs = researcherPubs.filter(pub => pub.exclude !== true)
      const display = buildDisplayFromPublications(filteredPubs)
      publicationsBundle = {
        ...display,
        provenance: fullBundle?.provenance || {},
        meta: fullBundle?.meta || {},
      }
    } catch (err) {
      console.error('Failed to load publications for researcher', profile.name, err)
      publicationsBundle = {
        publications: [],
        byYear: {},
        years: [],
        provenance: {},
        stats: { totalPublications: 0, yearsSpan: null }
      }
    }
  }

  const initials = profile.name
    ?.split(' ')
    .map(n => n[0])
    .join('')
    .slice(0, 2)
    .toUpperCase() || '?'

  return (
    <main className="py-12 space-y-10">
      {/* Profile header and bio - narrow */}
      <div className="max-w-[900px] mx-auto px-6 md:px-12 space-y-10">
        <div className="flex flex-wrap gap-8 items-start">
          <div className="w-40 h-40 rounded-full bg-[#E8E5E0] overflow-hidden flex-shrink-0 flex items-center justify-center">
            {profile.photo ? (
              <Image
                src={urlFor(profile.photo).width(240).height(240).fit('crop').url()}
                alt={profile.name}
                width={160}
                height={160}
                className="w-full h-full object-cover"
              />
            ) : (
              <span className="text-4xl font-semibold text-[#aaa]">{initials}</span>
            )}
          </div>
          <div className="space-y-3 flex-1">
            <div>
              <h1 className="text-4xl font-bold tracking-tight">{profile.name}</h1>
              {profile.role && <p className="text-lg text-[#666] mt-1">{profile.role}</p>}
            </div>
            <div className="flex flex-wrap gap-3 text-sm font-medium">
              {profile.email && (
                <a className="text-purple hover:underline" href={`mailto:${profile.email}`}>
                  Email
                </a>
              )}
              {profile.twitter && (
                <a className="text-purple hover:underline" href={`https://twitter.com/${profile.twitter.replace('@', '')}`} target="_blank" rel="noopener noreferrer">
                  X / Twitter
                </a>
              )}
              {profile.linkedin && (
                <a className="text-purple hover:underline" href={profile.linkedin} target="_blank" rel="noopener noreferrer">
                  LinkedIn
                </a>
              )}
              {profile.orcid && (
                <a className="text-purple hover:underline" href={`https://orcid.org/${profile.orcid.replace('https://orcid.org/', '')}`} target="_blank" rel="noopener noreferrer">
                  ORCID
                </a>
              )}
            </div>
          </div>
        </div>

        {profile.bio && (
          <section className="space-y-3">
            <h2 className="text-xl font-bold tracking-tight">Biography</h2>
            <p className="text-[#555] leading-relaxed whitespace-pre-line max-w-3xl">{profile.bio}</p>
          </section>
        )}
      </div>

      {/* Active Studies and Publications - wide */}
      <div className="max-w-[1400px] mx-auto px-6 md:px-12 space-y-10">
        <StudiesSection studies={profile.studies} />

        <PublicationsSection
          publicationsBundle={publicationsBundle}
          hasQuery={Boolean(profile.pubmedQuery)}
          altmetricEnabled={altmetricEnabled}
          researchers={(researchers || []).map(r => ({
            _id: r._id,
            name: r.name,
            slug: r.slug,
            photo: r.photo
          }))}
        />

        <div>
          <Link href="/team" className="arrow-link text-[13px]">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="rotate-180">
              <path d="M5 12h14M12 5l7 7-7 7"/>
            </svg>
            Back to team
          </Link>
        </div>
      </div>
    </main>
  )
}

function PublicationsSection({ publicationsBundle, hasQuery, researchers, altmetricEnabled }) {
  if (!hasQuery) {
    return (
      <section className="space-y-3">
        <h2 className="text-xl font-bold tracking-tight">Publications</h2>
        <p className="text-[#666] text-sm">Add a PubMed query in Sanity to show this researcher&apos;s publications.</p>
      </section>
    )
  }

  const publications = publicationsBundle?.publications || []
  const total = publications.length
  const sinceYear = getPublicationsSinceYear()
  const provenance = publicationsBundle?.provenance || {}
  const generatedAt = publicationsBundle?.meta?.generatedAt

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="space-y-1">
          <h2 className="text-xl font-bold tracking-tight">Publications (since {sinceYear})</h2>
          <p className="text-xs text-[#888]">
              {generatedAt ? `Updated ${formatGeneratedAt(generatedAt)}` : 'Cache not yet generated'}
          </p>
        </div>
      </div>

      {total === 0 && (
        <p className="text-[#666] text-sm">No publications found since {sinceYear} for the current PubMed query.</p>
      )}

      {total > 0 && (
        <PublicationsBrowser
          publications={publications}
          researchers={researchers}
          provenance={provenance}
          altmetricEnabled={altmetricEnabled}
          hideYearCounts
        />
      )}
    </section>
  )
}

function filterPublicationsForResearcher(bundle, researcherId, researcherName) {
  if (!bundle) return []
  const provenance = bundle.provenance || {}
  const pubs = bundle.publications || []
  const fromProvenance = pubs.filter(pub => (provenance[pub.pmid] || []).includes(researcherId))
  if (fromProvenance.length > 0) return fromProvenance

  if (!researcherName) return []
  const name = researcherName.toLowerCase()
  const last = name.split(' ').slice(-1)[0]
  return pubs.filter(pub => {
    const authors = (pub.authors || []).map(a => a.toLowerCase())
    return authors.some(a => a.includes(name) || a.includes(last))
  })
}

function buildDisplayFromPublications(publications = []) {
  const pubs = [...publications].sort((a, b) => {
    const yearDiff = (b.year || 0) - (a.year || 0)
    if (yearDiff !== 0) return yearDiff
    const pmidA = parseInt(a.pmid, 10)
    const pmidB = parseInt(b.pmid, 10)
    if (!Number.isNaN(pmidA) && !Number.isNaN(pmidB)) {
      return pmidB - pmidA // higher pmid tends to be newer
    }
    return (a.title || '').localeCompare(b.title || '')
  })

  const byYear = pubs.reduce((acc, pub) => {
    const year = pub.year || 'Unknown'
    if (!acc[year]) acc[year] = []
    acc[year].push(pub)
    return acc
  }, {})

  return {
    publications: pubs,
    byYear,
    years: Object.keys(byYear).sort((a, b) => b - a)
  }
}

function StudiesSection({ studies }) {
  const list = studies || []
  
  // Separate by status
  const recruiting = list.filter(s => s.status === 'recruiting')
  const other = list.filter(s => s.status !== 'recruiting')
  const sortedList = [...recruiting, ...other]
  
  return (
    <section className="space-y-4">
      <div className="flex items-center gap-3">
        <h2 className="text-xl font-bold tracking-tight">
          Active Clinical Studies
        </h2>
        {list.length > 0 && (
          <span className="text-sm text-[#888]">({list.length})</span>
        )}
      </div>
      {list.length === 0 ? (
        <p className="text-[#666] text-sm">No studies currently linked to this researcher.</p>
      ) : (
        <div className="border border-black/[0.06] bg-white divide-y divide-black/[0.06]">
          {sortedList.map((study) => (
            <StudyItem key={study._id} study={study} />
          ))}
        </div>
      )}
    </section>
  )
}

function StudyItem({ study }) {
  const slugValue = study.slug?.current || study.slug
  const hasDetailPage = !!slugValue
  
  return (
    <article className="px-5 py-3 hover:bg-[#fafafa] transition-colors">
      <div className="flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <h3 className="text-base font-semibold leading-snug">
            {hasDetailPage ? (
              <Link href={`/trials/${slugValue}`} className="text-[#1a1a1a] hover:text-purple transition-colors">
                {study.title}
              </Link>
            ) : (
              <span className="text-[#1a1a1a]">{study.title}</span>
            )}
          </h3>
        </div>
        
        {/* Status badge */}
        {study.status && (
          <span className={`text-[11px] px-2.5 py-1 rounded-full font-medium whitespace-nowrap flex-shrink-0 ${statusStyles[study.status] || statusStyles.completed}`}>
            {prettyStatus(study.status)}
          </span>
        )}
      </div>
    </article>
  )
}

const statusStyles = {
  recruiting: 'text-emerald-800 bg-emerald-50 ring-1 ring-emerald-200',
  coming_soon: 'text-amber-800 bg-amber-50 ring-1 ring-amber-200',
  active_not_recruiting: 'text-purple bg-purple/10 ring-1 ring-purple/30',
  completed: 'text-[#666] bg-[#f5f5f5] ring-1 ring-[#ddd]',
  // Legacy ClinicalTrials.gov values
  RECRUITING: 'text-emerald-800 bg-emerald-50 ring-1 ring-emerald-200',
  NOT_YET_RECRUITING: 'text-amber-800 bg-amber-50 ring-1 ring-amber-200',
  ACTIVE_NOT_RECRUITING: 'text-purple bg-purple/10 ring-1 ring-purple/30',
  COMPLETED: 'text-[#666] bg-[#f5f5f5] ring-1 ring-[#ddd]',
}

function prettyStatus(status) {
  const map = {
    recruiting: 'Recruiting',
    coming_soon: 'Coming Soon',
    active_not_recruiting: 'Active, Not Recruiting',
    completed: 'Completed',
    // Legacy ClinicalTrials.gov values
    RECRUITING: 'Recruiting',
    NOT_YET_RECRUITING: 'Coming Soon',
    ACTIVE_NOT_RECRUITING: 'Active, Not Recruiting',
    COMPLETED: 'Completed',
  }
  return map[status] || status || 'Status'
}

