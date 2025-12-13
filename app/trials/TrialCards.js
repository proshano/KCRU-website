'use client'

import Link from 'next/link'
import Image from 'next/image'
import { urlFor } from '@/lib/sanity'

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

export function TrialCard({ trial }) {
  const config = statusConfig[trial.status] || statusConfig.recruiting
  const slugValue = trial.slug?.current || trial.slug
  const hasDetailPage = !!slugValue
  const ctGovUrl = trial.nctId ? `https://clinicaltrials.gov/study/${trial.nctId}` : null

  const summaryText = trial.laySummary || trial.eligibilityOverview || ''

  const handleCardClick = (e) => {
    if (hasDetailPage) {
      window.location.href = `/trials/${slugValue}`
    }
  }

  return (
    <article 
      onClick={handleCardClick}
      className="group h-full flex flex-col bg-white border border-gray-200 rounded-lg overflow-hidden hover:shadow-lg hover:border-gray-300 transition-all cursor-pointer"
    >
      <div className="p-6 flex-1">
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

        <h3 className="text-xl font-semibold text-gray-900 mb-3 leading-snug group-hover:text-purple transition-colors">
          {trial.title}
        </h3>

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

        {summaryText && (
          <p className="text-sm text-gray-600 line-clamp-3 mb-4">
            {summaryText}
          </p>
        )}

        {(trial.ageRange?.minimum || trial.ageRange?.maximum) && (
          <div className="text-xs text-gray-500 mb-3">
            <span className="font-medium">Ages:</span>{' '}
            {trial.ageRange.minimum || 'No min'} – {trial.ageRange.maximum || 'No max'}
          </div>
        )}

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

      <div className="px-6 py-4 bg-gray-50 border-t border-gray-100">
        <div className="flex items-center justify-between gap-4">
          <div className="flex-1 min-w-0" onClick={(e) => e.stopPropagation()}>
            {trial.principalInvestigator?.name ? (
              <InvestigatorBadge researcher={trial.principalInvestigator} />
            ) : trial.localContact?.displayPublicly && trial.localContact?.name ? (
              <span className="text-xs text-gray-500">Contact: {trial.localContact.name}</span>
            ) : trial.ctGovData?.sponsor ? (
              <span className="text-xs text-gray-500">Sponsor: {trial.ctGovData.sponsor}</span>
            ) : null}
          </div>

          <div className="flex items-center gap-3 flex-shrink-0">
            {ctGovUrl && (
              <a
                href={ctGovUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-gray-500 hover:text-purple transition"
                title="View on ClinicalTrials.gov"
                onClick={(e) => e.stopPropagation()}
              >
                CT.gov ↗
              </a>
            )}
            <span className="text-xs font-medium text-purple group-hover:underline">
              Learn more →
            </span>
          </div>
        </div>
      </div>
    </article>
  )
}

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
