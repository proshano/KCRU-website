import Image from 'next/image'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { sanityFetch, queries, urlFor } from '@/lib/sanity'
import { getPublicationsForResearchersDisplay } from '@/lib/publications'
import { getShareButtons, shareIcons } from '@/lib/sharing'

export const revalidate = 0
export const dynamic = 'force-dynamic'

export default async function TeamMemberPage({ params }) {
  const resolvedParams = await params
  const slugRaw = resolvedParams?.slug
  const slug = typeof slugRaw === 'string' ? decodeURIComponent(slugRaw).replace(/^\/+|\/+$/g, '') : ''
  if (!slug) return notFound()
  const slugLower = slug.toLowerCase()
  const slugPattern = `^${slugLower}$`

  const [profile, researchers] = await Promise.all([
    sanityFetch(queries.researcherBySlug, { slug, slugLower, slugPattern }),
    sanityFetch(queries.allResearchers)
  ])
  if (!profile) return notFound()

  // Extract only the fields needed for publications to avoid circular references
  const profileForPublications = {
    _id: profile._id,
    name: profile.name,
    slug: profile.slug,
    pubmedQuery: profile.pubmedQuery
  }
  const publicationsBundle = profile.pubmedQuery
    ? await getPublicationsForResearchersDisplay([profileForPublications], 200)
    : null

  return (
    <main className="max-w-4xl mx-auto px-4 py-10 space-y-6">
      <div className="flex flex-wrap gap-6 items-start">
        <AvatarLarge photo={profile.photo} name={profile.name} />
        <div className="space-y-2">
          <h1 className="text-3xl font-bold text-gray-900">{profile.name}</h1>
          {profile.role && <p className="text-lg text-gray-700">{profile.role}</p>}
          <div className="flex flex-wrap gap-3 text-sm text-blue-700">
            {profile.email && (
              <a className="hover:underline" href={`mailto:${profile.email}`}>
                Email
              </a>
            )}
            {profile.twitter && (
              <a className="hover:underline" href={`https://twitter.com/${profile.twitter.replace('@', '')}`} target="_blank" rel="noopener noreferrer">
                X / Twitter
              </a>
            )}
            {profile.linkedin && (
              <a className="hover:underline" href={profile.linkedin} target="_blank" rel="noopener noreferrer">
                LinkedIn
              </a>
            )}
            {profile.orcid && (
              <a className="hover:underline" href={`https://orcid.org/${profile.orcid.replace('https://orcid.org/', '')}`} target="_blank" rel="noopener noreferrer">
                ORCID
              </a>
            )}
          </div>
        </div>
      </div>

      {profile.bio && (
        <section className="space-y-2">
          <h2 className="text-xl font-semibold text-gray-900">Biography</h2>
          <p className="text-gray-700 leading-relaxed whitespace-pre-line">{profile.bio}</p>
        </section>
      )}

      <ActiveStudies studies={profile.activeStudies} />

      <PublicationsSection
        publicationsBundle={publicationsBundle}
        hasQuery={Boolean(profile.pubmedQuery)}
        researchers={researchers || []}
      />

      <div>
        <Link href="/team" className="text-blue-700 hover:underline text-sm">
          ← Back to team
        </Link>
      </div>
    </main>
  )
}

function PublicationsSection({ publicationsBundle, hasQuery, researchers }) {
  if (!hasQuery) {
    return (
      <section className="space-y-2">
        <h2 className="text-xl font-semibold text-gray-900">Publications</h2>
        <p className="text-gray-600 text-sm">Add a PubMed query in Sanity to show this researcher&apos;s publications.</p>
      </section>
    )
  }

  const total = publicationsBundle?.publications?.length || 0
  const years = publicationsBundle?.years || []
  const byYear = publicationsBundle?.byYear || {}
  const provenance = publicationsBundle?.provenance || {}

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-xl font-semibold text-gray-900">Publications (last 3 years)</h2>
        <span className="text-sm text-gray-600">{total} found</span>
      </div>

      {total === 0 && (
        <p className="text-gray-600 text-sm">No publications found in the last 3 years for the current PubMed query.</p>
      )}

      {total > 0 && <YearSections years={years} byYear={byYear} researchers={researchers} provenance={provenance} />}
    </section>
  )
}

function YearSections({ years, byYear, researchers, provenance }) {
  return (
    <div className="divide-y divide-gray-200">
      {years.map((year) => (
        <YearBlock key={year} year={year} pubs={byYear[year]} researchers={researchers} provenance={provenance} />
      ))}
    </div>
  )
}

function YearBlock({ year, pubs, researchers, provenance }) {
  const sorted = sortPublications(pubs)
  return (
    <section className="py-3">
      <details className="group">
        <summary className="flex w-full cursor-pointer list-none items-center justify-between text-left">
          <div className="flex items-center gap-3">
            <span className="text-lg font-semibold text-gray-900">{year}</span>
            <span className="text-sm text-gray-500">{sorted.length} items</span>
          </div>
          <span className="text-lg text-blue-700 hidden group-open:inline" aria-hidden>-</span>
          <span className="text-lg text-blue-700 group-open:hidden" aria-hidden>+</span>
        </summary>
        <div className="mt-3 divide-y divide-gray-200">
          {sorted.map((pub) => (
            <PublicationItem key={pub.pmid || pub.title} pub={pub} researchers={researchers} provenance={provenance} />
          ))}
        </div>
      </details>
    </section>
  )
}

