const BASE_URL = 'https://clinicaltrials.gov/api/v2'

// Fields to request for detailed trial information (including eligibility)
const DETAILED_FIELDS = [
  'NCTId',
  'BriefTitle',
  'OfficialTitle',
  'Acronym',
  'OverallStatus',
  'StartDate',
  'PrimaryCompletionDate',
  'CompletionDate',
  'LastUpdatePostDate',
  'LeadSponsorName',
  'ResponsiblePartyInvestigatorFullName',
  'BriefSummary',
  'DetailedDescription',
  'Condition',
  'Keyword',
  'InterventionName',
  'InterventionType',
  'InterventionDescription',
  'Phase',
  'StudyType',
  'DesignPrimaryPurpose',
  'EnrollmentCount',
  'EnrollmentType',
  'EligibilityCriteria',
  'HealthyVolunteers',
  'Sex',
  'MinimumAge',
  'MaximumAge',
  'StdAge',
  'LocationFacility',
  'LocationCity',
  'LocationState',
  'LocationCountry',
  'LocationStatus',
  'CentralContactName',
  'CentralContactPhone',
  'CentralContactEMail',
  'OverallOfficialName',
  'OverallOfficialAffiliation',
  'OverallOfficialRole'
]

/**
 * Get a single trial by NCT ID with full details including eligibility
 * @param {string} nctId - The NCT identifier (e.g., NCT12345678)
 * @returns {Promise<DetailedStudy>} Full study details
 */
export async function getTrialByNCTId(nctId) {
  // Validate NCT ID format
  if (!nctId || !/^NCT\d{8}$/i.test(nctId)) {
    throw new Error(`Invalid NCT ID format: ${nctId}. Expected format: NCT12345678`)
  }

  const params = new URLSearchParams({
    'fields': DETAILED_FIELDS.join('|')
  })

  const response = await fetch(`${BASE_URL}/studies/${nctId.toUpperCase()}?${params}`)
  
  if (!response.ok) {
    if (response.status === 404) {
      throw new Error(`Trial not found: ${nctId}`)
    }
    throw new Error(`ClinicalTrials.gov API error: ${response.status}`)
  }
  
  const data = await response.json()
  return parseDetailedStudy(data)
}

/**
 * Parse eligibility criteria text into structured inclusion/exclusion arrays
 * ClinicalTrials.gov stores both in a single text block
 */
function normalizeCriteriaText(criteriaText) {
  return criteriaText
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/\\+([\\[\\]().,:;!?<>^])/g, '$1')
    .replace(/\\+/g, '')
    .replace(/&gt;/gi, '>')
    .replace(/&lt;/gi, '<')
    .replace(/&amp;/gi, '&')
}

function splitInlineHeaders(text) {
  return text.replace(
    /([^\n])(\b(?:Inclusion|Exclusion)\s+Criteria:)/gi,
    '$1\n$2'
  )
}

function splitInlineBullets(text) {
  return text
    .replace(/([^\n0-9])(\s+\d{1,2}[.)]\s+)/g, '$1\n$2')
    .replace(/(^|[.;:])(\s+\d{1,2}\s+(?=[A-Z]))/gm, '$1\n$2')
}

function stripBulletPrefix(line) {
  const patterns = [
    /^[-*•]\s+/,
    /^\d+[.)]\s+/,
    /^\d+\s+(?=[A-Z])/,
    /^[a-zA-Z][.)]\s+/,
    /^\([a-zA-Z]\)\s+/,
  ]
  for (const pattern of patterns) {
    if (pattern.test(line)) {
      return { text: line.replace(pattern, '').trim(), isListItem: true }
    }
  }
  return { text: line.trim(), isListItem: false }
}

