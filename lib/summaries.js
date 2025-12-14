import { DEFAULT_CLASSIFICATION_PROMPT } from './classificationPrompt.js'

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

export const DEFAULT_SYSTEM_PROMPT = `You write summaries of medical research for a general sophisticated audience. 
Be accurate but avoid jargon. Explain what was studied, what was found, and why it matters but avoid statements about "more research is needed". Do not make up information.
Keep summaries to 2-3 sentences. Do not create abbreviations in the summary.`

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

function pickArrayField(obj, key) {
  if (!obj) return []
  const raw = obj[key] ?? obj[key?.toLowerCase?.()] ?? obj[key?.toUpperCase?.()]
  const arr = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(/[,;]\s*/) : []
  return arr
    .map(v => (typeof v === 'string' ? v.trim() : ''))
    .filter(Boolean)
}

// Canonical category assignments - each tag belongs to exactly one category
const TOPIC_TAGS = new Set([
  'Perioperative and Surgery',
  'Hemodialysis',
  'Dialysis Vascular Access',
  'Peritoneal Dialysis',
  'Genetic Kidney Disease',
  'Kidney Transplantation',
  'Drug Safety',
  'Drug Dosing and Metabolism',
  'Acute Kidney Injury',
  'Glomerular Disease',
  'Diabetes and Metabolism',
  'Chronic Kidney Disease',
  'Obesity',
  'Hypertension',
  'Cardiovascular Disease',
  'Bone Health',
  'Kidney Disease in Cancer',
  'Health Systems',
  'Remote Monitoring and Care',
  'Clinical Decision Support',
  'Education',
  'Research Ethics',
])

const STUDY_DESIGN_TAGS = new Set([
  'Interventional Study',
  'Observational Study',
  'Systematic Evidence Synthesis',
  'Narrative Review',
  'Qualitative Study',
  'Case Report / Case Series',
  'Commentary / Editorial',
])

const METHODOLOGICAL_FOCUS_TAGS = new Set([
  'Pragmatic Trial',
  'Innovation in Study Design or Analysis',
  'Research Automation',
  'Health Economics',
  'Biomarker Development or Validation',
  'Diagnostic Accuracy',
  'Advanced Imaging',
  'Genomics / Genetic Testing',
  'Machine Learning / AI',
  'Administrative Data',
  'Survey Research',
  'Patient-Reported Outcomes',
  'Risk Estimation and Prognosis',
  'Preclinical',
])

/**
 * Enforce canonical category assignments - move misplaced tags to their correct category
 * and remove tags that don't belong
 */
function enforceCanonicalCategories(classification) {
  const { topics, studyDesign, methodologicalFocus, exclude } = classification
  
  const allTags = [...topics, ...studyDesign, ...methodologicalFocus]
  
  const cleanTopics = new Set()
  const cleanStudyDesign = new Set()
  const cleanMethodologicalFocus = new Set()
  
  for (const tag of allTags) {
    if (TOPIC_TAGS.has(tag)) {
      cleanTopics.add(tag)
    } else if (STUDY_DESIGN_TAGS.has(tag)) {
      cleanStudyDesign.add(tag)
    } else if (METHODOLOGICAL_FOCUS_TAGS.has(tag)) {
      cleanMethodologicalFocus.add(tag)
    }
    // Unknown tags are silently dropped
  }
  
  return {
    topics: Array.from(cleanTopics),
    studyDesign: Array.from(cleanStudyDesign),
    methodologicalFocus: Array.from(cleanMethodologicalFocus),
    exclude
  }
}

function parseClassification(obj) {
  if (!obj) {
    return { topics: [], studyDesign: [], methodologicalFocus: [], exclude: false }
  }
  // Handle exclude carefully - LLM may return string "false" which is truthy
  let exclude = false
  if (obj.exclude === true || obj.exclude === 'true') {
    exclude = true
  }
  const raw = {
    topics: pickArrayField(obj, 'topics'),
    studyDesign: pickArrayField(obj, 'study_design'),
    methodologicalFocus: pickArrayField(obj, 'methodological_focus'),
    exclude
  }
  // Enforce canonical categories to fix LLM misclassifications
  return enforceCanonicalCategories(raw)
}

