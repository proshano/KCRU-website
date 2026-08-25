import { client } from '../lib/sanity.js'
import { normalizeDoi } from '../lib/publicationIdentity.js'
import {
  classifyResearcherAuthor,
  decideAttributionEvidence,
  getResearcherPublicationNameParts,
  normalizeAttributionOrcid,
  normalizeAttributionText,
} from '../lib/publicationAttribution.js'

const CROSSREF_BASE_URL = 'https://api.crossref.org/works'
const RESULTS_PER_RESEARCHER = Number(process.env.ATTRIBUTION_AUDIT_RESULTS || 100)
const SINCE_YEAR = Number(process.env.PUBLICATIONS_SINCE_YEAR || 2022)
const REQUEST_DELAY_MS = Number(process.env.ATTRIBUTION_AUDIT_DELAY_MS || 150)
const MAX_RETRIES = 3
const REVIEWED_FALSE_ATTRIBUTIONS = new Set([
  'Danielle Nash|doi:10.1016/j.fusengdes.2026.115999',
])

const INSTITUTION_SIGNALS = [
  {
    id: 'western',
    queryTerms: ['western university', 'university of western ontario', 'western ontario', 'schulich'],
    affiliationTerms: ['western university', 'university of western ontario', 'schulich'],
  },
  {
    id: 'lhsc',
    queryTerms: ['london health sciences centre'],
    affiliationTerms: ['london health sciences centre', 'london health sciences center'],
  },
  {
    id: 'ices',
    queryTerms: ['ices'],
    affiliationTerms: ['ices'],
  },
  {
    id: 'london-ontario',
    queryTerms: ['london', 'ontario'],
    affiliationTerms: ['london ontario', 'london on canada', 'london canada'],
  },
  {
    id: 'toronto',
    queryTerms: ['university of toronto'],
    affiliationTerms: ['university of toronto'],
  },
  {
    id: 'boston',
    queryTerms: ['boston'],
    affiliationTerms: ['boston'],
  },
]

const normalizeText = normalizeAttributionText
const normalizeOrcid = normalizeAttributionOrcid
const splitResearcherName = getResearcherPublicationNameParts

function authorSignature({ given = '', family = '' } = {}) {
  const normalizedGiven = normalizeText(given)
  const normalizedFamily = normalizeText(family)
  if (!normalizedGiven || !normalizedFamily) return null
  return `${normalizedFamily}:${normalizedGiven[0]}`
}

