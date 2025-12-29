/**
 * Sync clinical trial data from ClinicalTrials.gov
 * and generate clinician-focused summaries using LLM
 * 
 * This module orchestrates:
 * 1. Fetching detailed trial info from ClinicalTrials.gov API
 * 2. Generating clinician-focused study summary
 * 3. Mapping data to Sanity schema structure
 */

import { getTrialByNCTId } from './clinicaltrials.js'
import { generateTrialSummary } from './summaries.js'

/**
 * Fetch a trial from ClinicalTrials.gov by NCT ID
 * This is a convenience wrapper around getTrialByNCTId
 * 
 * @param {string} nctId - NCT identifier (e.g., NCT12345678)
 * @returns {Promise<Object>} Parsed trial data
 */
export async function fetchTrialFromCTGov(nctId) {
  return getTrialByNCTId(nctId)
}

/**
 * Map phase values from ClinicalTrials.gov to our schema
 */
const PHASE_MAPPING = {
  'EARLY_PHASE1': 'phase1',
  'PHASE1': 'phase1',
  'PHASE1_PHASE2': 'phase1_2',
  'PHASE2': 'phase2',
  'PHASE2_PHASE3': 'phase2_3',
  'PHASE3': 'phase3',
  'PHASE4': 'phase4',
  'NA': 'na'
}

/**
 * Map study type values
 */
const STUDY_TYPE_MAPPING = {
  'INTERVENTIONAL': 'interventional',
  'OBSERVATIONAL': 'observational'
}

/**
 * Map status values from ClinicalTrials.gov to our schema
 */
const STATUS_MAPPING = {
  'RECRUITING': 'recruiting',
  'NOT_YET_RECRUITING': 'coming_soon',
  'ENROLLING_BY_INVITATION': 'recruiting',
  'ACTIVE_NOT_RECRUITING': 'active_not_recruiting',
  'COMPLETED': 'completed',
  'TERMINATED': 'completed',
  'WITHDRAWN': 'completed',
  'SUSPENDED': 'active_not_recruiting'
}

/**
 * Transform raw ClinicalTrials.gov data to our Sanity schema structure
 * 
 * @param {Object} rawData - Data from getTrialByNCTId
 * @returns {Object} Data structured for Sanity trialSummary document
 */
function transformToSanitySchema(rawData) {
  const phases = rawData.phases || []
  const primaryPhase = phases[0] || 'NA'

  return {
    // Fields that can be set if missing (user can override)
    studyType: STUDY_TYPE_MAPPING[rawData.studyType] || 'interventional',
    phase: PHASE_MAPPING[primaryPhase] || 'na',
    
    // Eligibility data (overwritten on sync to stay current)
    inclusionCriteria: rawData.eligibility?.inclusionCriteria || [],
    exclusionCriteria: rawData.eligibility?.exclusionCriteria || [],
    // Synced data object (read-only in Sanity, always overwritten)
    ctGovData: {
      briefTitle: rawData.briefTitle || null,
      officialTitle: rawData.officialTitle || null,
      briefSummary: rawData.briefSummary || null,
      detailedDescription: rawData.detailedDescription || null,
      overallStatus: rawData.status || null,
      phase: rawData.phase || null,
      studyType: rawData.studyType || null,
      sponsor: rawData.sponsor || null,
      enrollmentCount: rawData.enrollment?.count || null,
      startDate: rawData.startDate || null,
      completionDate: rawData.completionDate || null,
      interventions: (rawData.interventions || []).map(i => 
        typeof i === 'string' ? i : `${i.name} (${i.type})`
      ),
      eligibilityCriteriaRaw: rawData.eligibility?.criteria || null,
      lastSyncedAt: new Date().toISOString(),
      url: rawData.url || `https://clinicaltrials.gov/study/${rawData.nctId}`
    },

    // Internal data for summary generation
    _forSummaryGeneration: {
      briefTitle: rawData.briefTitle,
      officialTitle: rawData.officialTitle,
      briefSummary: rawData.briefSummary,
      detailedDescription: rawData.detailedDescription,
      conditions: rawData.conditions,
      interventions: rawData.interventions,
      nctId: rawData.nctId
    }
  }
}

/**
 * Full sync: fetch from ClinicalTrials.gov and generate summaries
 * 
 * @param {string} nctId - NCT identifier
 * @param {Object} options - Options
 * @param {boolean} options.generateSummary - Generate clinician summary (default: true)
 * @returns {Promise<Object>} Data ready to be patched into Sanity document
 */
export async function syncTrialData(nctId, options = {}) {
  const {
    generateSummary = true,
    summaryOptions = {}
  } = options

  console.log(`[trialSync] Fetching trial data for ${nctId}...`)
  
  // Fetch detailed trial data from ClinicalTrials.gov
  const rawData = await fetchTrialFromCTGov(nctId)
  
  // Transform to our schema structure
  const trialData = transformToSanitySchema(rawData)
  
  // Generate clinician-focused summary
  let laySummary = null
  if (generateSummary && trialData._forSummaryGeneration) {
    console.log(`[trialSync] Generating study summary for ${nctId}...`)
    try {
      laySummary = await generateTrialSummary(trialData._forSummaryGeneration, {
        debug: process.env.LLM_DEBUG === 'true',
        ...summaryOptions
      })
    } catch (error) {
      console.error(`[trialSync] Error generating summary for ${nctId}:`, error.message)
    }
  }

  // Clean up internal fields
  delete trialData._forSummaryGeneration

  console.log(`[trialSync] Successfully processed ${nctId}`)

  return {
    ...trialData,
    laySummary
  }
}

/**
 * Check if a trial needs syncing based on last sync time
 * 
 * @param {string} lastSyncedAt - ISO date string of last sync
 * @param {number} maxAgeHours - Hours before re-sync needed (default: 168 = 1 week)
 * @returns {boolean} True if sync is needed
 */
export function needsSync(lastSyncedAt, maxAgeHours = 168) {
  if (!lastSyncedAt) return true
  
  const lastSync = new Date(lastSyncedAt)
  const now = new Date()
  const hoursSinceSync = (now - lastSync) / (1000 * 60 * 60)
  
  return hoursSinceSync > maxAgeHours
}

/**
 * Validate NCT ID format
 * 
 * @param {string} nctId - The NCT ID to validate
 * @returns {boolean} True if valid format
 */
export function isValidNctId(nctId) {
  return /^NCT\d{8}$/i.test(nctId)
}