/**
 * Classify a publication (no summary generation required).
 * Accepts title/abstract and optional lay summary as extra context.
 *
 * Returns: { topics, studyDesign, methodologicalFocus, exclude }
 */
export async function classifyPublication({ title, abstract, laySummary }, options = {}) {
  const debug = options.debug ?? LLM_DEBUG
  const retryAttempts = options.retryAttempts ?? 2
  const retryDelayMs = options.retryDelayMs ?? 4000
  const emptyRetryDelayMs = options.emptyRetryDelayMs ?? 1000

  const provider = options.provider || DEFAULT_PROVIDER
  const model = options.model || DEFAULT_MODEL
  // Keep system prompt minimal; the classification prompt carries the instructions.
  const systemPrompt = options.systemPrompt || 'You are a careful and concise research librarian.'
  const apiKey = options.apiKey || process.env.OPENROUTER_API_KEY
  const classificationPrompt = options.classificationPrompt || DEFAULT_CLASSIFICATION_PROMPT

  function escapeForJsonString(v) {
    return String(v ?? '')
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/\r?\n/g, '\\n')
  }

  // Use the prompt as-written, replacing placeholders safely.
  // (The prompt embeds values inside JSON quotes.)
  const userPrompt = String(classificationPrompt)
    .replaceAll('{title}', escapeForJsonString(title))
    .replaceAll('{abstract}', escapeForJsonString(abstract))
    .replaceAll('{existing_summary}', escapeForJsonString(laySummary))

  let lastErr = null
  for (let attempt = 0; attempt <= retryAttempts; attempt += 1) {
    try {
      let responseText = null
      switch (provider) {
        case 'openrouter':
          responseText = await callOpenRouter(userPrompt, { model, systemPrompt, apiKey })
          break
        case 'openai':
          responseText = await callOpenAI(userPrompt, { model, systemPrompt, apiKey })
          break
        case 'together':
          responseText = await callTogether(userPrompt, { model, systemPrompt, apiKey })
          break
        case 'groq':
          responseText = await callGroq(userPrompt, { model, systemPrompt, apiKey })
          break
        case 'ollama':
          responseText = await callOllama(userPrompt, { model, systemPrompt })
          break
        case 'anthropic':
          responseText = await callAnthropic(userPrompt, { model, systemPrompt, apiKey })
          break
        default:
          throw new Error(`Unknown LLM provider: ${provider}`)
      }

      const obj = extractFirstJsonObject(responseText)
      const classification = parseClassification(obj)
      return {
        topics: classification.topics,
        studyDesign: classification.studyDesign,
        methodologicalFocus: classification.methodologicalFocus,
        exclude: classification.exclude
      }
    } catch (error) {
      lastErr = error
      const message = String(error?.message || '')
      const isRateLimit = message.includes('429') || message.toLowerCase().includes('rate') || message.toLowerCase().includes('queue') || message.toLowerCase().includes('retry')
      const isBadJson = message.toLowerCase().includes('json')
      if (debug) {
        console.info('[llm] Classification attempt failed', { attempt, retryAttempts, isRateLimit, isBadJson, message })
      }
      const shouldRetry = attempt < retryAttempts && (isRateLimit || isBadJson)
      if (shouldRetry) {
        const delay = (isRateLimit ? retryDelayMs : emptyRetryDelayMs) * (attempt + 1)
        await new Promise(res => setTimeout(res, delay))
        continue
      }
      throw error
    }
  }
  throw lastErr
}

/**
 * Generate a lay summary and classification tags for a publication abstract
 */
