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

const DEFAULT_SYSTEM_PROMPT = `You write plain-language summaries of medical research for a general audience. 
Be accurate but avoid jargon. Explain what was studied, what was found, and why it matters.
Keep summaries to 2-3 sentences.`

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

