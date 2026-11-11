import assert from 'node:assert/strict'
import test from 'node:test'

import { stripHtmlTags, stripTextMarkup } from '../lib/markupText.js'

const squeeze = (value) => value.replace(/\s+/g, ' ').trim()

test('comparison signs in an abstract are not taken for a tag', () => {
  const text = 'Among adults with eGFR <60 mL/min/1.73 m2 and ACR >30 mg/mmol, the hazard ratio was 0.80 (P<0.001) over >5 years.'
  assert.equal(stripTextMarkup(text), text)
  assert.equal(stripHtmlTags(text), text)

  // The OpenAlex abstract that lost 559 characters, up to the next ">" in the text.
  const openAlex = 'kidney failure (eGFR <15) within 2 and 5 years. Model variants were assessed. C-statistics were >0.90.'
  assert.equal(stripTextMarkup(openAlex), openAlex)

  const words = 'Values <LOD and ACR >30 were kept, and <a third of patients had a ratio >2.'
  assert.equal(stripTextMarkup(words), words)
  const counted = 'ALT <ULN (n=12) or >3 times the limit (n=4).'
  assert.equal(stripTextMarkup(counted), counted)
})

test('markup in text from Crossref, Europe PMC and meta tags is removed', () => {
  assert.equal(
    squeeze(stripTextMarkup('<jats:title>Abstract</jats:title><jats:p>Kidney <jats:italic>function</jats:italic> fell.</jats:p>')),
    'Abstract Kidney function fell.'
  )
  assert.equal(squeeze(stripTextMarkup('<h4>Results</h4>eGFR fell<br/>by 5 mL/min<sup>-1</sup>.')), 'Results eGFR fell by 5 mL/min -1 .')
  assert.equal(squeeze(stripTextMarkup('<p class="first">Text</p><!-- note --><a href="https://x.example/a?b=1">link</a>')), 'Text link')
  assert.equal(squeeze(stripTextMarkup('<i>P</i><0.001 and eGFR >60')), 'P <0.001 and eGFR >60')
})

test('page HTML loses every tag, attributes with or without values, but keeps a bare less-than', () => {
  assert.equal(
    squeeze(stripHtmlTags('<details open><summary>Results</summary><p>eGFR <60 in 12%</p></details>')),
    'Results eGFR <60 in 12%'
  )
})
