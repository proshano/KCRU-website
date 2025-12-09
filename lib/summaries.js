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

const PROVIDER = process.env.LLM_PROVIDER || 'openrouter'
const MODEL = process.env.LLM_MODEL || 'openrouter/gpt-oss-120b'

const SYSTEM_PROMPT = `You write plain-language summaries of medical research for a general audience. 
Be accurate but avoid jargon. Explain what was studied, what was found, and why it matters.
Keep summaries to 2-3 sentences.`

/**
 * Generate a lay summary for a publication abstract
 */
export async function generateLaySummary(title, abstract) {
  if (!abstract || abstract.length < 50) {
    return null
  }

  const userPrompt = `Summarize this research in 2-3 sentences for a general audience:

Title: ${title}

Abstract: ${abstract}`

  try {
    switch (PROVIDER) {
      case 'openrouter':
        return await callOpenRouter(userPrompt)
      case 'openai':
        return await callOpenAI(userPrompt)
      case 'together':
        return await callTogether(userPrompt)
      case 'groq':
        return await callGroq(userPrompt)
      case 'ollama':
        return await callOllama(userPrompt)
      case 'anthropic':
        return await callAnthropic(userPrompt)
      default:
        throw new Error(`Unknown LLM provider: ${PROVIDER}`)
    }
  } catch (error) {
    console.error('Error generating summary:', error)
    return null
  }
}

// --- Provider implementations ---

async function callOpenRouter(userPrompt) {
  // OpenRouter - aggregator with free models including gpt-oss-120b
  // Models: openrouter/gpt-oss-120b (free), meta-llama/llama-3.1-8b-instruct:free, etc.
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'HTTP-Referer': process.env.SITE_URL || 'https://localhost:3000',
      'X-Title': 'Research Unit Publications'
    },
    body: JSON.stringify({
      model: MODEL || 'openrouter/gpt-oss-120b',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt }
      ],
      max_tokens: 200,
      temperature: 0.3
    })
  })

  const data = await response.json()
  return data.choices?.[0]?.message?.content?.trim() || null
}

async function callOpenAI(userPrompt) {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt }
      ],
      max_tokens: 200,
      temperature: 0.3
    })
  })

  const data = await response.json()
  return data.choices?.[0]?.message?.content?.trim() || null
}

async function callTogether(userPrompt) {
  // Together.ai - cheap Llama hosting
  // Models: meta-llama/Llama-3.1-8B-Instruct, mistralai/Mixtral-8x7B-Instruct-v0.1
  const response = await fetch('https://api.together.xyz/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.TOGETHER_API_KEY}`
    },
    body: JSON.stringify({
      model: MODEL || 'meta-llama/Llama-3.1-8B-Instruct',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt }
      ],
      max_tokens: 200,
      temperature: 0.3
    })
  })

  const data = await response.json()
  return data.choices?.[0]?.message?.content?.trim() || null
}

async function callGroq(userPrompt) {
  // Groq - fast inference, free tier
  // Models: llama-3.1-8b-instant, llama-3.1-70b-versatile, mixtral-8x7b-32768
  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.GROQ_API_KEY}`
    },
    body: JSON.stringify({
      model: MODEL || 'llama-3.1-8b-instant',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt }
      ],
      max_tokens: 200,
      temperature: 0.3
    })
  })

  const data = await response.json()
  return data.choices?.[0]?.message?.content?.trim() || null
}

async function callOllama(userPrompt) {
  // Ollama - local/self-hosted, free
  // Requires OLLAMA_HOST env var (default: http://localhost:11434)
  const host = process.env.OLLAMA_HOST || 'http://localhost:11434'
  
  const response = await fetch(`${host}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL || 'llama3.1:8b',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt }
      ],
      stream: false,
      options: { temperature: 0.3 }
    })
  })

  const data = await response.json()
  return data.message?.content?.trim() || null
}

async function callAnthropic(userPrompt) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: MODEL || 'claude-3-haiku-20240307',
      max_tokens: 200,
      system: SYSTEM_PROMPT,
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
    concurrency = 3,
    delayMs = 500
  } = options

  const summaries = new Map()
  const toProcess = publications.filter(p => p.abstract && p.abstract.length >= 50)

  for (let i = 0; i < toProcess.length; i += concurrency) {
    const batch = toProcess.slice(i, i + concurrency)
    
    const results = await Promise.all(
      batch.map(async (pub) => {
        const summary = await generateLaySummary(pub.title, pub.abstract)
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

