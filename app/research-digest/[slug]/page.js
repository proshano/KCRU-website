import { notFound } from 'next/navigation'
import Link from 'next/link'
import { sanityFetch, queries } from '@/lib/sanity'
import { isResearchDigestPublicEnabled } from '@/lib/researchDigestPublic'
import { buildOpenGraph, buildTwitterMetadata, normalizeDescription } from '@/lib/seo'

export const revalidate = 1800

export async function generateMetadata({ params }) {
  const { slug } = await params
  const [settingsRaw, issueRaw] = await Promise.all([
    sanityFetch(queries.siteSettings),
    sanityFetch(queries.researchDigestIssueBySlug, { slug }),
  ])
  const settings = JSON.parse(JSON.stringify(settingsRaw || {}))
  if (!isResearchDigestPublicEnabled(settings)) {
    return { title: 'Research Digest', robots: { index: false, follow: false } }
  }
  const issue = JSON.parse(JSON.stringify(issueRaw || {}))
  if (!issue?._id) return {}

  const title = issue.title || `Kidney research digest - ${issue.date}`
  const description = normalizeDescription(
    `Approved kidney research digest for ${formatDate(issue.date)} with ${issue.papers?.length || 0} selected papers.`,
    200
  )
  const path = `/research-digest/${issue.slug || slug}`

  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: buildOpenGraph({ settings, title, description, path }),
    twitter: buildTwitterMetadata({ settings, title, description }),
  }
}

export default async function ResearchDigestIssuePage({ params }) {
  const { slug } = await params
  const [settingsRaw, issueRaw] = await Promise.all([
    sanityFetch(queries.siteSettings),
    sanityFetch(queries.researchDigestIssueBySlug, { slug }),
  ])
  const settings = JSON.parse(JSON.stringify(settingsRaw || {}))
  if (!isResearchDigestPublicEnabled(settings)) notFound()
  const issue = JSON.parse(JSON.stringify(issueRaw || {}))
  if (!issue?._id) notFound()

  const papers = Array.isArray(issue.papers) ? issue.papers : []

  return (
    <main className="max-w-[980px] mx-auto px-6 md:px-12 py-12 space-y-8">
      <nav className="text-sm">
        <Link href="/research-digest" className="text-purple font-semibold" prefetch={false}>
          Back to research digest
        </Link>
      </nav>

      <header className="space-y-3">
        <p className="text-sm font-semibold text-[#777] uppercase tracking-[0.08em]">{formatDate(issue.date)}</p>
        <h1 className="text-4xl font-bold tracking-tight">{issue.title}</h1>
        {issue.intro && <p className="text-[#666] max-w-3xl">{issue.intro}</p>}
      </header>

      {!papers.length && (
        <p className="text-[#666]">No approved papers are listed for this digest.</p>
      )}

      <section className="space-y-5">
        {papers.map((paper) => (
          <article key={paper._id} className="bg-white border border-black/[0.06] p-5 md:p-6 space-y-3">
            <div className="space-y-2">
              <h2 className="text-xl font-semibold leading-snug">
                <a href={paper.url || `https://pubmed.ncbi.nlm.nih.gov/${paper.pmid}/`} target="_blank" rel="noreferrer">
                  {paper.title}
                </a>
              </h2>
              <p className="text-sm text-[#666]">
                {[paper.journal, paper.pubDate || paper.year].filter(Boolean).join(' - ')}
              </p>
            </div>
            {paper.whyItMatters && (
              <p className="text-sm text-[#333]">
                <span className="font-semibold">Why it matters:</span> {paper.whyItMatters}
              </p>
            )}
            {paper.summary && <p className="text-[#555] leading-relaxed">{paper.summary}</p>}
            {paper.topics?.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {paper.topics.map((topic) => (
                  <span key={topic} className="text-xs text-[#555] bg-[#f4f4f4] px-2 py-1">{topic}</span>
                ))}
              </div>
            )}
            {paper.pmid && (
              <a
                href={`https://pubmed.ncbi.nlm.nih.gov/${paper.pmid}/`}
                target="_blank"
                rel="noreferrer"
                className="arrow-link text-[13px]"
              >
                PMID {paper.pmid}
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M5 12h14M12 5l7 7-7 7"/>
                </svg>
              </a>
            )}
          </article>
        ))}
      </section>

      <section className="border-t border-black/[0.08] pt-6">
        <Link href="/opportunities" className="arrow-link text-[13px]" prefetch={false}>
          View research opportunities
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M5 12h14M12 5l7 7-7 7"/>
          </svg>
        </Link>
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
