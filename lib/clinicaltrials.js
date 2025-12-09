const BASE_URL = 'https://clinicaltrials.gov/api/v2'

/**
 * Search ClinicalTrials.gov for studies
 * @param {Object} options - Search parameters
 * @returns {Promise<Study[]>} Array of study objects
 */
export async function searchTrials({
  sponsor = null,
  principalInvestigator = null,
  affiliation = null,
  condition = null,
  status = ['RECRUITING', 'NOT_YET_RECRUITING', 'ACTIVE_NOT_RECRUITING'],
  maxResults = 100
} = {}) {
  
  // Build query terms
  const queryParts = []
  
  if (sponsor) {
    queryParts.push(`AREA[LeadSponsorName]${sponsor}`)
  }
  
  if (principalInvestigator) {
    queryParts.push(`AREA[ResponsiblePartyInvestigatorFullName]${principalInvestigator}`)
  }
  
  if (affiliation) {
    // Search in organization fields
    queryParts.push(`AREA[LocationFacility]${affiliation} OR AREA[LeadSponsorName]${affiliation}`)
  }
  
  if (condition) {
    queryParts.push(`AREA[Condition]${condition}`)
  }

  const params = new URLSearchParams({
    'query.term': queryParts.join(' AND '),
    'filter.overallStatus': status.join(','),
    'pageSize': maxResults.toString(),
    'sort': 'LastUpdatePostDate:desc',
    'fields': [
      'NCTId',
      'BriefTitle',
      'OfficialTitle',
      'OverallStatus',
      'StartDate',
      'PrimaryCompletionDate',
      'CompletionDate',
      'LeadSponsorName',
      'ResponsiblePartyInvestigatorFullName',
      'BriefSummary',
      'Condition',
      'InterventionName',
      'InterventionType',
      'Phase',
      'EnrollmentCount',
      'EnrollmentType',
      'LocationFacility',
      'LocationCity',
      'LocationCountry'
    ].join('|')
  })

  const response = await fetch(`${BASE_URL}/studies?${params}`)
  
  if (!response.ok) {
    throw new Error(`ClinicalTrials.gov API error: ${response.status}`)
  }
  
  const data = await response.json()
  
  return (data.studies || []).map(parseStudy)
}

/**
 * Get a single trial by NCT ID
 */
export async function getTrialByNCTId(nctId) {
  const response = await fetch(`${BASE_URL}/studies/${nctId}`)
  
  if (!response.ok) {
    throw new Error(`Trial not found: ${nctId}`)
  }
  
  const data = await response.json()
  return parseStudy(data)
}

/**
 * Parse API response into cleaner structure
 */
function parseStudy(study) {
  const protocol = study.protocolSection || {}
  const id = protocol.identificationModule || {}
  const status = protocol.statusModule || {}
  const sponsor = protocol.sponsorCollaboratorsModule || {}
  const description = protocol.descriptionModule || {}
  const conditions = protocol.conditionsModule || {}
  const interventions = protocol.armsInterventionsModule || {}
  const design = protocol.designModule || {}
  const enrollment = protocol.designModule || {}
  const locations = protocol.contactsLocationsModule || {}

  // Extract Canadian sites
  const allLocations = locations.locations || []
  const canadianSites = allLocations.filter(loc => 
    loc.country === 'Canada'
  ).map(loc => ({
    facility: loc.facility,
    city: loc.city,
    status: loc.status
  }))

  return {
    nctId: id.nctId,
    briefTitle: id.briefTitle,
    officialTitle: id.officialTitle,
    url: `https://clinicaltrials.gov/study/${id.nctId}`,
    
    status: status.overallStatus,
    startDate: status.startDateStruct?.date,
    primaryCompletionDate: status.primaryCompletionDateStruct?.date,
    completionDate: status.completionDateStruct?.date,
    lastUpdateDate: status.lastUpdatePostDateStruct?.date,
    
    sponsor: sponsor.leadSponsor?.name,
    principalInvestigator: sponsor.responsibleParty?.investigatorFullName,
    
    briefSummary: description.briefSummary,
    
    conditions: conditions.conditions || [],
    
    interventions: (interventions.interventions || []).map(i => ({
      type: i.type,
      name: i.name
    })),
    
    phase: design.phases?.join(', ') || 'N/A',
    
    enrollment: {
      count: enrollment.enrollmentInfo?.count,
      type: enrollment.enrollmentInfo?.type
    },
    
    canadianSites,
    totalSites: allLocations.length
  }
}

/**
 * Search by multiple PI names (for a research unit)
 */
export async function getTrialsForResearchers(researcherNames, options = {}) {
  const allTrials = []
  const seenNCTIds = new Set()

  for (const name of researcherNames) {
    try {
      const trials = await searchTrials({
        ...options,
        principalInvestigator: name
      })
      
      for (const trial of trials) {
        if (!seenNCTIds.has(trial.nctId)) {
          seenNCTIds.add(trial.nctId)
          allTrials.push(trial)
        }
      }
    } catch (error) {
      console.error(`Error fetching trials for ${name}:`, error)
    }
  }

  // Sort by last update date
  return allTrials.sort((a, b) => 
    new Date(b.lastUpdateDate) - new Date(a.lastUpdateDate)
  )
}

/**
 * Get trials for an institution/affiliation
 */
export async function getTrialsForInstitution(institutionName, options = {}) {
  return searchTrials({
    ...options,
    affiliation: institutionName
  })
}

