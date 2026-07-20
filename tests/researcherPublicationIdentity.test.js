import assert from 'node:assert/strict'
import test from 'node:test'

import {
  getResearcherPublicationName,
  isPublicationExcludedForResearcher,
  normalizeResearcherPublicationExclusion,
} from '../lib/researcherPublicationIdentity.js'

test('uses a precise publication author name without changing the display name', () => {
  const researcher = {
    name: 'Matthew Weir',
    publicationAuthorName: 'Matthew A. Weir',
  }

  assert.equal(getResearcherPublicationName(researcher), 'Matthew A. Weir')
})

test('normalizes PMID and DOI exclusions into canonical publication keys', () => {
  assert.equal(normalizeResearcherPublicationExclusion('42086979'), 'pmid:42086979')
  assert.equal(normalizeResearcherPublicationExclusion('PMID: 42086979'), 'pmid:42086979')
  assert.equal(
    normalizeResearcherPublicationExclusion('https://pubmed.ncbi.nlm.nih.gov/42086979/'),
    'pmid:42086979'
  )
  assert.equal(
    normalizeResearcherPublicationExclusion('https://doi.org/10.1038/S41591-026-04437-Z'),
    'doi:10.1038/s41591-026-04437-z'
  )
})

test('applies verified exclusions only to the configured researcher', () => {
  const publication = {
    pmid: '42086979',
    doi: '10.1038/s41591-026-04437-z',
  }

  assert.equal(
    isPublicationExcludedForResearcher(publication, { publicationExclusions: ['42086979'] }),
    true
  )
  assert.equal(
    isPublicationExcludedForResearcher(publication, { publicationExclusions: ['10.1038/s41591-026-04437-z'] }),
    true
  )
  assert.equal(isPublicationExcludedForResearcher(publication, {}), false)
})
