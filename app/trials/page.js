import Link from 'next/link'
import { sanityFetch, queries } from '@/lib/sanity'
import { TrialCard, TrialCardCompact } from './TrialCards'

// Revalidate every 12 hours
export const revalidate = 43200

export const metadata = {
  title: 'Clinical Studies | KCRU',
  description: 'Find kidney research studies currently recruiting participants at our sites.',
}

export default async function TrialsPage({ searchParams }) {
  // In Next.js 15+, searchParams is a Promise
  const params = await searchParams
  
  const [trialsRaw, areasRaw] = await Promise.all([
    sanityFetch(queries.trialSummaries),
    sanityFetch(queries.therapeuticAreas)
  ])
  
  const allTrials = JSON.parse(JSON.stringify(trialsRaw || []))
  const areas = JSON.parse(JSON.stringify(areasRaw || []))

  // Get selected area filter from URL
  const selectedArea = params?.area || null

  // Filter trials by therapeutic area if selected
  const trials = selectedArea
    ? allTrials.filter(t => 
        t.therapeuticAreas?.some(a => a.slug === selectedArea)
      )
    : allTrials

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
        {activeNotRecruitingTrials.length > 0 && (
          <div className="flex items-center gap-2 text-gray-600">
            <span className="h-3 w-3 rounded-full bg-purple" />
            <span>{activeNotRecruitingTrials.length} active, not recruiting</span>
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
            {/* Show All button */}
            <Link
              href="/trials"
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-full transition ${
                !selectedArea
                  ? 'bg-purple text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              All
              <span className={`text-xs ${!selectedArea ? 'text-white/70' : 'text-gray-500'}`}>
                ({allTrials.length})
              </span>
            </Link>
            {areas.filter(a => a.trialCount > 0).map((area) => {
              const isActive = selectedArea === area.slug
              return (
                <Link
                  key={area._id}
                  href={`/trials?area=${area.slug}`}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-full transition ${
                    isActive
                      ? 'bg-purple text-white'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  {area.icon && <span>{area.icon}</span>}
                  {area.shortLabel || area.name}
                  <span className={`text-xs ${isActive ? 'text-white/70' : 'text-gray-500'}`}>
                    ({area.trialCount})
                  </span>
                </Link>
              )
            })}
          </div>
        </div>
      )}

      {/* Filter active indicator */}
      {selectedArea && (
        <div className="mb-6 flex items-center gap-2 text-sm">
          <span className="text-gray-500">
            Showing {trials.length} {trials.length === 1 ? 'study' : 'studies'} in{' '}
            <span className="font-medium text-gray-900">
              {areas.find(a => a.slug === selectedArea)?.name || selectedArea}
            </span>
          </span>
          <Link
            href="/trials"
            className="text-purple hover:text-purple/80 font-medium"
          >
            Clear filter
          </Link>
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
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
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
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {comingSoonTrials.map((trial) => (
              <TrialCard key={trial._id} trial={trial} />
            ))}
          </div>
        </section>
      )}

      {/* Active but not recruiting */}
      {activeNotRecruitingTrials.length > 0 && (
        <section className="mb-12">
          <h2 className="text-2xl font-bold mb-6">Active Studies (Not Recruiting)</h2>
          <p className="text-sm text-gray-500 -mt-4 mb-6">These studies are ongoing but no longer accepting new participants.</p>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
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
