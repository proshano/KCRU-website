'use client'

import Link from 'next/link'
import Image from 'next/image'
import { urlFor } from '@/lib/sanity'
import { getTherapeuticAreaLabel } from '@/lib/communicationOptions'

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

/**
 * Collapsible section for a group of trials (like YearBlock for publications)
 */
export function TrialSection({ title, subtitle, trials, defaultOpen = true, dotColor }) {
  if (!trials || trials.length === 0) return null

  return (
    <section className="border border-black/[0.06] bg-white">
      <details className="group" open={defaultOpen}>
        <summary className="flex w-full cursor-pointer list-none items-center justify-between text-left px-6 py-4 hover:bg-[#fafafa] transition-colors">
          <div className="flex items-center gap-4">
            {dotColor && (
              <span className={`h-3 w-3 rounded-full ${dotColor}`} />
            )}
            <span className="text-2xl font-bold text-purple">{title}</span>
            <span className="text-sm text-[#888] font-medium">{trials.length} {trials.length === 1 ? 'study' : 'studies'}</span>
          </div>
          <span className="text-purple text-lg font-bold hidden group-open:inline" aria-hidden>−</span>
          <span className="text-purple text-lg font-bold group-open:hidden" aria-hidden>+</span>
        </summary>
        {subtitle && (
          <p className="px-6 pb-2 text-sm text-gray-500 -mt-2">{subtitle}</p>
        )}
        <div className="border-t border-black/[0.06] divide-y divide-black/[0.06]">
          {trials.map((trial) => (
            <TrialItem key={trial._id} trial={trial} />
          ))}
        </div>
      </details>
    </section>
  )
}

/**
 * Single trial item (like PublicationItem)
 */
function TrialItem({ trial }) {
  const config = statusConfig[trial.status] || statusConfig.recruiting
  const slugValue = trial.slug?.current || trial.slug
  const hasDetailPage = !!slugValue
  const ctGovUrl = trial.nctId ? `https://clinicaltrials.gov/study/${trial.nctId}` : null
  const summaryText = trial.laySummary || ''
  const therapeuticLabels =
    trial.therapeuticAreas?.map((area) => getTherapeuticAreaLabel(area?.name)).filter(Boolean) || []

  return (
    <article className="p-6 space-y-3 hover:bg-[#fafafa] transition-colors">
      <div className="flex flex-wrap items-start gap-4">
        {/* Main content */}
        <div className="flex-1 min-w-[280px] space-y-2">
          {/* Title */}
          <h3 className="text-lg font-semibold leading-snug">
            {hasDetailPage ? (
              <Link
                href={`/trials/${slugValue}`}
                className="text-[#1a1a1a] hover:text-purple transition-colors"
              >
                {trial.title}
              </Link>
            ) : (
              <span className="text-[#1a1a1a]">{trial.title}</span>
            )}
          </h3>

          {/* Therapeutic areas + Sponsor */}
          {(therapeuticLabels.length > 0 || trial.ctGovData?.sponsor) && (
            <p className="text-sm text-[#666]">
              {therapeuticLabels.length > 0 && therapeuticLabels.join(', ')}
              {therapeuticLabels.length > 0 && trial.ctGovData?.sponsor && ' · '}
              {trial.ctGovData?.sponsor}
            </p>
          )}
        </div>

        {/* Right side (intentionally empty; title is the link) */}
        <div className="flex items-center gap-3 flex-wrap" />
      </div>

      {/* PI badge */}
      {trial.principalInvestigator?.name && (
        <div className="flex flex-wrap gap-2 text-sm">
          <Link
            href={`/team/${trial.principalInvestigator.slug?.current || trial.principalInvestigator.slug || ''}`}
            className="inline-flex items-center gap-2 border border-black/[0.08] px-3 py-1.5 hover:border-purple transition-colors"
          >
            <Avatar photo={trial.principalInvestigator.photo} name={trial.principalInvestigator.name} />
            <span className="text-purple font-medium">{trial.principalInvestigator.name}</span>
          </Link>
        </div>
      )}

      {/* Summary */}
      {summaryText && (
        <p className="text-sm text-[#666] bg-[#F5F3F0] border border-black/[0.06] p-4">
          {summaryText}
        </p>
      )}

    </article>
  )
}

/**
 * Compact trial card for completed studies
 */
export function TrialCardCompact({ trial }) {
  const config = statusConfig[trial.status] || statusConfig.completed
  const slugValue = trial.slug?.current || trial.slug
  const hasDetailPage = !!slugValue
  const ctGovUrl = trial.nctId ? `https://clinicaltrials.gov/study/${trial.nctId}` : null

  const handleCardClick = (e) => {
    if (hasDetailPage) {
      window.location.href = `/trials/${slugValue}`
    }
  }

  return (
    <article 
      onClick={handleCardClick}
      className="group block p-4 bg-gray-50 border border-gray-200 rounded-lg hover:bg-gray-100 hover:border-gray-300 transition-all cursor-pointer"
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${config.style}`}>
          {config.label}
        </span>
        {trial.nctId && (
          <span className="text-xs text-gray-400 font-mono">{trial.nctId}</span>
        )}
      </div>
      <h3 className="text-sm font-medium text-gray-700 line-clamp-2 mb-2 group-hover:text-purple transition-colors">
        {trial.title}
      </h3>
      {ctGovUrl && (
        <a
          href={ctGovUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-gray-500 hover:text-purple transition"
          onClick={(e) => e.stopPropagation()}
        >
          View on CT.gov ↗
        </a>
      )}
    </article>
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

// Keep TrialCard export for backwards compatibility but it's no longer used
export function TrialCard({ trial }) {
  return <TrialItem trial={trial} />
}
