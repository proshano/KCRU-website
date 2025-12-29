const BASE_URL = 'https://clinicaltrials.gov/api/v2'

// Fields to request for detailed trial information (including eligibility)
const DETAILED_FIELDS = [
  'NCTId',
  'BriefTitle',
  'OfficialTitle',
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

// Basic fields for search results (lighter payload)
const SEARCH_FIELDS = [
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
]

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
    'fields': SEARCH_FIELDS.join('|')
  })

  const response = await fetch(`${BASE_URL}/studies?${params}`)
  
  if (!response.ok) {
    throw new Error(`ClinicalTrials.gov API error: ${response.status}`)
  }
  
  const data = await response.json()
  
  return (data.studies || []).map(parseStudy)
}

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
 * Parse API response into cleaner structure (basic info for search results)
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
 * Parse eligibility criteria text into structured inclusion/exclusion arrays
 * ClinicalTrials.gov stores both in a single text block
 */
function normalizeCriteriaText(criteriaText) {
  return criteriaText
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\\([\\[\\]().,:;!?<>])/g, '$1')
    .replace(/\\+([<>^\\[\\]])/g, '$1')
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

function stripBulletPrefix(line) {
  const patterns = [
    /^[-*•]\s+/,
    /^\d+[.)]\s+/,
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

function parseEligibilityCriteria(criteriaText) {
  if (!criteriaText) {
    return { inclusionCriteria: [], exclusionCriteria: [], rawText: null }
  }

  const normalizedText = splitInlineHeaders(normalizeCriteriaText(criteriaText))
  const rawLines = normalizedText.split('\n')
  const inclusionItems = []
  const exclusionItems = []
  const stacks = { inclusion: [], exclusion: [] }
  const headerRegex = /^\s*(Inclusion|Exclusion)\s+Criteria\s*:?\s*$/i
  const inlineHeaderRegex = /\b(Inclusion|Exclusion)\s+Criteria\b/i
  let currentSection = null
  let parsingComplex = false

  const addItem = (section, item) => {
    const stack = stacks[section]
    while (stack.length && item.indent <= stack[stack.length - 1].indent) {
      stack.pop()
    }
    if (stack.length) {
      stack[stack.length - 1].children.push(item)
    } else if (section === 'inclusion') {
      inclusionItems.push(item)
    } else {
      exclusionItems.push(item)
    }
    stack.push(item)
  }

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
      stacks[currentSection] = []
      continue
    }

    if (!currentSection) currentSection = 'inclusion'

    if (trimmed === '-' || trimmed === '*' || trimmed === '•') continue

    const indent = (rawLine.match(/^\s*/) || [''])[0].replace(/\t/g, '  ').length
    const { text: cleaned, isListItem } = stripBulletPrefix(trimmed)
    if (!cleaned) continue

    const stack = stacks[currentSection]
    const lastItem = stack[stack.length - 1]

    if (!isListItem && lastItem) {
      lastItem.text = `${lastItem.text} ${cleaned}`.replace(/\s+/g, ' ').trim()
      continue
    }

    addItem(currentSection, { text: cleaned, indent, children: [] })
  }

  const flattenItems = (items, section) => {
    const result = []
    for (const item of items) {
      const childTexts = flattenItems(item.children, section)
      if (childTexts.length) {
        const text = item.text.trim()
        const hasColon = /:\s*$/.test(text)
        const isExceptionParent = section === 'exclusion' && /\bexcept\b/i.test(text)
        if (hasColon || isExceptionParent) {
          const joined = childTexts.join('; ')
          const merged = isExceptionParent
            ? `${text} Exceptions: ${joined}`
            : `${text} ${joined}`
          result.push(merged.trim())
        } else {
          result.push(text)
          result.push(...childTexts)
        }
      } else if (item.text) {
        result.push(item.text.trim())
      }
    }
    return result.filter(Boolean)
  }

  return {
    inclusionCriteria: flattenItems(inclusionItems, 'inclusion'),
    exclusionCriteria: flattenItems(exclusionItems, 'exclusion'),
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
