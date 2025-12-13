import { NextResponse } from 'next/server'
import { syncTrialData, fetchTrialFromCTGov } from '@/lib/trialSync'

// CORS headers for Sanity Studio
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

/**
 * OPTIONS handler for CORS preflight
 */
export async function OPTIONS() {
  return NextResponse.json({}, { headers: corsHeaders })
}

/**
 * POST /api/trials/sync
 * 
 * Sync a trial from ClinicalTrials.gov by NCT ID
 * 
 * Body: { nctId: "NCT12345678", generateSummary: true }
 * 
 * Returns the synced trial data ready to be merged into Sanity document
 * 
 * Note: No auth required - this only fetches public data from ClinicalTrials.gov
 */
export async function POST(request) {
  try {
    const body = await request.json()
    const { 
      nctId, 
      generateSummary = true,
      generateEligibilityOverview = true 
    } = body

    if (!nctId) {
      return NextResponse.json(
        { error: 'NCT ID is required' },
        { status: 400, headers: corsHeaders }
      )
    }

    // Normalize and validate NCT ID format
    const normalizedNctId = nctId.toUpperCase().trim()
    if (!/^NCT\d{8}$/.test(normalizedNctId)) {
      return NextResponse.json(
        { error: 'Invalid NCT ID format. Expected: NCT followed by 8 digits (e.g., NCT12345678)' },
        { status: 400, headers: corsHeaders }
      )
    }

    console.log(`[trial-sync] Syncing trial: ${normalizedNctId}`)

    // Sync the trial data
    const trialData = await syncTrialData(normalizedNctId, {
      generateSummary,
      generateEligibilityOverview
    })

    console.log(`[trial-sync] Successfully synced: ${nctId}`)

    return NextResponse.json({
      success: true,
      nctId,
      data: trialData
    }, { headers: corsHeaders })

  } catch (error) {
    console.error('[trial-sync] Error:', error)

    // Check for specific error types
    if (error.message?.includes('not found')) {
      return NextResponse.json(
        { error: `Trial not found: ${error.message}` },
        { status: 404, headers: corsHeaders }
      )
    }

    return NextResponse.json(
      { error: error.message || 'Failed to sync trial data' },
      { status: 500, headers: corsHeaders }
    )
  }
}

/**
 * GET /api/trials/sync?nctId=NCT12345678
 * 
 * Preview what data would be synced (without generating LLM summary)
 */
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)
    const nctId = searchParams.get('nctId')

    if (!nctId) {
      return NextResponse.json(
        { error: 'NCT ID is required as query parameter' },
        { status: 400, headers: corsHeaders }
      )
    }

    // Validate NCT ID format
    if (!/^NCT\d{8}$/.test(nctId)) {
      return NextResponse.json(
        { error: 'Invalid NCT ID format' },
        { status: 400, headers: corsHeaders }
      )
    }

    // Fetch trial data (without LLM summary for preview)
    const trialData = await fetchTrialFromCTGov(nctId)

    return NextResponse.json({
      success: true,
      nctId,
      preview: true,
      data: trialData
    }, { headers: corsHeaders })

  } catch (error) {
    console.error('[trial-sync] Preview error:', error)

    if (error.message?.includes('not found')) {
      return NextResponse.json(
        { error: `Trial not found: ${error.message}` },
        { status: 404, headers: corsHeaders }
      )
    }

    return NextResponse.json(
      { error: error.message || 'Failed to fetch trial data' },
      { status: 500, headers: corsHeaders }
    )
  }
}
