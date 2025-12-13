import Image from 'next/image'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { sanityFetch, queries, urlFor } from '@/lib/sanity'
import { getCachedPublicationsDisplay, getPublicationsSinceYear } from '@/lib/publications'
import { getShareButtons, shareIcons } from '@/lib/sharing'

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
      const filteredPubs = filterPublicationsForResearcher(fullBundle, profile._id, profile.name)
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

  const total = publicationsBundle?.publications?.length || 0
  const sinceYear = getPublicationsSinceYear()
  const years = Array.isArray(publicationsBundle?.years) ? publicationsBundle.years : []
  const byYear = publicationsBundle?.byYear || {}
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
        <YearSections
          years={years}
          byYear={byYear}
          researchers={researchers}
          provenance={provenance}
          altmetricEnabled={altmetricEnabled}
        />
      )}
    </section>
  )
}

function YearSections({ years, byYear, researchers, provenance, altmetricEnabled }) {
  return (
    <div className="space-y-2">
      {years.map((year) => (
        <YearBlock
          key={year}
          year={year}
          pubs={byYear[year]}
          researchers={researchers}
          provenance={provenance}
          altmetricEnabled={altmetricEnabled}
        />
      ))}
    </div>
  )
}

function YearBlock({ year, pubs, researchers, provenance, altmetricEnabled }) {
  const sorted = sortPublications(pubs)
  return (
    <section className="border border-black/[0.06] bg-white">
      <details className="group" open>
        <summary className="flex w-full cursor-pointer list-none items-center justify-between text-left px-6 py-4 hover:bg-[#fafafa] transition-colors">
          <div className="flex items-center gap-4">
            <span className="text-2xl font-bold text-purple">{year}</span>
          </div>
          <span className="text-purple text-lg font-bold hidden group-open:inline" aria-hidden>−</span>
          <span className="text-purple text-lg font-bold group-open:hidden" aria-hidden>+</span>
        </summary>
        <div className="border-t border-black/[0.06] divide-y divide-black/[0.06]">
          {sorted.map((pub) => (
            <PublicationItem
              key={pub.pmid || pub.title}
              pub={pub}
              researchers={researchers}
              provenance={provenance}
              altmetricEnabled={altmetricEnabled}
            />
          ))}
        </div>
      </details>
    </section>
  )
}

