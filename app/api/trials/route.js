import { NextResponse } from 'next/server'
import { searchTrials, getTrialsForResearchers } from '@/lib/clinicaltrials'
import { sanityFetch, queries } from '@/lib/sanity'

let cachedTrials = null
let lastFetch = null
const CACHE_DURATION = 12 * 60 * 60 * 1000 // 12 hours

export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const forceRefresh = searchParams.get('refresh') === 'true'
  const statusFilter = searchParams.get('status') // 'active', 'completed', 'all'

  try {
    // Return cached if valid
    if (!forceRefresh && cachedTrials && lastFetch) {
      const age = Date.now() - lastFetch
      if (age < CACHE_DURATION) {
        return NextResponse.json({
          trials: filterByStatus(cachedTrials, statusFilter),
          cached: true,
          lastFetch: new Date(lastFetch).toISOString()
        })
      }
    }

    // Get researchers from Sanity to search by their names
    const researchers = await sanityFetch(queries.allResearchers)
    const settings = await sanityFetch(queries.siteSettings)

    // Collect trials from multiple sources
    let allTrials = []
    const seenNCTIds = new Set()

    // 1. Search by institution/affiliation
    if (settings?.institutionAffiliation) {
      const instTrials = await searchTrials({
        affiliation: settings.institutionAffiliation,
        status: ['RECRUITING', 'NOT_YET_RECRUITING', 'ACTIVE_NOT_RECRUITING', 'COMPLETED']
      })
      
      for (const trial of instTrials) {
        if (!seenNCTIds.has(trial.nctId)) {
          seenNCTIds.add(trial.nctId)
          allTrials.push(trial)
        }
      }
    }

    // 2. Search by researcher names (PIs)
    const researcherNames = researchers
      .map(r => r.name)
      .filter(Boolean)

    if (researcherNames.length) {
      const piTrials = await getTrialsForResearchers(researcherNames, {
        status: ['RECRUITING', 'NOT_YET_RECRUITING', 'ACTIVE_NOT_RECRUITING', 'COMPLETED']
      })
      
      for (const trial of piTrials) {
        if (!seenNCTIds.has(trial.nctId)) {
          seenNCTIds.add(trial.nctId)
          allTrials.push(trial)
        }
      }
    }

    // Sort by status (recruiting first) then by date
    allTrials.sort((a, b) => {
      const statusOrder = {
        'RECRUITING': 0,
        'NOT_YET_RECRUITING': 1,
        'ACTIVE_NOT_RECRUITING': 2,
        'COMPLETED': 3
      }
      
      const statusDiff = (statusOrder[a.status] || 99) - (statusOrder[b.status] || 99)
      if (statusDiff !== 0) return statusDiff
      
      return new Date(b.lastUpdateDate) - new Date(a.lastUpdateDate)
    })

    // Update cache
    cachedTrials = allTrials
    lastFetch = Date.now()

    return NextResponse.json({
      trials: filterByStatus(allTrials, statusFilter),
      cached: false,
      lastFetch: new Date(lastFetch).toISOString(),
      count: allTrials.length
    })

  } catch (error) {
    console.error('Error fetching trials:', error)
    
    if (cachedTrials) {
      return NextResponse.json({
        trials: filterByStatus(cachedTrials, statusFilter),
        cached: true,
        stale: true,
        error: 'Failed to refresh, returning cached data'
      })
    }

    return NextResponse.json(
      { error: 'Failed to fetch trials' },
      { status: 500 }
    )
  }
}

function filterByStatus(trials, filter) {
  if (!filter || filter === 'all') return trials
  
  if (filter === 'active') {
    return trials.filter(t => 
      ['RECRUITING', 'NOT_YET_RECRUITING', 'ACTIVE_NOT_RECRUITING'].includes(t.status)
    )
  }
  
  if (filter === 'completed') {
    return trials.filter(t => t.status === 'COMPLETED')
  }
  
  return trials
}