function storedAuthorIdentity(author, publicationSource) {
  const parts = normalizeText(author).split(' ').filter(Boolean)
  if (parts.length < 2) return null

  const looksLikePubmed = publicationSource === 'pubmed' || /^[A-Za-z'-]+\s+[A-Z]{1,5}$/i.test(String(author).trim())
  if (looksLikePubmed) {
    return { family: parts[0], given: parts.slice(1).join(' ') }
  }
  return { family: parts.at(-1), given: parts.slice(0, -1).join(' ') }
}

function getResearcherSignature(researcher) {
  return authorSignature(splitResearcherName(researcher))
}

function getInstitutionSignals(researcher) {
  const query = normalizeText(researcher.pubmedQuery)
  return INSTITUTION_SIGNALS.filter((signal) => {
    return signal.queryTerms.every((term) => query.includes(term))
  })
}

function buildFingerprints({ researchers, publications, provenance }) {
  const publicationByKey = new Map(publications.map((publication) => [publication.publicationKey, publication]))
  const fingerprints = new Map(researchers.map((researcher) => [researcher._id, {
    researcher,
    confirmedPublicationKeys: new Set(),
    coauthorCounts: new Map(),
    institutionSignals: getInstitutionSignals(researcher),
  }]))

  for (const entry of provenance) {
    const publication = publicationByKey.get(entry.publicationKey)
    if (!publication?.sources?.includes('pubmed') && publication?.source !== 'pubmed') continue

    for (const researcherId of entry.researcherIds || []) {
      const fingerprint = fingerprints.get(researcherId)
      if (!fingerprint) continue
      fingerprint.confirmedPublicationKeys.add(entry.publicationKey)
      const researcherSignature = getResearcherSignature(fingerprint.researcher)

      for (const author of publication.authors || []) {
        const identity = storedAuthorIdentity(author, publication.source)
        const signature = authorSignature(identity)
        if (!signature || signature === researcherSignature) continue
        fingerprint.coauthorCounts.set(signature, (fingerprint.coauthorCounts.get(signature) || 0) + 1)
      }
    }
  }

  return fingerprints
}

function hasMatchingAffiliation(authorMatch, fingerprint) {
  const affiliations = normalizeText(authorMatch.affiliations.join(' '))
  if (!affiliations) return false
  return fingerprint.institutionSignals.some((signal) => {
    return signal.affiliationTerms.some((term) => affiliations.includes(term))
  })
}

function countKnownCoauthors(item, researcher, fingerprint) {
  const researcherSignature = getResearcherSignature(researcher)
  const matches = new Set()

  for (const author of item.author || []) {
    const signature = authorSignature(author)
    if (!signature || signature === researcherSignature) continue
    // A single shared paper can be coincidental, especially for common surnames.
    // Count only coauthors already seen on at least two confirmed publications.
    if ((fingerprint.coauthorCounts.get(signature) || 0) >= 2) matches.add(signature)
  }
  return matches.size
}

function evaluateCandidate(item, researcher, fingerprint) {
  const doi = normalizeDoi(item.DOI)
  const publicationKey = doi ? `doi:${doi}` : null
  if (publicationKey && fingerprint.confirmedPublicationKeys.has(publicationKey)) {
    return {
      decision: 'confirmed',
      reason: 'researcher-specific PubMed query',
      authorMatch: null,
      knownCoauthors: 0,
      affiliationMatch: false,
    }
  }

  const expectedOrcid = normalizeOrcid(researcher.orcid)
  const authorMatches = (item.author || [])
    .map((author) => classifyResearcherAuthor(author, researcher))
    .filter(Boolean)

  if (!authorMatches.length) return null
  const knownCoauthors = countKnownCoauthors(item, researcher, fingerprint)
  const evaluatedMatches = authorMatches.map((authorMatch) => {
    const affiliationMatch = hasMatchingAffiliation(authorMatch, fingerprint)
    const evidence = decideAttributionEvidence({
      hasExactOrcid: Boolean(authorMatch.orcid && expectedOrcid && authorMatch.orcid === expectedOrcid),
      hasConflictingOrcid: Boolean(authorMatch.orcid && expectedOrcid && authorMatch.orcid !== expectedOrcid),
      nameKind: authorMatch.kind,
      hasAffiliationMatch: affiliationMatch,
      recurringCoauthors: knownCoauthors,
    })
    return { ...evidence, authorMatch, knownCoauthors, affiliationMatch }
  })
  const decisionRank = { confirmed: 2, hold: 1, rejected: 0 }
  return evaluatedMatches.reduce((best, candidate) => {
    if (!best) return candidate
    if (decisionRank[candidate.decision] > decisionRank[best.decision]) return candidate
    if (candidate.authorMatch.kind === 'full' && best.authorMatch.kind !== 'full') return candidate
    return best
  }, null)
}

async function sleep(ms) {
  if (ms > 0) await new Promise((resolve) => setTimeout(resolve, ms))
}

async function fetchCrossrefJson(url) {
  let lastError = null
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'KCRU-publication-attribution-audit/1.0' },
    })
    if (response.ok) return response.json()
    lastError = new Error(`${response.status} ${response.statusText}`.trim())
    if (![429, 500, 502, 503, 504].includes(response.status) || attempt === MAX_RETRIES) throw lastError
    await sleep(500 * (attempt + 1))
  }
  throw lastError
}

async function fetchNameCandidates(researcher) {
  const params = new URLSearchParams({
    rows: String(RESULTS_PER_RESEARCHER),
    filter: `type:journal-article,from-pub-date:${SINCE_YEAR}-01-01`,
    'query.author': researcher.publicationAuthorName || researcher.name,
  })
  if (process.env.CROSSREF_MAILTO) params.set('mailto', process.env.CROSSREF_MAILTO)
  const data = await fetchCrossrefJson(`${CROSSREF_BASE_URL}?${params}`)
  return data?.message?.items || []
}

async function fetchWorkByDoi(doi) {
  try {
    const data = await fetchCrossrefJson(`${CROSSREF_BASE_URL}/${encodeURIComponent(doi)}`)
    return data?.message || null
  } catch (error) {
    console.warn(`[attribution-audit] Crossref DOI lookup failed for ${doi}`, error?.message || error)
    return null
  }
}