function PublicationItem({ pub, researchers, provenance, altmetricEnabled }) {
  const shareButtons = getShareButtons(pub)
  const matchedResearchers = findResearchersForPub(pub, researchers, provenance)
  const hasAltmetricId = Boolean(pub?.doi || pub?.pmid)
  const showAltmetric = altmetricEnabled && hasAltmetricId

  return (
    <article className="p-6 space-y-3">
      <div className="flex flex-wrap items-start gap-4">
        <div className="flex-1 min-w-[240px] space-y-1">
          <h3 className="text-lg font-semibold leading-snug">
            <a
              href={pub.url || `https://pubmed.ncbi.nlm.nih.gov/${pub.pmid}/`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[#1a1a1a] hover:text-purple transition-colors"
            >
              {pub.title}
            </a>
          </h3>
          <p className="text-sm text-[#666]">{pub.authors?.join(', ')}</p>
          <p className="text-xs text-[#888] font-medium">
            {pub.journal} {pub.year && `· ${pub.year}`}
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
            {shareButtons.map((btn) => (
              <a
                key={btn.platform}
                href={btn.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex h-9 w-9 items-center justify-center rounded-full border border-black/[0.08] bg-white text-purple hover:bg-purple/5 transition-colors"
                aria-label={btn.ariaLabel}
              >
                {shareIcons[btn.icon] ? (
                  <span dangerouslySetInnerHTML={{ __html: shareIcons[btn.icon] }} />
                ) : (
                  <span>↗</span>
                )}
              </a>
            ))}
          </div>
          {showAltmetric && (
            <div
              className="altmetric-embed"
              data-badge-type="donut"
              data-badge-popover="right"
              data-link-target="_blank"
              data-doi={pub.doi || undefined}
              data-pmid={pub.doi ? undefined : pub.pmid}
            />
          )}
        </div>
      </div>
      {matchedResearchers.length > 0 && (
        <div className="flex flex-wrap gap-2 text-sm">
          {matchedResearchers.map((r) => (
            <Link
              key={r._id}
              href={r.slug?.current ? `/team/${r.slug.current}` : '#'}
              className="inline-flex items-center gap-2 border border-black/[0.08] px-3 py-1.5 hover:border-purple transition-colors"
            >
              <AvatarSmall photo={r.photo} name={r.name} />
              <span className="text-purple font-medium">{r.name}</span>
            </Link>
          ))}
        </div>
      )}
      {pub.laySummary && (
        <p className="text-sm text-[#666] bg-[#F5F3F0] border border-black/[0.06] p-4">
          {pub.laySummary}
        </p>
      )}
    </article>
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

function sortPublications(pubs = []) {
  return [...pubs].sort((a, b) => {
    const yearDiff = (b.year || 0) - (a.year || 0)
    if (yearDiff !== 0) return yearDiff
    const pmidA = parseInt(a.pmid, 10)
    const pmidB = parseInt(b.pmid, 10)
    if (!Number.isNaN(pmidA) && !Number.isNaN(pmidB)) {
      return pmidB - pmidA
    }
    return (a.title || '').localeCompare(b.title || '')
  })
}

function findResearchersForPub(pub, researchers = [], provenance = {}) {
  if (!researchers.length) return []
  const fromProvenance = new Set(provenance[pub.pmid] || [])

  const chips = []

  if (fromProvenance.size > 0) {
    for (const r of researchers) {
      if (fromProvenance.has(r._id)) {
        chips.push(r)
      }
    }
  }

  if (chips.length === 0 && pub?.authors?.length) {
    const authors = pub.authors.map(a => a.toLowerCase())
    for (const r of researchers) {
      if (!r.name) continue
      const name = r.name.toLowerCase()
      const last = name.split(' ').slice(-1)[0]
      if (authors.some(a => a.includes(name) || a.includes(last))) {
        chips.push(r)
      }
    }
  }

  return chips
}

function StudiesSection({ studies }) {
  const list = studies || []
  
  // Separate by status
  const recruiting = list.filter(s => s.status === 'recruiting')
  const other = list.filter(s => s.status !== 'recruiting')
  
  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-xl font-bold tracking-tight">
          Clinical Studies
          {list.length > 0 && <span className="text-[#888] font-normal text-base ml-2">({list.length})</span>}
        </h2>
      </div>
      {list.length === 0 ? (
        <p className="text-[#666] text-sm">No studies currently linked to this researcher.</p>
      ) : (
        <div className="space-y-6">
          {/* Recruiting studies first */}
          {recruiting.length > 0 && (
            <div className="grid gap-5 md:grid-cols-2">
              {recruiting.map((study) => (
                <StudyCard key={study._id} study={study} />
              ))}
            </div>
          )}
          
          {/* Other studies */}
          {other.length > 0 && (
            <div className="grid gap-5 md:grid-cols-2">
              {other.map((study) => (
                <StudyCard key={study._id} study={study} />
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  )
}

function StudyCard({ study }) {
  const slugValue = study.slug?.current || study.slug
  const hasDetailPage = !!slugValue
  
  return (
    <div className="p-5 bg-white border border-black/[0.06] space-y-3 hover:shadow-md transition-shadow">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="space-y-1 flex-1">
          <h3 className="text-lg font-semibold text-[#1a1a1a]">{study.title}</h3>
          {study.conditions?.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {study.conditions.slice(0, 2).map((condition, i) => (
                <span key={i} className="text-xs px-2 py-0.5 bg-purple/10 text-purple rounded">
                  {condition}
                </span>
              ))}
            </div>
          )}
        </div>
        {study.status && (
          <span className={`text-[11px] px-3 py-1 rounded-full font-semibold flex-shrink-0 ${statusStyles[study.status] || statusStyles.closed}`}>
            {prettyStatus(study.status)}
          </span>
        )}
      </div>
      
      {study.laySummary && (
        <p className="text-sm text-[#666] line-clamp-2">{study.laySummary}</p>
      )}
      
      <div className="flex items-center gap-4 text-sm">
        {hasDetailPage && (
          <Link href={`/trials/${slugValue}`} className="arrow-link text-[13px]">
            View details
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M5 12h14M12 5l7 7-7 7"/>
            </svg>
          </Link>
        )}
        {study.nctId && (
          <a
            className="arrow-link text-[13px]"
            href={`https://clinicaltrials.gov/study/${study.nctId}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            ClinicalTrials.gov
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M5 12h14M12 5l7 7-7 7"/>
            </svg>
          </a>
        )}
      </div>
    </div>
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

function AvatarSmall({ photo, name }) {
  if (photo) {
    const src = urlFor(photo).width(64).height(64).fit('crop').url()
    return (
      <Image
        src={src}
        alt={name}
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
