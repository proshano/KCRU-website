/**
 * Generate lay summaries for publications using LLM
 * Supports multiple providers - configure via environment variables
 * 
 * Recommended cheap/free options:
 * - OpenRouter: gpt-oss-120b (FREE)
 * - Groq: Llama 3.1 8B (free tier)
 * - Together.ai: Llama 3.1 8B (~$0.0002/1K tokens)
 * - OpenAI: gpt-4o-mini (~$0.00015/1K input)
 * - Ollama: any model (free, self-hosted)
 */

const DEFAULT_PROVIDER = process.env.LLM_PROVIDER || 'openrouter'
const DEFAULT_MODEL = process.env.LLM_MODEL || 'google/gemma-2-9b-it:free'
const LLM_DEBUG = process.env.LLM_DEBUG === 'true'

const DEFAULT_SYSTEM_PROMPT = `You write summaries of medical research for a general sophisticated audience. 
Be accurate but avoid jargon. Explain what was studied, what was found, and why it matters but avoid statements about "more research is needed". Do not make up information.
Keep summaries to 2-3 sentences. Do not create abbreviations in the summary.`

/**
 * Generate a lay summary for a publication abstract
 */
export async function generateLaySummary(title, abstract, options = {}) {
  const debug = options.debug ?? LLM_DEBUG
  const retryAttempts = options.retryAttempts ?? 3
  const retryDelayMs = options.retryDelayMs ?? 5000

  if (!abstract || abstract.length < 50) {
    if (debug) {
      console.info('[llm] Skipping summary - missing or short abstract', {
        titleSnippet: title?.slice(0, 120),
        abstractLength: abstract?.length || 0,
        pmid: options?.meta?.pmid
      })
    }
    return null
  }

  const provider = options.provider || DEFAULT_PROVIDER
  const model = options.model || DEFAULT_MODEL
  const systemPrompt = options.systemPrompt || DEFAULT_SYSTEM_PROMPT
  const apiKey = options.apiKey || process.env.OPENROUTER_API_KEY
  const pmid = options?.meta?.pmid

  const userPrompt = `Title: ${title}

Abstract: ${abstract}`

  if (debug) {
    console.info('[llm] Requesting summary', {
      provider,
      model,
      pmid,
      titleSnippet: title?.slice(0, 120),
      abstractChars: abstract.length
    })
  }

  let lastErr = null
  for (let attempt = 0; attempt <= retryAttempts; attempt += 1) {
    try {
      switch (provider) {
        case 'openrouter':
          return await callOpenRouter(userPrompt, { model, systemPrompt, apiKey })
        case 'openai':
          return await callOpenAI(userPrompt, { model, systemPrompt, apiKey })
        case 'together':
          return await callTogether(userPrompt, { model, systemPrompt, apiKey })
        case 'groq':
          return await callGroq(userPrompt, { model, systemPrompt, apiKey })
        case 'ollama':
          return await callOllama(userPrompt, { model, systemPrompt })
        case 'anthropic':
          return await callAnthropic(userPrompt, { model, systemPrompt, apiKey })
        default:
          throw new Error(`Unknown LLM provider: ${provider}`)
      }
    } catch (error) {
      lastErr = error
      const message = String(error?.message || '')
      const isRateLimit = message.includes('429') || message.toLowerCase().includes('rate') || message.toLowerCase().includes('queue') || message.toLowerCase().includes('retry')
      if (debug) {
        console.info('[llm] Summary attempt failed', {
          pmid,
          attempt,
          retryAttempts,
          isRateLimit,
          message
        })
      }
      if (attempt < retryAttempts && isRateLimit) {
        const delay = retryDelayMs * (attempt + 1)
        await new Promise(res => setTimeout(res, delay))
        continue
      }
      console.error('Error generating summary:', error)
      return null
    }
  }
  console.error('Error generating summary:', lastErr)
  return null
}

// --- Provider implementations ---

async function callOpenRouter(userPrompt, { model, systemPrompt, apiKey }) {
  // OpenRouter - aggregator with free models including gpt-oss-120b
  // Models: openrouter/gpt-oss-120b (free), meta-llama/llama-3.1-8b-instruct:free, etc.
  const messages = buildOpenRouterMessages(model, systemPrompt, userPrompt)
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'HTTP-Referer': process.env.SITE_URL || 'https://localhost:3000',
      'X-Title': 'Research Unit Publications'
    },
    body: JSON.stringify({
      model: model || DEFAULT_MODEL,
      messages,
      max_tokens: 200,
      temperature: 0.3
    })
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`OpenRouter request failed ${response.status}: ${body}`)
  }

  const data = await response.json()
  return data.choices?.[0]?.message?.content?.trim() || null
}

function buildOpenRouterMessages(model, systemPrompt, userPrompt) {
  const m = model || DEFAULT_MODEL
  const usesGoogle = m.includes('google/') || m.includes('gemma')
  if (usesGoogle) {
    // Google models on OpenRouter often reject system/developer messages; fold into user.
    return [
      { role: 'user', content: `${systemPrompt}\n\n${userPrompt}` }
    ]
  }
  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt }
  ]
}