function crossrefLikeItemFromPublication(publication) {
  return {
    DOI: publication.doi,
    title: [publication.title],
    author: (publication.authors || [])
      .map((author) => storedAuthorIdentity(author, publication.source))
      .filter(Boolean),
  }
}

function summarizeReviewedCoverage(entries, decisionField = 'decision') {
  const reviewedPositive = entries.filter((entry) => !entry.isReviewedFalse)
  const reviewedNegative = entries.filter((entry) => entry.isReviewedFalse)
  return {
    reviewedPositive: reviewedPositive.length,
    retainedPositive: reviewedPositive.filter((entry) => entry[decisionField] === 'confirmed').length,
    missedPositive: reviewedPositive.filter((entry) => entry[decisionField] !== 'confirmed').length,
    reviewedNegative: reviewedNegative.length,
    suppressedNegative: reviewedNegative.filter((entry) => entry[decisionField] !== 'confirmed').length,
    failedToSuppressNegative: reviewedNegative.filter((entry) => entry[decisionField] === 'confirmed').length,
  }
}

function summarizeEvaluation({ researcher, item, evaluation, isCurrentlyPublished = false }) {
  return {
    researcher: researcher.name,
    doi: normalizeDoi(item.DOI),
    title: item.title?.[0] || '',
    matchedAuthor: evaluation.authorMatch
      ? [evaluation.authorMatch.given, evaluation.authorMatch.family].filter(Boolean).join(' ')
      : null,
    decision: evaluation.decision,
    reason: evaluation.reason,
    affiliationMatch: evaluation.affiliationMatch,
    knownCoauthors: evaluation.knownCoauthors,
    isCurrentlyPublished,
  }
}

