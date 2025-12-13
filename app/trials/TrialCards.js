'use client'

import Link from 'next/link'

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
      className="group h-full flex flex-col bg-white border border-gray-200 rounded-lg overflow-hidden hover:shadow-md hover:border-gray-300 transition-all cursor-pointer"
    >
      <div className="p-4 flex-1">
        {/* Status + NCT row */}
        <div className="flex items-center justify-between gap-2 mb-2">
          <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 text-[11px] font-semibold rounded-full ${config.style}`}>
            {config.dot === 'animate' && (
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
              </span>
            )}
            {config.dot === 'static' && (
              <span className="h-1.5 w-1.5 rounded-full bg-purple/60" />
            )}
            {config.label}
          </span>
          {trial.nctId && (
            <span className="text-[10px] text-gray-400 font-mono">{trial.nctId}</span>
          )}
        </div>

        {/* Title */}
        <h3 className="text-base font-semibold text-gray-900 mb-2 leading-tight line-clamp-2 group-hover:text-purple transition-colors">
          {trial.title}
        </h3>

        {/* Conditions */}
        {trial.conditions?.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-2">
            {trial.conditions.slice(0, 2).map((condition, i) => (
              <span key={i} className="px-1.5 py-0.5 text-[10px] font-medium bg-purple/10 text-purple rounded">
                {condition}
              </span>
            ))}
            {trial.conditions.length > 2 && (
              <span className="px-1.5 py-0.5 text-[10px] text-gray-500">
                +{trial.conditions.length - 2}
              </span>
            )}
          </div>
        )}

        {/* Summary - 2 lines */}
        {summaryText && (
          <p className="text-xs text-gray-600 line-clamp-2 mb-2">
            {summaryText}
          </p>
        )}

        {/* Age + Therapeutic areas inline */}
        <div className="flex flex-wrap items-center gap-2 text-[10px] text-gray-500 mt-auto">
          {(trial.ageRange?.minimum || trial.ageRange?.maximum) && (
            <span>
              Ages: {trial.ageRange.minimum || '–'} to {trial.ageRange.maximum || '–'}
            </span>
          )}
          {trial.therapeuticAreas?.length > 0 && (
            <>
              {(trial.ageRange?.minimum || trial.ageRange?.maximum) && <span>•</span>}
              {trial.therapeuticAreas.slice(0, 2).map((area, i) => (
                <span key={area._id} className="px-1.5 py-0.5 bg-gray-100 rounded text-gray-600">
                  {area.shortLabel || area.name}
                </span>
              ))}
            </>
          )}
        </div>
      </div>

      {/* Compact footer */}
      <div className="px-4 py-2.5 bg-gray-50 border-t border-gray-100">
        <div className="flex items-center justify-between gap-2">
          <div className="flex-1 min-w-0 text-[11px] text-gray-500 truncate" onClick={(e) => e.stopPropagation()}>
            {trial.principalInvestigator?.name ? (
              <Link href={`/team/${trial.principalInvestigator.slug?.current || trial.principalInvestigator.slug || ''}`} className="hover:text-purple">
                PI: {trial.principalInvestigator.name}
              </Link>
            ) : trial.ctGovData?.sponsor ? (
              <span className="truncate">{trial.ctGovData.sponsor}</span>
            ) : null}
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {ctGovUrl && (
              <a
                href={ctGovUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[10px] text-gray-400 hover:text-purple transition"
                onClick={(e) => e.stopPropagation()}
              >
                CT.gov ↗
              </a>
            )}
            <span className="text-[11px] font-medium text-purple">
              Details →
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