async function callOpenAI(userPrompt, { model, systemPrompt, apiKey }) {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey || process.env.OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: model || 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      max_tokens: 200,
      temperature: 0.3
    })
  })

  const data = await response.json()
  return data.choices?.[0]?.message?.content?.trim() || null
}

async function callTogether(userPrompt, { model, systemPrompt, apiKey }) {
  // Together.ai - cheap Llama hosting
  // Models: meta-llama/Llama-3.1-8B-Instruct, mistralai/Mixtral-8x7B-Instruct-v0.1
  const response = await fetch('https://api.together.xyz/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey || process.env.TOGETHER_API_KEY}`
    },
    body: JSON.stringify({
      model: model || 'meta-llama/Llama-3.1-8B-Instruct',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      max_tokens: 200,
      temperature: 0.3
    })
  })

  const data = await response.json()
  return data.choices?.[0]?.message?.content?.trim() || null
}

async function callGroq(userPrompt, { model, systemPrompt, apiKey }) {
  // Groq - fast inference, free tier
  // Models: llama-3.1-8b-instant, llama-3.1-70b-versatile, mixtral-8x7b-32768
  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey || process.env.GROQ_API_KEY}`
    },
    body: JSON.stringify({
      model: model || 'llama-3.1-8b-instant',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      max_tokens: 200,
      temperature: 0.3
    })
  })

  const data = await response.json()
  return data.choices?.[0]?.message?.content?.trim() || null
}

async function callOllama(userPrompt, { model, systemPrompt }) {
  // Ollama - local/self-hosted, free
  // Requires OLLAMA_HOST env var (default: http://localhost:11434)
  const host = process.env.OLLAMA_HOST || 'http://localhost:11434'
  
  const response = await fetch(`${host}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: model || 'llama3.1:8b',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      stream: false,
      options: { temperature: 0.3 }
    })
  })

  const data = await response.json()
  return data.message?.content?.trim() || null
}

async function callAnthropic(userPrompt, { model, systemPrompt, apiKey }) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey || process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: model || 'claude-3-haiku-20240307',
      max_tokens: 200,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    })
  })

  const data = await response.json()
  return data.content?.[0]?.text?.trim() || null
}

// --- Batch processing ---

/**
 * Generate summaries for multiple publications
 * Includes rate limiting to avoid API throttling
 */
export async function generateSummariesBatch(publications, options = {}) {
  const {
    concurrency = 1,
    delayMs = 2000,
    maxItems,
    order = 'as-provided',
    provider,
    model,
    systemPrompt,
    apiKey,
    debug = LLM_DEBUG,
    retryAttempts,
    retryDelayMs,
    skipIfHasSummary = true
  } = options

  const summaries = new Map()
  const candidates = publications
    .filter(p => p.abstract && p.abstract.length >= 50)
    .filter(p => !(skipIfHasSummary && p.laySummary))
  const ordered = order === 'recent'
    ? [...candidates].sort((a, b) => {
        const yearDiff = (parseInt(b.year, 10) || 0) - (parseInt(a.year, 10) || 0)
        if (yearDiff !== 0) return yearDiff
        const pmidDiff = (parseInt(b.pmid, 10) || 0) - (parseInt(a.pmid, 10) || 0)
        if (pmidDiff !== 0) return pmidDiff
        return (b.title || '').localeCompare(a.title || '')
      })
    : candidates

  const toProcess = typeof maxItems === 'number'
    ? ordered.slice(0, Math.max(0, maxItems))
    : ordered

  if (debug) {
    console.info('[llm] Preparing batch summaries', {
      order,
      totalWithAbstract: candidates.length,
      processing: toProcess.length,
      maxItems,
      concurrency
    })
  }

  for (let i = 0; i < toProcess.length; i += concurrency) {
    const batch = toProcess.slice(i, i + concurrency)
    
    const results = await Promise.all(
      batch.map(async (pub) => {
        const summary = await generateLaySummary(pub.title, pub.abstract, {
          provider,
          model,
          systemPrompt,
          apiKey,
          meta: { pmid: pub.pmid },
          debug,
          retryAttempts,
          retryDelayMs
        })
        return { pmid: pub.pmid, summary }
      })
    )

    results.forEach(({ pmid, summary }) => {
      if (summary) {
        summaries.set(pmid, summary)
      }
    })

    if (i + concurrency < toProcess.length) {
      await new Promise(resolve => setTimeout(resolve, delayMs))
    }
  }

  return summaries
}

/**
 * Enrich publications with AI-generated lay summaries
 */
export async function enrichWithSummaries(publications) {
  const summaries = await generateSummariesBatch(publications)
  
  return publications.map(pub => ({
    ...pub,
    laySummary: summaries.get(pub.pmid) || null
  }))
}

// --- Clinical Trial Summary Generation ---

const TRIAL_SUMMARY_SYSTEM_PROMPT = `You write plain-language summaries of clinical trials for patients and their families.
Be accurate but avoid medical jargon. Explain what the study is testing, who it's for, and what participation might involve.
Keep summaries to 2-3 sentences. Be encouraging but not promotional. Do not make up information.`