async function main() {
  const { researchers, cache } = await client.fetch(`{
    "researchers": *[_type == "researcher"] | order(name asc) {
      _id,
      name,
      orcid,
      pubmedQuery,
      publicationAuthorName
    },
    "cache": *[_id == "pubmedCache"][0] {
      publications,
      provenance
    }
  }`)

  const publications = cache?.publications || []
  const provenance = cache?.provenance || []
  const fingerprints = buildFingerprints({ researchers, publications, provenance })
  const publicationByKey = new Map(publications.map((publication) => [publication.publicationKey, publication]))
  const currentPublicationKeys = new Set(publications.map((publication) => publication.publicationKey))
  const evaluations = []

  for (const researcher of researchers) {
    const fingerprint = fingerprints.get(researcher._id)
    const items = await fetchNameCandidates(researcher)
    for (const item of items) {
      const evaluation = evaluateCandidate(item, researcher, fingerprint)
      if (!evaluation) continue
      const publicationKey = item.DOI ? `doi:${normalizeDoi(item.DOI)}` : null
      evaluations.push(summarizeEvaluation({
        researcher,
        item,
        evaluation,
        isCurrentlyPublished: currentPublicationKeys.has(publicationKey),
      }))
    }
    await sleep(REQUEST_DELAY_MS)
  }

  const researcherById = new Map(researchers.map((researcher) => [researcher._id, researcher]))
  const currentAttributionCoverage = []
  const doiWorkCache = new Map()
  for (const entry of provenance) {
    const publication = publicationByKey.get(entry.publicationKey)
    if (!publication) continue
    const isPubmedConfirmed = publication.source === 'pubmed' || publication.sources?.includes('pubmed')
    let item = null
    if (!isPubmedConfirmed && publication.doi) {
      if (!doiWorkCache.has(publication.doi)) {
        doiWorkCache.set(publication.doi, fetchWorkByDoi(publication.doi))
      }
      item = await doiWorkCache.get(publication.doi)
    }
    item ||= crossrefLikeItemFromPublication(publication)

    for (const researcherId of entry.researcherIds || []) {
      const researcher = researcherById.get(researcherId)
      const fingerprint = fingerprints.get(researcherId)
      if (!researcher || !fingerprint) continue
      const evaluation = isPubmedConfirmed
        ? {
            decision: 'confirmed',
            reason: 'researcher-specific PubMed query',
            authorMatch: null,
            knownCoauthors: 0,
            affiliationMatch: false,
          }
        : evaluateCandidate(item, researcher, fingerprint) || {
            decision: 'hold',
            reason: 'author name not represented in available source metadata',
            authorMatch: null,
            knownCoauthors: 0,
            affiliationMatch: false,
          }
      const summary = summarizeEvaluation({
        researcher,
        item,
        evaluation,
        isCurrentlyPublished: true,
      })
      const reviewedKey = `${researcher.name}|${publication.publicationKey}`
      const isReviewedFalse = REVIEWED_FALSE_ATTRIBUTIONS.has(reviewedKey)
      const reviewedEvidence = decideAttributionEvidence({
        isManuallyConfirmed: !isReviewedFalse,
        isManuallyRejected: isReviewedFalse,
      })
      currentAttributionCoverage.push({
        ...summary,
        publicationKey: publication.publicationKey,
        source: publication.source,
        sources: publication.sources || [],
        isReviewedFalse,
        automatedDecision: evaluation.decision,
        automatedReason: evaluation.reason,
        reviewedDecision: reviewedEvidence.decision,
        reviewedReason: reviewedEvidence.reason,
        matchesManualReview: isReviewedFalse
          ? reviewedEvidence.decision !== 'confirmed'
          : reviewedEvidence.decision === 'confirmed',
      })
    }
    if (!isPubmedConfirmed && publication.doi) await sleep(REQUEST_DELAY_MS)
  }

  const counts = Object.fromEntries(['confirmed', 'hold', 'rejected'].map((decision) => [
    decision,
    evaluations.filter((entry) => entry.decision === decision).length,
  ]))
  const proposedNewConfirmations = evaluations.filter((entry) => {
    return entry.decision === 'confirmed' && !entry.isCurrentlyPublished
  })
  const byResearcher = researchers.map((researcher) => {
    const entries = evaluations.filter((entry) => entry.researcher === researcher.name)
    return {
      researcher: researcher.name,
      hasOrcid: Boolean(researcher.orcid),
      evaluated: entries.length,
      confirmed: entries.filter((entry) => entry.decision === 'confirmed').length,
      held: entries.filter((entry) => entry.decision === 'hold').length,
      rejected: entries.filter((entry) => entry.decision === 'rejected').length,
      proposedNewConfirmations: entries.filter((entry) => entry.decision === 'confirmed' && !entry.isCurrentlyPublished).length,
    }
  })
  const automatedCoverageSummary = summarizeReviewedCoverage(
    currentAttributionCoverage,
    'automatedDecision'
  )
  const reviewedBaselineCoverageSummary = summarizeReviewedCoverage(
    currentAttributionCoverage,
    'reviewedDecision'
  )
  const automatedAttributionMismatches = currentAttributionCoverage.filter((entry) => {
    return entry.isReviewedFalse
      ? entry.automatedDecision === 'confirmed'
      : entry.automatedDecision !== 'confirmed'
  })
  const currentAttributionMismatches = currentAttributionCoverage.filter((entry) => !entry.matchesManualReview)
  const reviewedNegativeResults = currentAttributionCoverage.filter((entry) => entry.isReviewedFalse)
  const reviewedSecondaryPositiveCount = currentAttributionCoverage.filter((entry) => {
    return !entry.isReviewedFalse && !entry.sources.includes('pubmed') && entry.source !== 'pubmed'
  }).length
  const secondaryAttributionsHeld = currentAttributionCoverage.filter((entry) => {
    return !entry.sources.includes('pubmed') && entry.automatedDecision !== 'confirmed'
  })

  console.log(JSON.stringify({
    auditParameters: {
      researchers: researchers.length,
      resultsPerResearcher: RESULTS_PER_RESEARCHER,
      sinceYear: SINCE_YEAR,
      confirmationRule: {
        fullName: 'at least two recurring coauthors, or matching affiliation plus one recurring coauthor',
        abbreviatedName: 'matching affiliation plus at least two recurring coauthors',
        identifiers: 'exact ORCID or existing researcher-specific PubMed result',
      },
    },
    evaluatedNameMatches: evaluations.length,
    counts,
    byResearcher,
    automatedCoverageSummary,
    reviewedBaselineCoverageSummary,
    reviewedSecondaryPositiveCount,
    reviewedNegativeResults,
    automatedAttributionMismatches,
    currentAttributionMismatches,
    secondaryAttributionsHeld,
    proposedNewConfirmations,
  }, null, 2))
}

main().catch((error) => {
  console.error('[attribution-audit] failed', error)
  process.exitCode = 1
})