function cleanCriteriaItem(text) {
  if (!text) return null
  let cleaned = String(text)
    .replace(/\\+/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s+([,;:.])/g, '$1')
    .replace(/([,;:])(\S)/g, '$1 $2')
    .replace(/\(\s+/g, '(')
    .replace(/\s+\)/g, ')')
    .replace(/\[\s+/g, '[')
    .replace(/\s+\]/g, ']')
    .replace(/\)\s*\)/g, ')')
    .replace(/\(\s*\(/g, '(')
    .trim()

  if (/^\[?\s*obsolete\s*\]?$/i.test(cleaned)) return null
  if (/^\(?[a-zA-Z]\)?$/.test(cleaned)) return null
  return cleaned
}

function parseEligibilityCriteria(criteriaText) {
  if (!criteriaText) {
    return { inclusionCriteria: [], exclusionCriteria: [], rawText: null }
  }

  const normalizedText = splitInlineBullets(splitInlineHeaders(normalizeCriteriaText(criteriaText)))
  const rawLines = normalizedText.split('\n')
  const inclusionCriteria = []
  const exclusionCriteria = []
  const lastIndex = { inclusion: -1, exclusion: -1 }
  const headerRegex = /^\s*(Inclusion|Exclusion)\s+Criteria\s*:?\s*$/i
  const inlineHeaderRegex = /\b(Inclusion|Exclusion)\s+Criteria\b/i
  let currentSection = null
  let parsingComplex = false

  for (const rawLine of rawLines) {
    if (!rawLine) continue
    const trimmed = rawLine.trim()
    if (!trimmed) continue

    if (/^\s*Eligibility\s+Criteria\s*:?\s*$/i.test(trimmed)) continue

    if (inlineHeaderRegex.test(trimmed) && !headerRegex.test(trimmed)) {
      parsingComplex = true
    }

    const headerMatch = trimmed.match(headerRegex)
    if (headerMatch) {
      currentSection = headerMatch[1].toLowerCase()
      continue
    }

    if (!currentSection) currentSection = 'inclusion'

    if (trimmed === '-' || trimmed === '*' || trimmed === '•') continue

    const { text: cleaned, isListItem } = stripBulletPrefix(trimmed)
    const cleanedItem = cleanCriteriaItem(cleaned)
    if (!cleanedItem) continue

    if (!isListItem && lastIndex[currentSection] >= 0) {
      if (currentSection === 'inclusion') {
        const merged = cleanCriteriaItem(`${inclusionCriteria[lastIndex.inclusion]} ${cleanedItem}`)
        if (merged) inclusionCriteria[lastIndex.inclusion] = merged
      } else {
        const merged = cleanCriteriaItem(`${exclusionCriteria[lastIndex.exclusion]} ${cleanedItem}`)
        if (merged) exclusionCriteria[lastIndex.exclusion] = merged
      }
      continue
    }

    if (currentSection === 'inclusion') {
      inclusionCriteria.push(cleanedItem)
      lastIndex.inclusion = inclusionCriteria.length - 1
    } else {
      exclusionCriteria.push(cleanedItem)
      lastIndex.exclusion = exclusionCriteria.length - 1
    }
  }

  return {
    inclusionCriteria,
    exclusionCriteria,
    rawText: normalizedText,
    parseWarnings: parsingComplex ? ['complex_structure'] : []
  }
}

/**
 * Parse detailed API response with full eligibility and contact info
 */
function parseDetailedStudy(study) {
  const protocol = study.protocolSection || {}
  const id = protocol.identificationModule || {}
  const status = protocol.statusModule || {}
  const sponsor = protocol.sponsorCollaboratorsModule || {}
  const description = protocol.descriptionModule || {}
  const conditions = protocol.conditionsModule || {}
  const interventions = protocol.armsInterventionsModule || {}
  const design = protocol.designModule || {}
  const eligibility = protocol.eligibilityModule || {}
  const contacts = protocol.contactsLocationsModule || {}

  // Extract all locations with full details
  const allLocations = contacts.locations || []
  const canadianSites = allLocations.filter(loc => 
    loc.country === 'Canada'
  ).map(loc => ({
    facility: loc.facility,
    city: loc.city,
    state: loc.state,
    country: loc.country,
    status: loc.status,
    contacts: loc.contacts || []
  }))

  // Parse eligibility criteria into structured format
  const parsedEligibility = parseEligibilityCriteria(eligibility.eligibilityCriteria)

  // Get central contacts
  const centralContacts = contacts.centralContacts || []
  
  // Get overall officials (PIs)
  const overallOfficials = contacts.overallOfficials || []
  const leadPI = overallOfficials.find(o => o.role === 'PRINCIPAL_INVESTIGATOR') || overallOfficials[0]

  return {
    // Identification
    nctId: id.nctId,
    briefTitle: id.briefTitle,
    officialTitle: id.officialTitle,
    acronym: id.acronym,
    url: `https://clinicaltrials.gov/study/${id.nctId}`,
    
    // Status & Dates
    status: status.overallStatus,
    statusVerifiedDate: status.statusVerifiedDate,
    startDate: status.startDateStruct?.date,
    primaryCompletionDate: status.primaryCompletionDateStruct?.date,
    completionDate: status.completionDateStruct?.date,
    lastUpdateDate: status.lastUpdatePostDateStruct?.date,
    
    // Sponsor & Investigator
    sponsor: sponsor.leadSponsor?.name,
    sponsorClass: sponsor.leadSponsor?.class, // INDUSTRY, NIH, OTHER, etc.
    principalInvestigator: sponsor.responsibleParty?.investigatorFullName || leadPI?.name,
    principalInvestigatorAffiliation: sponsor.responsibleParty?.investigatorAffiliation || leadPI?.affiliation,
    
    // Descriptions
    briefSummary: description.briefSummary,
    detailedDescription: description.detailedDescription,
    
    // Conditions & Keywords
    conditions: conditions.conditions || [],
    keywords: conditions.keywords || [],
    
    // Interventions
    interventions: (interventions.interventions || []).map(i => ({
      type: i.type,
      name: i.name,
      description: i.description
    })),
    
    // Study Design
    studyType: design.studyType, // INTERVENTIONAL, OBSERVATIONAL
    phases: design.phases || [],
    phase: design.phases?.join(', ') || 'N/A',
    designPrimaryPurpose: design.designInfo?.primaryPurpose,
    
    // Enrollment
    enrollment: {
      count: design.enrollmentInfo?.count,
      type: design.enrollmentInfo?.type // ACTUAL, ESTIMATED
    },
    
    // Eligibility (structured)
    eligibility: {
      criteria: eligibility.eligibilityCriteria, // Raw text
      inclusionCriteria: parsedEligibility.inclusionCriteria,
      exclusionCriteria: parsedEligibility.exclusionCriteria,
      healthyVolunteers: eligibility.healthyVolunteers,
      sex: eligibility.sex, // ALL, FEMALE, MALE
      minimumAge: eligibility.minimumAge,
      maximumAge: eligibility.maximumAge,
      stdAges: eligibility.stdAges // CHILD, ADULT, OLDER_ADULT
    },
    
    // Central Contacts
    centralContacts: centralContacts.map(c => ({
      name: c.name,
      phone: c.phone,
      email: c.email,
      role: c.role
    })),
    
    // Locations
    canadianSites,
    allSites: allLocations.map(loc => ({
      facility: loc.facility,
      city: loc.city,
      state: loc.state,
      country: loc.country,
      status: loc.status
    })),
    totalSites: allLocations.length,
    
    // Metadata
    fetchedAt: new Date().toISOString()
  }
}