const ELIGIBILITY_OVERVIEW_SYSTEM_PROMPT = `You summarize clinical trial eligibility criteria in plain language.
Write a brief 1-2 sentence overview of who can join this study, focusing on the key requirements.
Avoid listing all criteria - just give the essential summary. Be accurate and clear.`

/**
 * Generate a lay summary for a clinical trial
 * @param {Object} trialData - Trial data from ClinicalTrials.gov
 * @returns {Promise<string|null>} Plain language summary
 */
export async function generateTrialSummary(trialData, options = {}) {
  const debug = options.debug ?? LLM_DEBUG
  
  const { briefTitle, officialTitle, briefSummary, conditions, interventions, nctId } = trialData
  
  if (!briefSummary && !officialTitle) {
    if (debug) console.info('[llm] Skipping trial summary - no data', { nctId })
    return null
  }

  const provider = options.provider || DEFAULT_PROVIDER
  const model = options.model || DEFAULT_MODEL
  const apiKey = options.apiKey || process.env.OPENROUTER_API_KEY

  // Build a user prompt with available trial info
  const conditionsText = conditions?.length ? `Conditions: ${conditions.join(', ')}` : ''
  const interventionsText = interventions?.length 
    ? `Interventions: ${interventions.map(i => typeof i === 'string' ? i : i.name).join(', ')}`
    : ''

  const userPrompt = `Clinical Trial: ${officialTitle || briefTitle}

${conditionsText}
${interventionsText}

Study Description: ${briefSummary || 'Not available'}

Write a 2-3 sentence plain-language summary of this study for patients.`

  if (debug) {
    console.info('[llm] Requesting trial summary', { nctId, provider, model })
  }

  try {
    let result
    switch (provider) {
      case 'openrouter':
        result = await callOpenRouter(userPrompt, { model, systemPrompt: TRIAL_SUMMARY_SYSTEM_PROMPT, apiKey })
        break
      case 'openai':
        result = await callOpenAI(userPrompt, { model, systemPrompt: TRIAL_SUMMARY_SYSTEM_PROMPT, apiKey })
        break
      default:
        result = await callOpenRouter(userPrompt, { model, systemPrompt: TRIAL_SUMMARY_SYSTEM_PROMPT, apiKey })
    }
    return sanitizeSummary(nctId, result)
  } catch (error) {
    console.error('[llm] Error generating trial summary:', error)
    return null
  }
}

/**
 * Generate a plain-language eligibility overview
 * @param {Object} eligibility - Eligibility data
 * @returns {Promise<string|null>} Brief eligibility overview
 */
export async function generateEligibilityOverview(eligibility, options = {}) {
  const debug = options.debug ?? LLM_DEBUG
  
  const { inclusionCriteria, exclusionCriteria, minimumAge, maximumAge } = eligibility
  
  if (!inclusionCriteria?.length && !exclusionCriteria?.length) {
    if (debug) console.info('[llm] Skipping eligibility overview - no criteria')
    return null
  }

  const provider = options.provider || DEFAULT_PROVIDER
  const model = options.model || DEFAULT_MODEL
  const apiKey = options.apiKey || process.env.OPENROUTER_API_KEY

  const ageText = minimumAge || maximumAge 
    ? `Age: ${minimumAge || 'No minimum'} to ${maximumAge || 'No maximum'}`
    : ''

  const userPrompt = `Eligibility Criteria for a Clinical Trial:

${ageText}

Key Inclusion Criteria:
${inclusionCriteria?.slice(0, 5).map(c => `- ${c}`).join('\n') || 'Not specified'}

Key Exclusion Criteria:
${exclusionCriteria?.slice(0, 5).map(c => `- ${c}`).join('\n') || 'Not specified'}

Write a 1-2 sentence plain-language summary of who is eligible for this study.`

  if (debug) {
    console.info('[llm] Requesting eligibility overview', { provider, model })
  }

  try {
    let result
    switch (provider) {
      case 'openrouter':
        result = await callOpenRouter(userPrompt, { model, systemPrompt: ELIGIBILITY_OVERVIEW_SYSTEM_PROMPT, apiKey })
        break
      case 'openai':
        result = await callOpenAI(userPrompt, { model, systemPrompt: ELIGIBILITY_OVERVIEW_SYSTEM_PROMPT, apiKey })
        break
      default:
        result = await callOpenRouter(userPrompt, { model, systemPrompt: ELIGIBILITY_OVERVIEW_SYSTEM_PROMPT, apiKey })
    }
    return sanitizeSummary('eligibility', result)
  } catch (error) {
    console.error('[llm] Error generating eligibility overview:', error)
    return null
  }
}

/**
 * Clean up LLM output
 */
function sanitizeSummary(id, text) {
  if (!text) return null
  
  // Remove common LLM artifacts
  let cleaned = text
    .replace(/^(Here is|Here's|This is|Summary:)/i, '')
    .replace(/^["']|["']$/g, '')
    .trim()
  
  // Ensure it doesn't start with weird formatting
  if (cleaned.startsWith(':')) cleaned = cleaned.slice(1).trim()
  
  return cleaned || null
}

