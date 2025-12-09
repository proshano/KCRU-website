import { sanityFetch, queries, urlFor } from '@/lib/sanity'
import { getPublicationsForDisplay, getPublicationsForResearchersDisplay, addLaySummaries } from '@/lib/publications'
import { getShareButtons, shareIcons } from '@/lib/sharing'
import Image from 'next/image'
import Link from 'next/link'

export const revalidate = 86400 // 24 hours

export default async function PublicationsPage() {
  const settings = (await sanityFetch(queries.siteSettings)) || {}
  const researchers = await sanityFetch(queries.allResearchers)

  // Always use researcher queries; optionally augment with affiliation if present
  const researcherBundle = await getPublicationsForResearchersDisplay(researchers || [], 2000)
  let combinedPubs = researcherBundle.publications
  let provenance = researcherBundle.provenance || {}

  if (settings?.pubmedAffiliation) {
    const affBundle = await getPublicationsForDisplay(settings.pubmedAffiliation, 80)
    combinedPubs = dedupePublications([
      ...(researcherBundle.publications || []),
      ...(affBundle.publications || [])
    ])
  }

  const pubsWithSummaries = await addLaySummaries(combinedPubs, {
    provider: settings.llmProvider,
    model: settings.llmModel,
    apiKey: settings.llmApiKey,
    systemPrompt: settings.llmSystemPrompt
  })
  const { publications, byYear, years } = buildDisplayFromPublications(pubsWithSummaries)

  return (
    <main className="max-w-5xl mx-auto px-4 py-10 space-y-6">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold text-gray-900">
          Publications by our investigators (last 3 years)
        </h1>
      </header>

      {publications.length === 0 && (
        <p className="text-gray-500">No publications found yet. Add PubMed queries to researchers or an affiliation in Site Settings.</p>
      )}

      <YearSections years={years} byYear={byYear} researchers={researchers} provenance={provenance} />
    </main>
  )
}

function YearSections({ years, byYear, researchers, provenance }) {
  return (
    <div className="divide-y divide-gray-200">
      {years.map((year) => (
        <YearBlock
          key={year}
          year={year}
          pubs={byYear[year]}
          researchers={researchers}
          provenance={provenance}
        />
      ))}
    </div>
  )
}

function YearBlock({ year, pubs, researchers, provenance }) {
  return (
    <section className="py-4">
      <details className="group">
        <summary className="flex w-full cursor-pointer list-none items-center justify-between text-left">
          <div className="flex items-center gap-3">
            <span className="text-xl font-semibold text-gray-900">{year}</span>
            <span className="text-sm text-gray-500">{pubs.length} items</span>
          </div>
          <span className="text-lg text-blue-700 hidden group-open:inline" aria-hidden>-</span>
          <span className="text-lg text-blue-700 group-open:hidden" aria-hidden>+</span>
        </summary>
        <div className="mt-3 divide-y divide-gray-200">
          {pubs.map((pub) => (
            <PublicationItem
              key={pub.pmid}
              pub={pub}
              researchers={researchers}
              provenance={provenance}
            />
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
          <h3 className="text-lg font-semibold text-gray-900">{pub.title}</h3>
          <p className="text-sm text-gray-600">{pub.authors?.join(', ')}</p>
          <p className="text-sm text-gray-500">
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
              <Avatar photo={r.photo} name={r.name} />
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

function dedupePublications(pubLists = []) {
  const seen = new Set()
  const result = []
  for (const pub of pubLists) {
    const key = pub.pmid || pub.doi || pub.title
    if (key && !seen.has(key)) {
      seen.add(key)
      result.push(pub)
    }
  }
  return result
}

function buildDisplayFromPublications(publications) {
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

function findResearchersForPub(pub, researchers = [], provenance = {}) {
  if (!researchers.length) return []
  const fromProvenance = new Set(provenance[pub.pmid] || [])

  const chips = []

  // 1) Add provenance-based matches
  if (fromProvenance.size > 0) {
    for (const r of researchers) {
      if (fromProvenance.has(r._id)) {
        chips.push(r)
      }
    }
  }

  // 2) Fallback to author-name heuristic only if no provenance hit
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

function Avatar({ photo, name }) {
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

