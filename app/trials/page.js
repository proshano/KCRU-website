import Link from 'next/link'
import Image from 'next/image'
import { sanityFetch, queries, urlFor } from '@/lib/sanity'

// Revalidate every 12 hours
export const revalidate = 43200

export const metadata = {
  title: 'Clinical Studies | KCRU',
  description: 'Find kidney research studies currently recruiting participants at our sites.',
}

const statusConfig = {
  recruiting: { 
    label: 'Recruiting', 
    style: 'text-emerald-800 bg-emerald-50 ring-1 ring-emerald-200',
    dot: 'animate' 
  },
  coming_soon: { 
    label: 'Coming Soon', 
    style: 'text-amber-800 bg-amber-50 ring-1 ring-amber-200',
    dot: false 
  },
  active_not_recruiting: { 
    label: 'Active, Not Recruiting', 
    style: 'text-purple bg-purple/10 ring-1 ring-purple/30',
    dot: 'static'
  },
  // Legacy fallback - treat 'closed' same as active_not_recruiting
  closed: { 
    label: 'Active, Not Recruiting', 
    style: 'text-purple bg-purple/10 ring-1 ring-purple/30',
    dot: 'static'
  },
  completed: { 
    label: 'Completed', 
    style: 'text-gray-500 bg-gray-50 ring-1 ring-gray-200',
    dot: false 
  },
}

