'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'
import { TrialSection } from './TrialCards'

/**
 * Normalize text for search - lowercase, remove special chars, collapse spaces
 */
function normalizeText(text) {
  if (!text) return ''
  return text
    .toLowerCase()
    .replace(/[-_./\\:;,()[\]{}'"]/g, ' ')  // Replace special chars with spaces
    .replace(/\s+/g, ' ')                    // Collapse multiple spaces
    .trim()
}

/**
 * Check if all search words appear in the text (in any order)
 */
function matchesAllWords(text, searchWords) {
  const normalizedText = normalizeText(text)
  return searchWords.every(word => normalizedText.includes(word))
}

/**
 * Client component for trials page with search functionality
 */
export default function TrialsClient({ allTrials, areas, selectedArea }) {
  const [searchQuery, setSearchQuery] = useState('')

  // Filter by therapeutic area first (from URL param)
  const areaFilteredTrials = useMemo(() => {
    if (!selectedArea) return allTrials
    return allTrials.filter(t => 
      t.therapeuticAreas?.some(a => a.slug === selectedArea)
    )
  }, [allTrials, selectedArea])

  // Then filter by search query
  const trials = useMemo(() => {
    if (!searchQuery.trim()) return areaFilteredTrials
    
    // Split query into words for flexible matching
    const searchWords = normalizeText(searchQuery).split(' ').filter(w => w.length > 0)
    if (searchWords.length === 0) return areaFilteredTrials
    
    return areaFilteredTrials.filter(trial => {
      // Build a combined searchable text for the trial
      const searchableFields = [
        trial.title,
        trial.nctId,
        trial.ctGovData?.sponsor,
        trial.laySummary,
        trial.principalInvestigator?.name,
        ...(trial.therapeuticAreas?.map(a => a.name) || []),
        ...(trial.therapeuticAreas?.map(a => a.shortLabel) || []),
      ].filter(Boolean)
      
      // Check if all search words appear in any of the fields
      const combinedText = searchableFields.join(' ')
      return matchesAllWords(combinedText, searchWords)
    })
  }, [areaFilteredTrials, searchQuery])

  // Separate by status
  const recruitingTrials = trials.filter(t => t.status === 'recruiting')
  const comingSoonTrials = trials.filter(t => t.status === 'coming_soon')
  const activeNotRecruitingTrials = trials.filter(t => 
    t.status === 'active_not_recruiting' || t.status === 'closed'
  )
  const completedTrials = trials.filter(t => t.status === 'completed')

  // Count recruiting for each area (unaffected by search)
  const recruitingCount = allTrials.filter(t => t.status === 'recruiting').length
  const comingSoonCount = allTrials.filter(t => t.status === 'coming_soon').length
  const activeNotRecruitingCount = allTrials.filter(t => 
    t.status === 'active_not_recruiting' || t.status === 'closed'
  ).length

  return (
    <>
      {/* Quick stats + Search bar row */}
      <div className="flex flex-col md:flex-row md:items-center gap-4 mb-8">
        {/* Stats */}
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm flex-shrink-0">
          <div className="flex items-center gap-2">
            <span className="flex h-3 w-3 relative flex-shrink-0">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
              <span className="relative inline-flex h-3 w-3 rounded-full bg-emerald-500" />
            </span>
            <span className="font-medium whitespace-nowrap">{recruitingCount} recruiting</span>
          </div>
          {comingSoonCount > 0 && (
            <div className="flex items-center gap-2 text-gray-600">
              <span className="h-3 w-3 rounded-full bg-amber-400 flex-shrink-0" />
              <span className="whitespace-nowrap">{comingSoonCount} coming soon</span>
            </div>
          )}
          {activeNotRecruitingCount > 0 && (
            <div className="flex items-center gap-2 text-gray-600">
              <span className="h-3 w-3 rounded-full bg-purple flex-shrink-0" />
              <span className="whitespace-nowrap">{activeNotRecruitingCount} active, not recruiting</span>
            </div>
          )}
        </div>

        {/* Search bar */}
        <div className="relative w-full md:w-[576px] md:ml-auto flex-shrink-0">
          <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
            <svg 
              className="h-4 w-4 text-gray-400" 
              fill="none" 
              viewBox="0 0 24 24" 
              stroke="currentColor"
            >
              <path 
                strokeLinecap="round" 
                strokeLinejoin="round" 
                strokeWidth={2} 
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" 
              />
            </svg>
          </div>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search studies..."
            className="block w-full pl-11 pr-10 py-2 border border-gray-200 rounded-lg bg-white text-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple/20 focus:border-purple transition-colors"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-400 hover:text-gray-600"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
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
                  {area.name}
                  <span className={`text-xs ${isActive ? 'text-white/70' : 'text-gray-500'}`}>
                    ({area.trialCount})
                  </span>
                </Link>
              )
            })}
          </div>
        </div>
      )}

      {/* Active filters indicator */}
      {(selectedArea || searchQuery) && (
        <div className="mb-6 flex flex-wrap items-center gap-2 text-sm">
          <span className="text-gray-500">
            Showing {trials.length} {trials.length === 1 ? 'study' : 'studies'}
            {selectedArea && (
              <> in <span className="font-medium text-gray-900">
                {areas.find(a => a.slug === selectedArea)?.name || selectedArea}
              </span></>
            )}
            {searchQuery && (
              <> matching "<span className="font-medium text-gray-900">{searchQuery}</span>"</>
            )}
          </span>
          {(selectedArea || searchQuery) && (
            <button
              onClick={() => {
                setSearchQuery('')
                if (selectedArea) {
                  window.location.href = '/trials'
                }
              }}
              className="text-purple hover:text-purple/80 font-medium"
            >
              Clear {selectedArea && searchQuery ? 'all' : 'filter'}
            </button>
          )}
        </div>
      )}

      {/* Study sections */}
      <div className="space-y-4">
        <TrialSection 
          title="Currently Recruiting" 
          trials={recruitingTrials} 
          defaultOpen={true}
          dotColor="bg-emerald-500"
        />

        <TrialSection 
          title="Coming Soon" 
          trials={comingSoonTrials} 
          defaultOpen={true}
          dotColor="bg-amber-400"
        />

        <TrialSection 
          title="Active, Not Recruiting" 
          subtitle="These studies are ongoing but no longer accepting new participants."
          trials={activeNotRecruitingTrials} 
          defaultOpen={true}
          dotColor="bg-purple"
        />

        <TrialSection 
          title="Completed" 
          trials={completedTrials} 
          defaultOpen={false}
          dotColor="bg-gray-400"
        />
      </div>

      {/* Empty state */}
      {trials.length === 0 && (
        <div className="text-center py-16 border border-dashed border-gray-200 rounded-lg">
          <svg 
            className="mx-auto h-12 w-12 text-gray-300 mb-4" 
            fill="none" 
            viewBox="0 0 24 24" 
            stroke="currentColor"
          >
            <path 
              strokeLinecap="round" 
              strokeLinejoin="round" 
              strokeWidth={1.5} 
              d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" 
            />
          </svg>
          <p className="text-gray-500 text-lg mb-1">No studies found</p>
          <p className="text-gray-400">
            {searchQuery 
              ? 'Try adjusting your search terms' 
              : 'Check back soon for new opportunities'
            }
          </p>
          {(searchQuery || selectedArea) && (
            <button
              onClick={() => {
                setSearchQuery('')
                if (selectedArea) {
                  window.location.href = '/trials'
                }
              }}
              className="mt-4 text-purple hover:text-purple/80 font-medium text-sm"
            >
              Clear filters
            </button>
          )}
        </div>
      )}
    </>
  )
}
