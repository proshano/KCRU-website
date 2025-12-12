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
Keep summaries to 2-3 sentences. Do not create abbreviations in the summary.

Output requirements:
- Return ONLY valid JSON (no markdown, no code fences, no extra text).
- JSON schema: { "summary": string }
- The "summary" MUST be 2-3 sentences of plain text (no headings/markdown/bullets/labels).
- Do NOT include the title in the summary.
- Avoid boilerplate like "In this study..." unless it helps clarity.`

function normalizeForCompare(s) {
  return (s || '')
    .toString()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

function limitSentences(text, maxSentences = 3) {
  const t = (text || '').toString().trim()
  if (!t) return ''
  const matches = t.match(/[^.!?]+[.!?]+(\s+|$)/g)
  if (!matches || matches.length <= maxSentences) return t
  return matches.slice(0, maxSentences).join('').trim()
}

function sanitizeSummary(title, raw) {
  if (!raw) return null

  let s = String(raw).replace(/\r\n/g, '\n').trim()

  // Strip code fence markers but keep content.
  s = s.replace(/```[a-zA-Z0-9_-]*\n?/g, '').replace(/```/g, '')

  // Remove common markdown emphasis markers.
  s = s.replace(/\*\*(.*?)\*\*/g, '$1').replace(/__(.*?)__/g, '$1').replace(/`([^`]+)`/g, '$1')

  const normTitle = normalizeForCompare(title)
  let lines = s.split('\n').map(l => l.trim()).filter(Boolean)

  // Drop standalone headings / labels / pure-title lines.
  lines = lines.filter((line) => {
    if (/^#{1,6}\s+/.test(line)) return false
    if (/^title\s*:\s*/i.test(line)) return false
    const nl = normalizeForCompare(line.replace(/^#{1,6}\s+/, ''))
    if (normTitle && nl === normTitle) return false
    return true
  })

  s = lines.join(' ').trim()

  // Remove any leading heading markers or bullet markers left inline.
  s = s.replace(/^#{1,6}\s+/, '')
  s = s.replace(/^[-*•]\s+/, '')
  s = s.replace(/^(?:\*\*|__)?\s*title\s*(?:\*\*|__)?\s*:\s*/i, '')

  // If it still starts with the title, remove that prefix.
  const sHeadNorm = normalizeForCompare(s.slice(0, 240))
  if (normTitle && sHeadNorm.startsWith(normTitle)) {
    try {
      const escaped = String(title).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      s = s.replace(new RegExp(`^\\s*${escaped}\\s*[:\\-–—]?\\s*`, 'i'), '').trim()
    } catch {
      // ignore title-regex failures; best-effort only
    }
  }

  s = s.replace(/\s+/g, ' ').trim()
  s = limitSentences(s, 3)

  if (!s || s.length < 20) return null
  return s
}

function stripCodeFences(text) {
  if (!text) return ''
  const s = String(text).trim()
  // Remove leading/trailing fenced blocks (```json ... ```)
  return s
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```$/i, '')
    .trim()
}

function extractFirstJsonObject(text) {
  const s = stripCodeFences(text)
  const start = s.indexOf('{')
  if (start === -1) return null

  let depth = 0
  let inString = false
  let escape = false

  for (let i = start; i < s.length; i += 1) {
    const ch = s[i]
    if (inString) {
      if (escape) {
        escape = false
      } else if (ch === '\\') {
        escape = true
      } else if (ch === '"') {
        inString = false
      }
      continue
    }

    if (ch === '"') {
      inString = true
      continue
    }
    if (ch === '{') depth += 1
    if (ch === '}') depth -= 1

    if (depth === 0) {
      const candidate = s.slice(start, i + 1).trim()
      if (!candidate) return null
      try {
        return JSON.parse(candidate)
      } catch {
        return null
      }
    }
  }

  return null
}

function pickSummaryField(obj) {
  if (!obj) return null
  if (typeof obj.summary === 'string') return obj.summary
  if (Array.isArray(obj.summary)) return obj.summary.filter(Boolean).join(' ')
  if (obj.data && typeof obj.data.summary === 'string') return obj.data.summary
  return null
}

/**
 * Generate a lay summary for a publication abstract
 */
export async function generateLaySummary(title, abstract, options = {}) {
  const debug = options.debug ?? LLM_DEBUG
  const retryAttempts = options.retryAttempts ?? 3
  const retryDelayMs = options.retryDelayMs ?? 5000
  const emptyRetryDelayMs = options.emptyRetryDelayMs ?? 1000
  const structuredJson = options.structuredJson ?? true

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

  const inputJson = { title: title || '', abstract: abstract || '' }
  const userPrompt = structuredJson
    ? `Summarize the following input. Return ONLY JSON: {"summary": "..."}\n\n${JSON.stringify(inputJson)}`
    : `Title: ${title}\n\nAbstract: ${abstract}`

  if (debug) {
    console.info('[llm] Requesting summary', {
      provider,
      model,
      pmid,
      structuredJson,
      titleSnippet: title?.slice(0, 120),
      abstractChars: abstract.length
    })
  }

  let lastErr = null
  for (let attempt = 0; attempt <= retryAttempts; attempt += 1) {
    try {
      let summary = null
      switch (provider) {
        case 'openrouter':
          summary = await callOpenRouter(userPrompt, { model, systemPrompt, apiKey })
          break
        case 'openai':
          summary = await callOpenAI(userPrompt, { model, systemPrompt, apiKey })
          break
        case 'together':
          summary = await callTogether(userPrompt, { model, systemPrompt, apiKey })
          break
        case 'groq':
          summary = await callGroq(userPrompt, { model, systemPrompt, apiKey })
          break
        case 'ollama':
          summary = await callOllama(userPrompt, { model, systemPrompt })
          break
        case 'anthropic':
          summary = await callAnthropic(userPrompt, { model, systemPrompt, apiKey })
          break
        default:
          throw new Error(`Unknown LLM provider: ${provider}`)
      }

      let summaryText = summary
      if (structuredJson) {
        const obj = extractFirstJsonObject(summary)
        const picked = pickSummaryField(obj)
        if (!picked) {
          const err = new Error('LLM returned invalid JSON output')
          err.code = 'BAD_JSON'
          throw err
        }
        summaryText = picked
      }

      const cleaned = sanitizeSummary(title, summaryText)

      // Some providers (esp. via OpenRouter) can return HTTP 200 but no content,
      // or content with undesirable wrappers (e.g. headings). Treat empty-after-cleaning as retryable
      // (different from "no abstract available", handled above).
      if (!cleaned) {
        const err = new Error('LLM returned empty output')
        err.code = 'EMPTY_OUTPUT'
        throw err
      }

      return cleaned
    } catch (error) {
      lastErr = error
      const message = String(error?.message || '')
      const isRateLimit = message.includes('429') || message.toLowerCase().includes('rate') || message.toLowerCase().includes('queue') || message.toLowerCase().includes('retry')
      const isEmptyOutput = error?.code === 'EMPTY_OUTPUT' || message.toLowerCase().includes('empty output') || message.toLowerCase().includes('empty response')
      const isBadJson = error?.code === 'BAD_JSON' || message.toLowerCase().includes('invalid json')
      const isTransient =
        message.includes('502') ||
        message.includes('503') ||
        message.includes('504') ||
        message.toLowerCase().includes('timeout') ||
        message.toLowerCase().includes('fetch failed') ||
        message.toLowerCase().includes('econnreset') ||
        message.toLowerCase().includes('socket') ||
        message.toLowerCase().includes('network')
      if (debug) {
        console.info('[llm] Summary attempt failed', {
          pmid,
          attempt,
          retryAttempts,
          isRateLimit,
          isEmptyOutput,
          isBadJson,
          isTransient,
          message
        })
      }
      const shouldRetry = attempt < retryAttempts && (isRateLimit || isEmptyOutput || isBadJson || isTransient)
      if (shouldRetry) {
        const baseDelay = isRateLimit ? retryDelayMs : Math.min(emptyRetryDelayMs, retryDelayMs)
        const delay = baseDelay * (attempt + 1)
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
  if (data?.error) {
    const msg = typeof data.error === 'string' ? data.error : (data.error?.message || JSON.stringify(data.error))
    throw new Error(`OpenRouter response error: ${msg}`)
  }
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

