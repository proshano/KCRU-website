import { sanityFetch, queries, urlFor } from '@/lib/sanity'
import { getCachedPublicationsDisplay, addLaySummaries } from '@/lib/publications'
import { getShareButtons, shareIcons } from '@/lib/sharing'
import Image from 'next/image'
import Link from 'next/link'

export const revalidate = 86400 // 24 hours

export default async function PublicationsPage() {
  const settingsRaw = (await sanityFetch(queries.siteSettings)) || {}
  const researchersRaw = await sanityFetch(queries.allResearchers)
  // Strip ALL Sanity data to plain JSON to break any circular references
  const settings = JSON.parse(JSON.stringify(settingsRaw || {}))
  const researchers = JSON.parse(JSON.stringify(researchersRaw || []))
  const researcherChips = researchers.map((r) => ({
    _id: r._id,
    name: r.name,
    slug: r.slug,
    photo: r.photo
  }))

  // Strip researchers to plain objects to avoid circular references
  const strippedResearchers = (researchers || []).map(r => ({
    _id: r._id,
    name: r.name,
    pubmedQuery: r.pubmedQuery
  }))

  // Always use researcher queries; optionally augment with affiliation if present
  let bundle = { publications: [], provenance: {}, byYear: {}, years: [], meta: {} }
  try {
    bundle = await getCachedPublicationsDisplay({
      researchers: strippedResearchers,
      affiliation: settings?.pubmedAffiliation || '',
      maxPerResearcher: 120,
      maxAffiliation: 80,
    })
  } catch (err) {
    console.error('Failed to load cached publications', err)
  }

  const combinedPubs = bundle.publications || []
  const provenance = bundle.provenance || {}

  // Temporarily disable LLM summaries to avoid stack issues; set to true to re-enable
  const enableSummaries = false
  const pubsWithSummaries = enableSummaries
    ? await addLaySummaries(combinedPubs, {
        provider: settings.llmProvider,
        model: settings.llmModel,
        apiKey: settings.llmApiKey,
        systemPrompt: settings.llmSystemPrompt
      })
    : combinedPubs

  const { publications, byYear, years } = buildDisplayFromPublications(pubsWithSummaries)
  const meta = bundle.meta || {}

  return (
    <main className="max-w-[1400px] mx-auto px-6 md:px-12 py-12 space-y-8">
      <header className="flex justify-between items-center">
        <div className="space-y-1">
          <h2 className="text-sm font-semibold text-[#888] uppercase tracking-[0.08em]">
            Research Output
          </h2>
          <h1 className="text-4xl font-bold tracking-tight">Publications</h1>
          <p className="text-sm text-[#666]">
            Last 3 years from our investigators{settings?.pubmedAffiliation ? ` + ${settings.pubmedAffiliation}` : ''}
          </p>
          <p className="text-xs text-[#888]">
            {meta?.generatedAt ? `Updated ${new Date(meta.generatedAt).toLocaleString()}` : 'Cache not yet generated'}
            {meta?.stale ? ' • refresh recommended' : ''}
          </p>
        </div>
        <div className="text-right text-sm text-[#666] font-medium space-y-1">
          <div>{publications.length} publications</div>
        </div>
      </header>

      {publications.length === 0 && (
        <p className="text-[#666]">No publications found yet. Add PubMed queries to researchers or an affiliation in Site Settings.</p>
      )}

      <YearSections years={years} byYear={byYear} researchers={researcherChips} provenance={provenance} />
    </main>
  )
}

function YearSections({ years, byYear, researchers, provenance }) {
  return (
    <div className="space-y-2">
      {years.map((year) => (
        <YearBlock
          key={year}
          year={year}
          pubs={byYear[year] || []}
          researchers={researchers}
          provenance={provenance}
        />
      ))}
    </div>
  )
}

function YearBlock({ year, pubs, researchers, provenance }) {
  return (
    <section className="border border-black/[0.06] bg-white">
      <details className="group" open>
        <summary className="flex w-full cursor-pointer list-none items-center justify-between text-left px-6 py-4 hover:bg-[#fafafa] transition-colors">
          <div className="flex items-center gap-4">
            <span className="text-2xl font-bold text-purple">{year}</span>
            <span className="text-sm text-[#888] font-medium">{pubs.length} publications</span>
          </div>
          <span className="text-purple text-lg font-bold hidden group-open:inline" aria-hidden>−</span>
          <span className="text-purple text-lg font-bold group-open:hidden" aria-hidden>+</span>
        </summary>
        <div className="border-t border-black/[0.06] divide-y divide-black/[0.06]">
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
    <article className="p-6 space-y-3">
      <div className="flex flex-wrap items-start gap-4">
        <div className="flex-1 min-w-[240px] space-y-1">
          <h3 className="text-lg font-semibold leading-snug">
            <a
              href={pub.url}
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
      </div>
      {matchedResearchers.length > 0 && (
        <div className="flex flex-wrap gap-2 text-sm">
          {matchedResearchers.map((r) => (
            <Link
              key={r._id}
              href={r.slug?.current ? `/team/${r.slug.current}` : '#'}
              className="inline-flex items-center gap-2 border border-black/[0.08] px-3 py-1.5 hover:border-purple transition-colors"
            >
              <Avatar photo={r.photo} name={r.name} />
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
    <span className="h-6 w-6 rounded-full bg-[#E8E5E0] text-xs flex items-center justify-center text-[#888] font-semibold">
      {name?.slice(0, 1)?.toUpperCase() || '?'}
    </span>
  )
}
