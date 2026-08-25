import assert from 'node:assert/strict'
import test from 'node:test'

import { fetchPubmedArticleDetails } from '../lib/pubmed.js'

test('PubMed efetch preserves structured author, ORCID, and affiliation evidence', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => new Response(`
    <PubmedArticleSet>
      <PubmedArticle>
        <MedlineCitation>
          <PMID>123</PMID>
          <Article>
            <Abstract><AbstractText>Structured abstract text.</AbstractText></Abstract>
            <AuthorList>
              <Author>
                <LastName>Smith</LastName>
                <ForeName>Jane A.</ForeName>
                <Initials>JA</Initials>
                <Identifier Source="ORCID">https://orcid.org/0000-0001-2345-6789</Identifier>
                <AffiliationInfo><Affiliation>Western University, London, Ontario.</Affiliation></AffiliationInfo>
              </Author>
            </AuthorList>
          </Article>
        </MedlineCitation>
      </PubmedArticle>
    </PubmedArticleSet>
  `, { status: 200 })

  try {
    const details = await fetchPubmedArticleDetails(['123'])
    assert.equal(details.get('123').abstract, 'Structured abstract text.')
    assert.deepEqual(details.get('123').attributionAuthors, [{
      given: 'Jane A.',
      family: 'Smith',
      displayName: 'Jane A. Smith',
      orcid: 'https://orcid.org/0000-0001-2345-6789',
      affiliations: ['Western University, London, Ontario.'],
    }])
  } finally {
    globalThis.fetch = originalFetch
  }
})
