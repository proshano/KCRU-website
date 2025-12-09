import Link from 'next/link'
import { sanityFetch, queries } from '@/lib/sanity'

// Revalidate every 12 hours
export const revalidate = 43200

const statusStyles = {
  recruiting: 'text-emerald-800 bg-emerald-50 ring-1 ring-emerald-200',
  coming_soon: 'text-amber-800 bg-amber-50 ring-1 ring-amber-200',
  closed: 'text-[#666] bg-[#f5f5f5] ring-1 ring-[#ddd]',
  RECRUITING: 'text-emerald-800 bg-emerald-50 ring-1 ring-emerald-200',
  NOT_YET_RECRUITING: 'text-amber-800 bg-amber-50 ring-1 ring-amber-200',
  ACTIVE_NOT_RECRUITING: 'text-purple bg-purple/10 ring-1 ring-purple/30',
  COMPLETED: 'text-[#666] bg-[#f5f5f5] ring-1 ring-[#ddd]',
}

export default async function TrialsPage() {
  const patientTrials = await sanityFetch(queries.trialSummaries)

  // Separate recruiting from other trials
  const recruitingTrials = patientTrials?.filter(t => t.status === 'recruiting' || t.status === 'RECRUITING') || []
  const otherTrials = patientTrials?.filter(t => t.status !== 'recruiting' && t.status !== 'RECRUITING') || []

  return (
    <main className="max-w-[1400px] mx-auto px-6 md:px-12 py-12 space-y-12">
      {/* Recruiting section */}
      <section className="space-y-6">
        <header className="flex justify-between items-center">
          <div>
            <h2 className="text-sm font-semibold text-[#888] uppercase tracking-[0.08em] mb-2">
              Currently Recruiting
            </h2>
            <h1 className="text-4xl font-bold tracking-tight">Active Studies</h1>
          </div>
          <span className="text-sm text-[#666] font-medium">{recruitingTrials.length} recruiting</span>
        </header>

        {recruitingTrials.length === 0 && (
          <p className="text-[#666]">No studies are currently recruiting.</p>
        )}

        <div className="grid gap-5 md:grid-cols-2">
          {recruitingTrials.map((trial) => (
            <TrialCard key={trial._id} trial={trial} featured />
          ))}
        </div>
      </section>

      {/* Other studies section */}
      {otherTrials.length > 0 && (
        <section className="space-y-6">
          <header>
            <h2 className="text-2xl font-bold tracking-tight">Other Studies</h2>
            <p className="text-sm text-[#666] mt-1">Completed, upcoming, or not currently recruiting</p>
          </header>

          <div className="grid gap-5 md:grid-cols-2">
            {otherTrials.map((trial) => (
              <TrialCard key={trial._id} trial={trial} />
            ))}
          </div>
        </section>
      )}
    </main>
  )
}

function TrialCard({ trial, featured = false }) {
  const status = trial.status || 'recruiting'
  const isRecruiting = status === 'recruiting' || status === 'RECRUITING'
  const slugValue = typeof trial.slug === 'string' ? trial.slug : trial.slug?.current

  const cardContent = (
    <div className={`group p-6 bg-white border border-black/[0.06] transition-all ${featured ? 'hover:-translate-y-1 hover:shadow-lg' : ''}`}>
      <div className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1">
            <span className={`inline-flex items-center gap-2 px-3 py-1 text-[11px] font-semibold rounded-full ${statusStyles[status] || statusStyles.closed}`}>
              {isRecruiting && (
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
                </span>
              )}
              {prettyStatus(status)}
            </span>
          </div>
          {featured && (
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[#1a1a1a] text-white text-sm transition group-hover:-translate-y-0.5 group-hover:shadow-md">
              →
            </span>
          )}
        </div>

        <h3 className="text-xl font-semibold text-[#1a1a1a] leading-tight">{trial.title}</h3>

        {trial.condition && (
          <p className="text-xs text-[#888] uppercase tracking-wide font-medium">{trial.condition}</p>
        )}

        <p className="text-sm text-[#666] line-clamp-3">
          {buildTrialSummary(trial)}
        </p>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[#888] font-medium pt-1">
          {trial.principalInvestigator?.name && (
            <span>PI: {trial.principalInvestigator.name}</span>
          )}
          {trial.nctId && (
            <span>NCT: {trial.nctId}</span>
          )}
        </div>

        {trial.nctId && (
          <a
            href={`https://clinicaltrials.gov/study/${trial.nctId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="arrow-link text-[13px] mt-2"
          >
            View on ClinicalTrials.gov
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M5 12h14M12 5l7 7-7 7"/>
            </svg>
          </a>
        )}
      </div>
    </div>
  )

  if (slugValue && featured) {
    return (
      <Link href={`/trials/${slugValue}`}>
        {cardContent}
      </Link>
    )
  }

  return cardContent
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

function buildTrialSummary(trial) {
  const text = trial.purpose || trial.whatToExpect || trial.briefSummary || ''
  if (!text) return 'Summary not available yet.'
  const trimmed = text.trim()
  if (trimmed.length <= 280) return trimmed
  return `${trimmed.slice(0, 280).trim()}…`
}
