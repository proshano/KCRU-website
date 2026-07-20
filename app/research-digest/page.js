import Link from 'next/link'
import { notFound } from 'next/navigation'
import { sanityFetch, queries } from '@/lib/sanity'
import { isResearchDigestPublicEnabled } from '@/lib/researchDigestPublic'
import { buildOpenGraph, buildTwitterMetadata, normalizeDescription } from '@/lib/seo'

export const revalidate = 1800

export async function generateMetadata() {
  const settingsRaw = await sanityFetch(queries.siteSettings)
  const settings = JSON.parse(JSON.stringify(settingsRaw || {}))
  if (!isResearchDigestPublicEnabled(settings)) {
    return { title: 'Research Digest', robots: { index: false, follow: false } }
  }
  const title = 'Kidney Research Digest'
  const description = normalizeDescription(
    'Approved daily kidney research digests from London Kidney Clinical Research.',
    200
  )

  return {
    title,
    description,
    alternates: { canonical: '/research-digest' },
    openGraph: buildOpenGraph({ settings, title, description, path: '/research-digest' }),
    twitter: buildTwitterMetadata({ settings, title, description }),
  }
}

export default async function ResearchDigestPage() {
  const [settingsRaw, issuesRaw] = await Promise.all([
    sanityFetch(queries.siteSettings),
    sanityFetch(queries.researchDigestIssues),
  ])
  const settings = JSON.parse(JSON.stringify(settingsRaw || {}))
  if (!isResearchDigestPublicEnabled(settings)) notFound()
  const issues = JSON.parse(JSON.stringify(issuesRaw || []))

  return (
    <main className="max-w-[1200px] mx-auto px-6 md:px-12 py-12 space-y-10">
      <header className="space-y-3">
        <h1 className="text-4xl font-bold tracking-tight">Kidney research digest</h1>
        <p className="text-[#666] max-w-3xl">
          A curated weekday scan of kidney-relevant papers from high-impact medicine, nephrology, dialysis,
          transplantation, and adjacent journals. Items appear here after staff approval.
        </p>
        <div className="flex flex-wrap gap-3">
          <Link href="/updates" className="btn-primary" prefetch={false}>Subscribe</Link>
          <Link href="/opportunities" className="btn-secondary" prefetch={false}>Research opportunities</Link>
        </div>
      </header>

      <section className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-2xl font-bold tracking-tight">Recent digests</h2>
          <span className="text-sm text-[#666]">{issues.length} available</span>
        </div>
        {!issues.length && (
          <p className="text-[#666]">No approved research digests are available yet.</p>
        )}
        <div className="grid gap-4 md:grid-cols-2">
          {issues.map((issue) => (
            <article key={issue._id} className="bg-white border border-black/[0.06] p-5 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-lg font-semibold text-[#1a1a1a]">
                    <Link href={`/research-digest/${issue.slug || issue.date}`} prefetch={false}>
                      {issue.title || formatDate(issue.date)}
                    </Link>
                  </h3>
                  <p className="text-sm text-[#666]">{formatDate(issue.date)}</p>
                </div>
                <span className="text-xs font-semibold text-purple bg-purple/10 px-3 py-1">
                  {issue.paperCount || 0} papers
                </span>
              </div>
              {issue.intro && <p className="text-sm text-[#555]">{issue.intro}</p>}
              <Link
                href={`/research-digest/${issue.slug || issue.date}`}
                className="arrow-link text-[13px]"
                prefetch={false}
              >
                Read digest
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M5 12h14M12 5l7 7-7 7"/>
                </svg>
              </Link>
            </article>
          ))}
        </div>
      </section>
    </main>
  )
}

function formatDate(value) {
  if (!value) return 'Date pending'
  const date = new Date(`${value}T12:00:00Z`)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', year: 'numeric' }).format(date)
}
