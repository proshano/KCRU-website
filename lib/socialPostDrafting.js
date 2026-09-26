import { X_MAX_WEIGHTED_LENGTH, buildXPostText, xWeightedLength } from './socialPosting.js'

// Server-side draft writing for X posts, used by the "Create post" and
// "Regenerate" actions at /admin/social. The LLM call is injected as
// `generate` (generateSocialPostText from summaries.js, bound to the site's
// model settings) so tests can use a fake.

// What the model is asked for. X allows 280 characters and the paper link
// counts as 23 plus a space, so 240 leaves a margin for the model's miscounts.
export const SOCIAL_POST_BODY_MAX_LENGTH = 240
// The one retry after a draft that came out too long.
export const SOCIAL_POST_SHORTER_BODY_MAX_LENGTH = 200

const FIRST_PERSON_PATTERN = /\b(our|we|us)\b/i

function cleanString(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim()
}

function normalizeForMatch(value) {
  return cleanString(value).toLowerCase()
}

// Checks an LLM-drafted post body against the approver's requirements: every listed
// investigator must be named, never in first person, and never naming the journal.
// `link` is included because X's length limit only bites once the link is appended.
export function checkSocialPostBody(body, { teamMembers, journal, link } = {}) {
  const problems = []
  const normalizedBody = normalizeForMatch(body)

  for (const name of (teamMembers || []).map(cleanString).filter(Boolean)) {
    if (!normalizedBody.includes(normalizeForMatch(name))) {
      problems.push(`The post must name ${name}.`)
    }
  }

  if (FIRST_PERSON_PATTERN.test(body)) {
    problems.push('The post must not use first person ("our", "we" or "us").')
  }

  const journalName = cleanString(journal)
  if (journalName.length >= 4 && normalizedBody.includes(normalizeForMatch(journalName))) {
    problems.push('The post must not mention the journal.')
  }

  const withLink = [cleanString(body), cleanString(link)].filter(Boolean).join(' ')
  const weightedLength = xWeightedLength(withLink)
  if (weightedLength > X_MAX_WEIGHTED_LENGTH) {
    problems.push(`The post is too long once the link is added (${weightedLength} characters as X counts them; the limit is ${X_MAX_WEIGHTED_LENGTH}).`)
  }

  return problems
}

// Returns { text, generatedBy }. The text is the generated body plus the paper
// link. When the model is unavailable, returns nothing, or fails the checks
// (naming every investigator, no first person, no journal, fits on X) after
// one corrective retry, the standard template is used instead.
export async function composeSocialPostDraft({
  post = {},
  teamLabel,
  generate,
  llmLabel = 'llm',
} = {}) {
  const link = cleanString(post.link)
  const teamMembers = (post.teamMembers || []).map(cleanString).filter(Boolean)
  const journal = cleanString(post.journal)
  const hasOtherAuthors = post.hasOtherAuthors === true ? true : post.hasOtherAuthors === false ? false : null
  const template = () => ({
    text: buildXPostText({ title: post.title, link, teamMembers, teamLabel, hasOtherAuthors: hasOtherAuthors === true }),
    generatedBy: 'template',
  })
  if (typeof generate !== 'function') return template()

  const input = {
    title: cleanString(post.title),
    laySummary: cleanString(post.laySummary),
    teamMembers,
    teamLabel: cleanString(teamLabel),
    hasOtherAuthors,
  }
  let maxLength = SOCIAL_POST_BODY_MAX_LENGTH
  let previousText = null
  let feedback = null
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let body = null
    try {
      body = await generate({ ...input, maxLength, ...(previousText ? { previousText, feedback } : {}) })
    } catch {
      body = null
    }
    const cleaned = cleanString(body)
    if (!cleaned) return template()

    const problems = checkSocialPostBody(cleaned, { teamMembers, journal, link })
    if (!problems.length) return { text: link ? `${cleaned} ${link}` : cleaned, generatedBy: llmLabel }
    if (attempt === 1) return template()

    previousText = cleaned
    feedback = problems
    if (problems.some((problem) => /too long/i.test(problem))) maxLength = SOCIAL_POST_SHORTER_BODY_MAX_LENGTH
  }
  return template()
}
