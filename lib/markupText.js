/**
 * Tag stripping for publication text.
 *
 * A plain `<[^>]+>` also deletes prose that sits between a less-than sign and the next
 * greater-than sign: "eGFR <60 mL/min and ACR >30 mg/mmol" became "eGFR 30 mg/mmol".
 * Found on 2026-11-11, when four OpenAlex abstracts in the cache had each lost 190 to 560
 * characters this way, in one case the sentence introducing the results.
 */

// Prose that may carry light markup (`<jats:p>`, `<i>`, `<sub>`): text from Crossref,
// OpenAlex, Europe PMC or a meta tag. Only something shaped like a tag is removed: a name
// directly after `<`, followed by nothing or by attributes that begin with `name=`.
// "<60 … >", "< 0.05 … >", "<LOD and ACR >" and "<ULN (n=12) … >" are kept.
const TEXT_TAG_RE = /<!--[\s\S]*?-->|<\/?[a-zA-Z][a-zA-Z0-9:._-]*(?:\s+[a-zA-Z_:][\w:.-]*\s*=[^<>]*)?\s*\/?>/g

// A page's HTML, where markup dominates and any name after `<` starts a tag
// (`<details open>`), while an unescaped "<60" in the text still does not.
const HTML_TAG_RE = /<!--[\s\S]*?-->|<\/?[a-zA-Z][^<>]*>/g

export function stripTextMarkup(value) {
  return String(value || '').replace(TEXT_TAG_RE, ' ')
}

export function stripHtmlTags(value) {
  return String(value || '').replace(HTML_TAG_RE, ' ')
}
