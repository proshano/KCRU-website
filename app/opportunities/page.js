import { sanityFetch, queries } from '@/lib/sanity'
import { buildOpenGraph, buildTwitterMetadata, normalizeDescription } from '@/lib/seo'

export const revalidate = 1800

export async function generateMetadata() {
  const settingsRaw = await sanityFetch(queries.siteSettings)
  const settings = JSON.parse(JSON.stringify(settingsRaw || {}))
  const title = 'Research Opportunities'
  const description = normalizeDescription(
    'Approved grants, conferences, awards, and research opportunities for kidney scientists.',
    200
  )

  return {
    title,
    description,
    alternates: { canonical: '/opportunities' },
    openGraph: buildOpenGraph({ settings, title, description, path: '/opportunities' }),
    twitter: buildTwitterMetadata({ settings, title, description }),
  }
}

export default async function OpportunitiesPage() {
  const today = new Date().toISOString().slice(0, 10)
  const opportunitiesRaw = await sanityFetch(queries.approvedResearchOpportunities, { today })
  const opportunities = JSON.parse(JSON.stringify(opportunitiesRaw || []))

  return (
    <main className="max-w-[1200px] mx-auto px-6 md:px-12 py-12 space-y-8">
      <header className="space-y-3">
        <h1 className="text-4xl font-bold tracking-tight">Research opportunities</h1>
        <p className="text-[#666] max-w-3xl">
          Approved grant, conference, award, and training opportunities relevant to kidney scientists.
        </p>
      </header>

      <section className="space-y-5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-2xl font-bold tracking-tight">Open and upcoming</h2>
          <span className="text-sm text-[#666]">{opportunities.length} available</span>
        </div>
        {!opportunities.length && (
          <p className="text-[#666]">No approved research opportunities are listed right now.</p>
        )}
        <div className="grid gap-4 md:grid-cols-2">
          {opportunities.map((item) => (
            <article key={item._id} className="bg-white border border-black/[0.06] p-5 space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-lg font-semibold leading-snug">
                    <a href={item.url} target="_blank" rel="noreferrer">{item.title}</a>
                  </h3>
                  <p className="text-sm text-[#666]">
                    {[prettyType(item.type), item.sourceName].filter(Boolean).join(' - ')}
                  </p>
                </div>
                <DeadlineBadge deadline={item.deadline} />
              </div>
              {item.description && <p className="text-sm text-[#555] leading-relaxed">{item.description}</p>}
              {item.eligibility && (
                <p className="text-sm text-[#555]">
                  <span className="font-semibold">Eligibility:</span> {item.eligibility}
                </p>
              )}
              {item.topics?.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {item.topics.map((topic) => (
                    <span key={topic} className="text-xs text-[#555] bg-[#f4f4f4] px-2 py-1">{topic}</span>
                  ))}
                </div>
              )}
              <a href={item.url} target="_blank" rel="noreferrer" className="arrow-link text-[13px]">
                View details
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M5 12h14M12 5l7 7-7 7"/>
                </svg>
              </a>
            </article>
          ))}
        </div>
      </section>
    </main>
  )
}

function prettyType(type) {
  const labels = {
    grant: 'Grant',
    conference: 'Conference',
    award: 'Award',
    training: 'Training',
    other: 'Opportunity',
  }
  return labels[type] || 'Opportunity'
}

function DeadlineBadge({ deadline }) {
  if (!deadline) {
    return <span className="text-xs font-semibold text-[#666] bg-[#f4f4f4] px-3 py-1">No deadline</span>
  }
  const today = new Date()
  const date = new Date(`${deadline}T12:00:00Z`)
  const days = Math.ceil((date.getTime() - today.getTime()) / (24 * 60 * 60 * 1000))
  const urgentClass = days <= 7
    ? 'text-red-800 bg-red-50 ring-1 ring-red-200'
    : days <= 30
      ? 'text-amber-800 bg-amber-50 ring-1 ring-amber-200'
      : 'text-emerald-800 bg-emerald-50 ring-1 ring-emerald-200'

  return (
    <span className={`text-xs font-semibold px-3 py-1 ${urgentClass}`}>
      {formatDate(deadline)}
    </span>
  )
}

function formatDate(value) {
  const date = new Date(`${value}T12:00:00Z`)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(date)
}