function PublicationItem({ pub, researchers, provenance }) {
  const shareButtons = getShareButtons(pub)
  const matchedResearchers = findResearchersForPub(pub, researchers, provenance)

  return (
    <article className="p-4 space-y-2">
      <div className="flex flex-wrap items-start gap-3">
        <div className="flex-1 min-w-[240px]">
          <h4 className="text-base font-semibold text-gray-900">{pub.title}</h4>
          <p className="text-sm text-gray-700">{pub.authors?.join(', ')}</p>
          <p className="text-sm text-gray-600">
            {pub.journal} {pub.year && `• ${pub.year}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {shareButtons.map((btn) => (
            <a
              key={btn.platform}
              href={btn.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex h-9 w-9 items-center justify-center rounded-full border border-gray-200 bg-white text-blue-700 hover:bg-blue-50"
              aria-label={btn.ariaLabel}
            >
              {shareIcons[btn.icon] ? (
                <span dangerouslySetInnerHTML={{ __html: shareIcons[btn.icon] }} />
              ) : (
                <span>↗</span>
              )}
            </a>
          ))}
          <a
            href={pub.url}
            target="_blank"
            rel="noopener noreferrer"
            className="h-9 px-3 inline-flex items-center rounded-full border border-gray-200 text-gray-700 hover:bg-gray-50 text-sm"
          >
            PubMed
          </a>
          {pub.doi && (
            <a
              href={`https://doi.org/${pub.doi}`}
              target="_blank"
              rel="noopener noreferrer"
              className="h-9 px-3 inline-flex items-center rounded-full border border-gray-200 text-gray-700 hover:bg-gray-50 text-sm"
            >
              DOI
            </a>
          )}
        </div>
      </div>
      {matchedResearchers.length > 0 && (
        <div className="flex flex-wrap gap-3 text-sm text-gray-700">
          {matchedResearchers.map((r) => (
            <Link
              key={r._id}
              href={r.slug?.current ? `/team/${r.slug.current}` : '#'}
              className="inline-flex items-center gap-2 rounded-full border border-gray-200 px-3 py-1 hover:bg-gray-50"
            >
              <AvatarSmall photo={r.photo} name={r.name} />
              <span className="text-blue-700">{r.name}</span>
            </Link>
          ))}
        </div>
      )}
      {pub.laySummary && (
        <p className="text-sm text-gray-700 bg-gray-50 border border-gray-200 rounded p-3">
          {pub.laySummary}
        </p>
      )}
    </article>
  )
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

function ActiveStudies({ studies }) {
  const list = studies || []
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-xl font-semibold text-gray-900">Active studies</h2>
        <span className="text-sm text-gray-600">{list.length} listed</span>
      </div>
      {list.length === 0 ? (
        <p className="text-gray-600 text-sm">No active studies currently linked to this researcher.</p>
      ) : (
        <div className="space-y-3">
          {list.map((study) => (
            <div key={study._id} className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm space-y-2">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="space-y-1">
                  <h3 className="text-lg font-semibold text-gray-900">{study.title}</h3>
                  {study.condition && <p className="text-sm text-gray-700">{study.condition}</p>}
                </div>
                {study.status && (
                  <span className={`text-xs px-2 py-1 rounded-full ${statusStyles[study.status] || 'bg-gray-100 text-gray-700'}`}>
                    {prettyStatus(study.status)}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3 text-sm text-blue-700">
                <Link href="/trials" className="hover:underline">
                  View trials page
                </Link>
                {study.nctId ? (
                  <a
                    className="hover:underline"
                    href={`https://clinicaltrials.gov/study/${study.nctId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    ClinicalTrials.gov
                  </a>
                ) : (
                  <span className="text-gray-500">No registry link</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

const statusStyles = {
  recruiting: 'bg-green-100 text-green-800',
  coming_soon: 'bg-yellow-100 text-yellow-800',
  closed: 'bg-gray-100 text-gray-700',
  RECRUITING: 'bg-green-100 text-green-800',
  NOT_YET_RECRUITING: 'bg-yellow-100 text-yellow-800',
  ACTIVE_NOT_RECRUITING: 'bg-blue-100 text-blue-800',
  COMPLETED: 'bg-gray-100 text-gray-700',
}

function prettyStatus(status) {
  const map = {
    recruiting: 'Recruiting',
    coming_soon: 'Coming soon',
    closed: 'Closed',
    RECRUITING: 'Recruiting',
    NOT_YET_RECRUITING: 'Not yet recruiting',
    ACTIVE_NOT_RECRUITING: 'Active, not recruiting',
    COMPLETED: 'Completed',
  }
  return map[status] || status || 'Status'
}

function AvatarLarge({ photo, name }) {
  if (photo) {
    const src = urlFor(photo).width(240).height(240).fit('crop').url()
    return (
      <Image
        src={src}
        alt={name}
        width={160}
        height={160}
        className="h-40 w-40 rounded-full object-cover border border-gray-200"
      />
    )
  }
  return (
    <div className="h-40 w-40 rounded-full bg-gray-200 text-2xl font-semibold text-gray-600 flex items-center justify-center">
      {name?.slice(0, 2)?.toUpperCase() || '?'}
    </div>
  )
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
    <span className="h-6 w-6 rounded-full bg-gray-200 text-xs flex items-center justify-center text-gray-600">
      {name?.slice(0, 1)?.toUpperCase() || '?'}
    </span>
  )
}

