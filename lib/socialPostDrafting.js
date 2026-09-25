import { buildXPostText, validateXPostText } from './socialPosting.js'

// Server-side draft writing for X posts, used by the "Create post" and
// "Regenerate" actions at /admin/social. The LLM call is injected as
// `generate` (generateSocialPostText from summaries.js, bound to the site's
// model settings) so tests can use a fake.

// What the model is asked for. X allows 280 characters and the paper link
// counts as 23 plus a space, so 240 leaves a margin for the model's miscounts.
export const SOCIAL_POST_BODY_MAX_LENGTH = 240
// The one retry after a draft that came out too long.
export const SOCIAL_POST_SHORTER_BODY_MAX_LENGTH = 200

function cleanString(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim()
}

// Returns { text, generatedBy }. The text is the generated body plus the paper
// link. When the model is unavailable, returns nothing, or cannot fit the post
// after one shorter retry, the standard template is used instead.
export async function composeSocialPostDraft({
  post = {},
  intro,
  siteTitle,
  generate,
  llmLabel = 'llm',
} = {}) {
  const link = cleanString(post.link)
  const template = () => ({
    text: buildXPostText({ intro, title: post.title, link }),
    generatedBy: 'template',
  })
  if (typeof generate !== 'function') return template()

  const input = {
    title: cleanString(post.title),
    laySummary: cleanString(post.laySummary),
    journal: cleanString(post.journal),
    teamMembers: (post.teamMembers || []).map(cleanString).filter(Boolean),
    siteTitle: cleanString(siteTitle),
  }
  let previousText = null
  for (const maxLength of [SOCIAL_POST_BODY_MAX_LENGTH, SOCIAL_POST_SHORTER_BODY_MAX_LENGTH]) {
    let body = null
    try {
      body = await generate({ ...input, maxLength, ...(previousText ? { previousText } : {}) })
    } catch {
      body = null
    }
    const cleaned = cleanString(body)
    if (!cleaned) return template()
    const text = link ? `${cleaned} ${link}` : cleaned
    if (validateXPostText(text).ok) return { text, generatedBy: llmLabel }
    previousText = cleaned
  }
  return template()
}