export default async function TrialsPage() {
  const [trialsRaw, areasRaw] = await Promise.all([
    sanityFetch(queries.trialSummaries),
    sanityFetch(queries.therapeuticAreas)
  ])
  
  const trials = JSON.parse(JSON.stringify(trialsRaw || []))
  const areas = JSON.parse(JSON.stringify(areasRaw || []))

  // Separate by status (include 'closed' as legacy fallback for active_not_recruiting)
  const recruitingTrials = trials.filter(t => t.status === 'recruiting')
  const comingSoonTrials = trials.filter(t => t.status === 'coming_soon')
  const activeNotRecruitingTrials = trials.filter(t => 
    t.status === 'active_not_recruiting' || t.status === 'closed'
  )
  const completedTrials = trials.filter(t => t.status === 'completed')

  return (
    <main className="max-w-[1400px] mx-auto px-6 md:px-12 py-12">
      {/* Header */}
      <header className="mb-10">
        <p className="text-sm font-semibold text-purple uppercase tracking-wide mb-2">
          Clinical Research
        </p>
        <h1 className="text-4xl md:text-5xl font-bold tracking-tight mb-4">
          Active Studies
        </h1>
        <p className="text-lg text-gray-600 max-w-2xl">
          The details on this site are oriented to healthcare providers. 
          Please contact us if you have questions about eligibility for your patients.
        </p>
      </header>

      {/* Quick stats */}
      <div className="flex flex-wrap gap-6 mb-10 text-sm">
        <div className="flex items-center gap-2">
          <span className="flex h-3 w-3 relative">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
            <span className="relative inline-flex h-3 w-3 rounded-full bg-emerald-500" />
          </span>
          <span className="font-medium">{recruitingTrials.length} recruiting</span>
        </div>
        {comingSoonTrials.length > 0 && (
          <div className="flex items-center gap-2 text-gray-600">
            <span className="h-3 w-3 rounded-full bg-amber-400" />
            <span>{comingSoonTrials.length} coming soon</span>
          </div>
        )}
      </div>

      {/* Therapeutic area filter pills */}
      {areas.length > 0 && (
        <div className="mb-8">
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-3">
            Filter by area
          </p>
          <div className="flex flex-wrap gap-2">
            {areas.filter(a => a.trialCount > 0).map((area) => (
              <span
                key={area._id}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-full bg-gray-100 text-gray-700 hover:bg-gray-200 cursor-pointer transition"
              >
                {area.icon && <span>{area.icon}</span>}
                {area.shortLabel || area.name}
                <span className="text-xs text-gray-500">({area.trialCount})</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Recruiting Studies */}
      {recruitingTrials.length > 0 && (
        <section className="mb-12">
          <h2 className="text-2xl font-bold mb-6 flex items-center gap-3">
            <span className="flex h-3 w-3 relative">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
              <span className="relative inline-flex h-3 w-3 rounded-full bg-emerald-500" />
            </span>
            Currently Recruiting
          </h2>
          <div className="grid gap-6 md:grid-cols-2">
            {recruitingTrials.map((trial) => (
              <TrialCard key={trial._id} trial={trial} />
            ))}
          </div>
        </section>
      )}

      {/* Coming Soon */}
      {comingSoonTrials.length > 0 && (
        <section className="mb-12">
          <h2 className="text-2xl font-bold mb-6">Coming Soon</h2>
          <div className="grid gap-6 md:grid-cols-2">
            {comingSoonTrials.map((trial) => (
              <TrialCard key={trial._id} trial={trial} />
            ))}
          </div>
        </section>
      )}

      {/* Active but not recruiting */}
      {activeNotRecruitingTrials.length > 0 && (
        <section className="mb-12">
          <h2 className="text-2xl font-bold mb-6">Active Studies (Not Enrolling)</h2>
          <p className="text-sm text-gray-500 -mt-4 mb-6">These studies are ongoing but no longer accepting new participants.</p>
          <div className="grid gap-6 md:grid-cols-2">
            {activeNotRecruitingTrials.map((trial) => (
              <TrialCard key={trial._id} trial={trial} />
            ))}
          </div>
        </section>
      )}

      {/* Completed */}
      {completedTrials.length > 0 && (
        <section>
          <h2 className="text-xl font-bold mb-4 text-gray-600">Completed Studies</h2>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {completedTrials.map((trial) => (
              <TrialCardCompact key={trial._id} trial={trial} />
            ))}
          </div>
        </section>
      )}

      {/* Empty state */}
      {trials.length === 0 && (
        <div className="text-center py-16">
          <p className="text-gray-500 text-lg">No studies available at this time.</p>
          <p className="text-gray-400 mt-2">Check back soon for new opportunities.</p>
        </div>
      )}
    </main>
  )
}

function TrialCard({ trial }) {
  const config = statusConfig[trial.status] || statusConfig.recruiting
  const slugValue = trial.slug?.current || trial.slug
  const hasDetailPage = !!slugValue
  const ctGovUrl = trial.nctId ? `https://clinicaltrials.gov/study/${trial.nctId}` : null

  // Build summary text - prefer laySummary, fall back to eligibility overview
  const summaryText = trial.laySummary || trial.eligibilityOverview || ''

  return (
    <article className="group h-full flex flex-col bg-white border border-gray-200 rounded-lg overflow-hidden hover:shadow-lg hover:border-gray-300 transition-all">
      {/* Card header */}
      <div className="p-6 flex-1">
        {/* Status + conditions row */}
        <div className="flex items-start justify-between gap-3 mb-4">
          <span className={`inline-flex items-center gap-2 px-2.5 py-1 text-xs font-semibold rounded-full ${config.style}`}>
            {config.dot === 'animate' && (
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
              </span>
            )}
            {config.dot === 'static' && (
              <span className="h-2 w-2 rounded-full bg-purple/60" />
            )}
            {config.label}
          </span>
          
          {trial.nctId && (
            <span className="text-xs text-gray-400 font-mono">{trial.nctId}</span>
          )}
        </div>

        {/* Title */}
        <h3 className="text-xl font-semibold text-gray-900 mb-3 leading-snug group-hover:text-purple transition-colors">
          {trial.title}
        </h3>

        {/* Conditions tags */}
        {trial.conditions?.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-4">
            {trial.conditions.slice(0, 3).map((condition, i) => (
              <span key={i} className="px-2 py-0.5 text-xs font-medium bg-purple/10 text-purple rounded">
                {condition}
              </span>
            ))}
            {trial.conditions.length > 3 && (
              <span className="px-2 py-0.5 text-xs text-gray-500">
                +{trial.conditions.length - 3} more
              </span>
            )}
          </div>
        )}

        {/* Summary */}
        {summaryText && (
          <p className="text-sm text-gray-600 line-clamp-3 mb-4">
            {summaryText}
          </p>
        )}

        {/* Eligibility quick info */}
        {(trial.ageRange?.minimum || trial.ageRange?.maximum) && (
          <div className="text-xs text-gray-500 mb-3">
            <span className="font-medium">Ages:</span>{' '}
            {trial.ageRange.minimum || 'No min'} – {trial.ageRange.maximum || 'No max'}
          </div>
        )}

        {/* Therapeutic areas */}
        {trial.therapeuticAreas?.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-auto pt-2">
            {trial.therapeuticAreas.map((area) => (
              <span 
                key={area._id} 
                className="px-2 py-0.5 text-xs font-medium bg-gray-100 text-gray-600 rounded"
              >
                {area.shortLabel || area.name}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Card footer */}
      <div className="px-6 py-4 bg-gray-50 border-t border-gray-100">
        <div className="flex items-center justify-between gap-4">
          {/* PI badge or contact */}
          <div className="flex-1 min-w-0">
            {trial.principalInvestigator?.name ? (
              <InvestigatorBadge researcher={trial.principalInvestigator} />
            ) : trial.localContact?.displayPublicly && trial.localContact?.name ? (
              <span className="text-xs text-gray-500">Contact: {trial.localContact.name}</span>
            ) : trial.ctGovData?.sponsor ? (
              <span className="text-xs text-gray-500">Sponsor: {trial.ctGovData.sponsor}</span>
            ) : null}
          </div>

          {/* Links */}
          <div className="flex items-center gap-3 flex-shrink-0">
            {ctGovUrl && (
              <a
                href={ctGovUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-gray-500 hover:text-purple transition"
                title="View on ClinicalTrials.gov"
              >
                CT.gov ↗
              </a>
            )}
            {hasDetailPage && (
              <Link 
                href={`/trials/${slugValue}`}
                className="text-xs font-medium text-purple hover:underline"
              >
                Learn more →
              </Link>
            )}
          </div>
        </div>
      </div>
    </article>
  )
}

function InvestigatorBadge({ researcher }) {
  const slugValue = researcher.slug?.current || researcher.slug
  const href = slugValue ? `/team/${slugValue}` : '#'
  
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-2 border border-black/[0.08] px-3 py-1.5 hover:border-purple transition-colors bg-white rounded"
    >
      <Avatar photo={researcher.photo} name={researcher.name} />
      <span className="text-purple font-medium text-sm">{researcher.name}</span>
    </Link>
  )
}

function Avatar({ photo, name }) {
  if (photo) {
    const src = urlFor(photo).width(64).height(64).fit('crop').url()
    return (
      <Image
        src={src}
        alt={name || ''}
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

function TrialCardCompact({ trial }) {
  const config = statusConfig[trial.status] || statusConfig.completed
  const ctGovUrl = trial.nctId ? `https://clinicaltrials.gov/study/${trial.nctId}` : null

  return (
    <article className="p-4 bg-gray-50 border border-gray-200 rounded-lg">
      <div className="flex items-start justify-between gap-2 mb-2">
        <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${config.style}`}>
          {config.label}
        </span>
        {trial.nctId && (
          <span className="text-xs text-gray-400 font-mono">{trial.nctId}</span>
        )}
      </div>
      <h3 className="text-sm font-medium text-gray-700 line-clamp-2 mb-2">
        {trial.title}
      </h3>
      {ctGovUrl && (
        <a
          href={ctGovUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-gray-500 hover:text-purple transition"
        >
          View on CT.gov ↗
        </a>
      )}
    </article>
  )
}