export async function generateLaySummary(title, abstract, options = {}) {
  const debug = options.debug ?? LLM_DEBUG
  const retryAttempts = options.retryAttempts ?? 3
  const retryDelayMs = options.retryDelayMs ?? 5000
  const emptyRetryDelayMs = options.emptyRetryDelayMs ?? 1000
  const structuredJson = options.structuredJson ?? true
  const classificationPrompt = options.classificationPrompt || DEFAULT_CLASSIFICATION_PROMPT
  const summaryHint = options.summaryHint

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
  if (summaryHint) {
    inputJson.existing_summary = summaryHint
  }
  const userPrompt = structuredJson
    ? `You will write a 2-3 sentence lay summary AND classify the publication using the taxonomy below.

Lay summary requirements:
- 2-3 sentences in plain language
- Avoid jargon and abbreviations
- Do not include the title
- No markdown, bullets, or headings

Classification instructions:
${classificationPrompt}

Return valid JSON with ALL of these keys:
- summary (string, the lay summary)
- topics (array of strings)
- study_design (array of strings)
- methodological_focus (array of strings)
- exclude (boolean)

You may include brief reasoning before the JSON, but the JSON MUST be valid and include all keys.

Input:
${JSON.stringify(inputJson)}`
    : `Title: ${title}

Abstract: ${abstract}

Return only a 2-3 sentence lay summary (no formatting).`

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
      let responseText = null
      switch (provider) {
        case 'openrouter':
          responseText = await callOpenRouter(userPrompt, { model, systemPrompt, apiKey })
          break
        case 'openai':
          responseText = await callOpenAI(userPrompt, { model, systemPrompt, apiKey })
          break
        case 'together':
          responseText = await callTogether(userPrompt, { model, systemPrompt, apiKey })
          break
        case 'groq':
          responseText = await callGroq(userPrompt, { model, systemPrompt, apiKey })
          break
        case 'ollama':
          responseText = await callOllama(userPrompt, { model, systemPrompt })
          break
        case 'anthropic':
          responseText = await callAnthropic(userPrompt, { model, systemPrompt, apiKey })
          break
        default:
          throw new Error(`Unknown LLM provider: ${provider}`)
      }

      let summaryText = responseText
      let classification = { topics: [], studyDesign: [], methodologicalFocus: [], exclude: false }

      if (structuredJson) {
        const obj = extractFirstJsonObject(responseText)
        const picked = pickSummaryField(obj)
        if (picked) summaryText = picked
        classification = parseClassification(obj)
      }

      const cleaned = sanitizeSummary(title, summaryText)

      // Treat empty summary as retryable
      if (!cleaned) {
        const err = new Error('LLM returned empty summary')
        err.code = 'EMPTY_SUMMARY'
        throw err
      }

      return {
        summary: cleaned,
        topics: classification.topics,
        studyDesign: classification.studyDesign,
        methodologicalFocus: classification.methodologicalFocus,
        exclude: classification.exclude
      }
    } catch (error) {
      lastErr = error
      const message = String(error?.message || '')
      const isRateLimit = message.includes('429') || message.toLowerCase().includes('rate') || message.toLowerCase().includes('queue') || message.toLowerCase().includes('retry')
      const isEmpty = error?.code === 'EMPTY_SUMMARY'
      if (debug) {
        console.info('[llm] Summary attempt failed', {
          pmid,
          attempt,
          retryAttempts,
          isRateLimit,
          isEmpty,
          message
        })
      }
      const shouldRetry = attempt < retryAttempts && (isRateLimit || isEmpty)
      if (shouldRetry) {
        const delay = (isRateLimit ? retryDelayMs : emptyRetryDelayMs) * (attempt + 1)
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
      max_tokens: 400,
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
      max_tokens: 400,
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
      max_tokens: 400,
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
      max_tokens: 400,
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
      max_tokens: 400,
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
    classificationProvider,
    classificationModel,
    classificationApiKey,
    includeExistingLaySummary = false,
    debug = LLM_DEBUG,
    retryAttempts,
    retryDelayMs,
    classificationPrompt,
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
          provider: classificationProvider || provider,
          model: classificationModel || model,
          systemPrompt,
          apiKey: classificationApiKey || apiKey,
          classificationPrompt,
          summaryHint: includeExistingLaySummary ? (pub.laySummary || null) : undefined,
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

