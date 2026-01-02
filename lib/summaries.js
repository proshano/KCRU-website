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
const DEFAULT_MAX_TOKENS = Number(process.env.LLM_MAX_TOKENS || 400)
const DEFAULT_TEMPERATURE = Number(process.env.LLM_TEMPERATURE || 0.3)
const DEFAULT_CLASSIFICATION_MAX_TOKENS = Number(process.env.LLM_CLASSIFICATION_MAX_TOKENS || 1000)
const DEFAULT_SUMMARY_MAX_TOKENS = Number(process.env.LLM_SUMMARY_MAX_TOKENS || DEFAULT_CLASSIFICATION_MAX_TOKENS)

export const DEFAULT_SYSTEM_PROMPT = `You write summaries of medical research for a general sophisticated audience. 
Be accurate but avoid jargon. Explain what was studied, what was found, and why it matters but avoid statements about "more research is needed". Do not make up information.
Keep summaries to 2-3 sentences. Do not create abbreviations in the summary.`

export const SEO_SUMMARY_SYSTEM_PROMPT = `You write concise, factual meta descriptions for a clinical research website.
Use plain English, avoid hype, and avoid calls to action.
Keep it to 1-2 sentences and return only the description.`

export const SEO_TOPICS_SYSTEM_PROMPT = `You return JSON only. Provide concise topical keywords for a clinical research website.`

function resolveMaxTokens(value, fallback) {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

function resolveTemperature(value, fallback) {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  if (n < 0) return 0
  if (n > 2) return 2
  return n
}

function resolveProviderApiKey(provider, override) {
  if (override) return override
  switch (provider) {
    case 'openrouter':
      return process.env.OPENROUTER_API_KEY
    case 'openai':
      return process.env.OPENAI_API_KEY
    case 'together':
      return process.env.TOGETHER_API_KEY
    case 'groq':
      return process.env.GROQ_API_KEY
    case 'anthropic':
      return process.env.ANTHROPIC_API_KEY
    case 'ollama':
      return null
    default:
      return process.env.OPENROUTER_API_KEY
  }
}

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

function sanitizeSummary(title, raw, options = {}) {
  if (!raw) return null
  const maxSentences = Number.isFinite(options.maxSentences) ? options.maxSentences : 3

  let s = String(raw).replace(/\r\n/g, '\n').trim()

  // Strip code fence markers but keep content.
  s = s.replace(/```[a-zA-Z0-9_-]*\n?/g, '').replace(/```/g, '')

  // Remove common markdown emphasis markers.
  s = s.replace(/\*\*(.*?)\*\*/g, '$1').replace(/__(.*?)__/g, '$1').replace(/`([^`]+)`/g, '$1')

  // IMPORTANT: Strip any trailing JSON objects that the LLM may have appended.
  // This handles cases where the summary field contains: "Summary text here. { \"topics\": [...] }"
  const jsonStart = s.indexOf('{')
  if (jsonStart > 20) {
    // Check if what follows looks like classification JSON
    const possibleJson = s.slice(jsonStart)
    if (/^\s*\{\s*["']?(topics|study_design|methodological_focus|exclude)["']?\s*:/i.test(possibleJson)) {
      s = s.slice(0, jsonStart).trim()
    }
  }

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
  // Remove common LLM prefixes like "Lay Summary:", "Summary:", etc.
  s = s.replace(/^(?:\*\*|__)?\s*(?:lay\s+)?summary\s*(?:\*\*|__)?\s*:\s*/i, '')

  // If it still starts with the title, remove that prefix only when clearly labeled.
  const sHeadNorm = normalizeForCompare(s.slice(0, 240))
  if (normTitle && sHeadNorm.startsWith(normTitle)) {
    try {
      const escaped = String(title).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      s = s.replace(new RegExp(`^\\s*${escaped}\\s*[:\\-–—]\\s*`, 'i'), '').trim()
    } catch {
      // ignore title-regex failures; best-effort only
    }
  }

  s = s.replace(/\s+/g, ' ').trim()
  s = limitSentences(s, maxSentences)

  if (!s || s.length < 20) return null
  return s
}

function isLikelyCorruptedSummary(summary) {
  if (!summary) return true
  const s = String(summary).trim()
  if (s.length < 40) return true

  let total = 0
  let nonAscii = 0
  let letters = 0

  for (const ch of s) {
    total += 1
    const code = ch.charCodeAt(0)
    if (code > 127) nonAscii += 1
    if ((code >= 65 && code <= 90) || (code >= 97 && code <= 122)) {
      letters += 1
    }
  }

  const nonAsciiRatio = total ? nonAscii / total : 1
  const letterRatio = total ? letters / total : 0

  if (nonAscii > 8 && nonAsciiRatio > 0.02) return true
  if (letterRatio < 0.35) return true
  return false
}

function hasUnbalancedDelimiter(text, openChar, closeChar) {
  let balance = 0
  for (const ch of String(text || '')) {
    if (ch === openChar) balance += 1
    if (ch === closeChar) {
      if (balance === 0) return true
      balance -= 1
    }
  }
  return balance !== 0
}

function failsSummaryQa(summary) {
  if (!summary) return true
  if (hasUnbalancedDelimiter(summary, '(', ')')) return true
  if (hasUnbalancedDelimiter(summary, '[', ']')) return true
  return false
}

function normalizePromptValue(value) {
  if (!value) return ''
  return String(value).replace(/\r\n/g, '\n').trim()
}

function normalizePromptList(value) {
  if (Array.isArray(value)) {
    return value.map((item) => normalizePromptValue(item)).filter(Boolean)
  }
  if (typeof value === 'string') {
    return value
      .split(/[\n,]+/)
      .map((item) => normalizePromptValue(item))
      .filter(Boolean)
  }
  return []
}

function formatPromptList(value) {
  const items = normalizePromptList(value)
  if (!items.length) return 'Not available'
  return items.map((item) => `- ${item}`).join('\n')
}

function truncatePromptText(value, limit = 5000) {
  const text = normalizePromptValue(value)
  if (!text) return 'Not available'
  if (text.length <= limit) return text
  return `${text.slice(0, limit).trim()}...`
}

function fillPromptTemplate(template, values) {
  let output = String(template || '')
  for (const [key, value] of Object.entries(values || {})) {
    output = output.replaceAll(`{${key}}`, value ?? '')
  }
  return output
}

function pickFirstString(obj, keys = []) {
  if (!obj || typeof obj !== 'object') return null
  for (const key of keys) {
    const value = obj[key]
    if (typeof value === 'string' && value.trim()) return value
  }
  return null
}

function cleanShortTitle(value) {
  if (!value) return null
  let text = stripCodeFences(value)
  text = text.replace(/^["'`]+|["'`]+$/g, '')
  text = text.replace(/^(short\s+clinical\s+title|short\s+title|title)\s*[:\-]\s*/i, '')
  text = text.replace(/\s+/g, ' ').trim()
  if (!text) return null
  return text.length > 140 ? text.slice(0, 140).trim() : text
}

function cleanEligibilityStatement(value) {
  if (!value) return null
  let text = stripCodeFences(value)
  text = text.replace(/^["'`]+|["'`]+$/g, '')
  text = text.replace(/^(eligibility\s+statement|eligibility)\s*[:\-]\s*/i, '')
  text = text.replace(/^\s*[-*•]\s+/gm, '')
  text = text.replace(/\s+/g, ' ').trim()
  text = limitSentences(text, 2)
  if (!text || text.length < 12) return null
  return text
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
  const apiKey = resolveProviderApiKey(provider, options.apiKey)
  const classificationPrompt = options.classificationPrompt || DEFAULT_CLASSIFICATION_PROMPT
  const maxTokens = resolveMaxTokens(options.maxTokens, DEFAULT_CLASSIFICATION_MAX_TOKENS)

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
          responseText = await callOpenRouter(userPrompt, { model, systemPrompt, apiKey, maxTokens })
          break
        case 'openai':
          responseText = await callOpenAI(userPrompt, { model, systemPrompt, apiKey, maxTokens })
          break
        case 'together':
          responseText = await callTogether(userPrompt, { model, systemPrompt, apiKey, maxTokens })
          break
        case 'groq':
          responseText = await callGroq(userPrompt, { model, systemPrompt, apiKey, maxTokens })
          break
        case 'ollama':
          responseText = await callOllama(userPrompt, { model, systemPrompt, maxTokens })
          break
        case 'anthropic':
          responseText = await callAnthropic(userPrompt, { model, systemPrompt, apiKey, maxTokens })
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
  const apiKey = resolveProviderApiKey(provider, options.apiKey)
  const pmid = options?.meta?.pmid
  const maxTokens = resolveMaxTokens(options.maxTokens, DEFAULT_SUMMARY_MAX_TOKENS)

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
          responseText = await callOpenRouter(userPrompt, { model, systemPrompt, apiKey, maxTokens })
          break
        case 'openai':
          responseText = await callOpenAI(userPrompt, { model, systemPrompt, apiKey, maxTokens })
          break
        case 'together':
          responseText = await callTogether(userPrompt, { model, systemPrompt, apiKey, maxTokens })
          break
        case 'groq':
          responseText = await callGroq(userPrompt, { model, systemPrompt, apiKey, maxTokens })
          break
        case 'ollama':
          responseText = await callOllama(userPrompt, { model, systemPrompt, maxTokens })
          break
        case 'anthropic':
          responseText = await callAnthropic(userPrompt, { model, systemPrompt, apiKey, maxTokens })
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

      if (failsSummaryQa(cleaned)) {
        const err = new Error('LLM summary failed QA')
        err.code = 'QA_FAILED'
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
      const isQaFailed = error?.code === 'QA_FAILED'
      if (debug) {
        console.info('[llm] Summary attempt failed', {
          pmid,
          attempt,
          retryAttempts,
          isRateLimit,
          isEmpty,
          isQaFailed,
          message
        })
      }
      const shouldRetry = attempt < retryAttempts && (isRateLimit || isEmpty || isQaFailed)
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

async function callOpenRouter(userPrompt, { model, systemPrompt, apiKey, maxTokens, temperature }) {
  // OpenRouter - aggregator with free models including gpt-oss-120b
  // Models: openrouter/gpt-oss-120b (free), meta-llama/llama-3.1-8b-instruct:free, etc.
  const messages = buildOpenRouterMessages(model, systemPrompt, userPrompt)
  const resolvedMaxTokens = resolveMaxTokens(maxTokens, DEFAULT_MAX_TOKENS)
  const resolvedTemperature = resolveTemperature(temperature, DEFAULT_TEMPERATURE)
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
      max_tokens: resolvedMaxTokens,
      temperature: resolvedTemperature
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

async function callOpenAI(userPrompt, { model, systemPrompt, apiKey, maxTokens, temperature }) {
  const resolvedMaxTokens = resolveMaxTokens(maxTokens, DEFAULT_MAX_TOKENS)
  const resolvedTemperature = resolveTemperature(temperature, DEFAULT_TEMPERATURE)
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
      max_tokens: resolvedMaxTokens,
      temperature: resolvedTemperature
    })
  })

  const data = await response.json()
  return data.choices?.[0]?.message?.content?.trim() || null
}

async function callTogether(userPrompt, { model, systemPrompt, apiKey, maxTokens, temperature }) {
  // Together.ai - cheap Llama hosting
  // Models: meta-llama/Llama-3.1-8B-Instruct, mistralai/Mixtral-8x7B-Instruct-v0.1
  const resolvedMaxTokens = resolveMaxTokens(maxTokens, DEFAULT_MAX_TOKENS)
  const resolvedTemperature = resolveTemperature(temperature, DEFAULT_TEMPERATURE)
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
      max_tokens: resolvedMaxTokens,
      temperature: resolvedTemperature
    })
  })

  const data = await response.json()
  return data.choices?.[0]?.message?.content?.trim() || null
}

async function callGroq(userPrompt, { model, systemPrompt, apiKey, maxTokens }) {
  // Groq - fast inference, free tier
  // Models: llama-3.1-8b-instant, llama-3.1-70b-versatile, mixtral-8x7b-32768
  const resolvedMaxTokens = resolveMaxTokens(maxTokens, DEFAULT_MAX_TOKENS)
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
      max_tokens: resolvedMaxTokens,
      temperature: 0.3
    })
  })

  const data = await response.json()
  return data.choices?.[0]?.message?.content?.trim() || null
}

async function callOllama(userPrompt, { model, systemPrompt, maxTokens }) {
  // Ollama - local/self-hosted, free
  // Requires OLLAMA_HOST env var (default: http://localhost:11434)
  const host = process.env.OLLAMA_HOST || 'http://localhost:11434'
  const resolvedMaxTokens = resolveMaxTokens(maxTokens, DEFAULT_MAX_TOKENS)
  const options = { temperature: 0.3 }
  if (resolvedMaxTokens) {
    options.num_predict = resolvedMaxTokens
  }
  
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
      options
    })
  })

  const data = await response.json()
  return data.message?.content?.trim() || null
}

async function callAnthropic(userPrompt, { model, systemPrompt, apiKey, maxTokens }) {
  const resolvedMaxTokens = resolveMaxTokens(maxTokens, DEFAULT_MAX_TOKENS)
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey || process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: model || 'claude-3-haiku-20240307',
      max_tokens: resolvedMaxTokens,
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
    maxTokens,
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
          retryDelayMs,
          maxTokens
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

export const TRIAL_SUMMARY_SYSTEM_PROMPT = `You write concise clinical trial summaries for physicians.
Be accurate, clinically precise, and non-promotional. Explain the study purpose, intervention, and target population
without speculation. Write in the present tense. Use common clinical abbreviations (eGFR, UPCR, UACR, ACR, LDL) without
spelling them out. Keep summaries to 3-5 sentences. Do not make up information.`

export const TRIAL_COMMUNICATION_TITLE_PROMPT = `You write short clinician-facing study titles for emails and referral outreach.
Use the real study title and inclusion criteria to highlight population and intervention.
Keep it under 8 words, plain text, no quotes.
Avoid marketing language. Keep recognizable acronyms from the official or brief title.

Return JSON only with this key:
{"short_title":"..."}

Study title (display): {title}
Official title: {official_title}
Brief title: {brief_title}
NCT ID: {nct_id}
Inclusion criteria:
{inclusion_criteria}
Exclusion criteria:
{exclusion_criteria}
Eligibility criteria (raw):
{eligibility_criteria_raw}`

export const TRIAL_COMMUNICATION_ELIGIBILITY_PROMPT = `Write a 1-2 sentence eligibility statement for clinician outreach.
Use only major inclusion criteria. Focus on population, disease stage, key labs, and required therapies.
Do not include exclusion criteria or screening steps.
Keep it concise, plain text, no bullets or quotes.

Return JSON only with this key:
{"eligibility_statement":"..."}

Study title (display): {title}
Official title: {official_title}
Brief title: {brief_title}
NCT ID: {nct_id}
Inclusion criteria:
{inclusion_criteria}
Exclusion criteria:
{exclusion_criteria}
Eligibility criteria (raw):
{eligibility_criteria_raw}`

/**
 * Generate a clinician-focused summary for a clinical trial
 * @param {Object} trialData - Trial data from ClinicalTrials.gov
 * @returns {Promise<string|null>} Clinician-focused summary
 */
export async function generateTrialSummary(trialData, options = {}) {
  const debug = options.debug ?? LLM_DEBUG
  
  const {
    briefTitle,
    officialTitle,
    briefSummary,
    detailedDescription,
    conditions,
    interventions,
    nctId
  } = trialData
  
  if (!briefSummary && !detailedDescription && !officialTitle) {
    if (debug) console.info('[llm] Skipping trial summary - no data', { nctId })
    return null
  }

  const provider = options.provider || DEFAULT_PROVIDER
  const model = options.model || DEFAULT_MODEL
  const apiKey = options.apiKey || process.env.OPENROUTER_API_KEY
  const systemPrompt = options.systemPrompt || TRIAL_SUMMARY_SYSTEM_PROMPT
  const maxTokens = resolveMaxTokens(options.maxTokens, DEFAULT_MAX_TOKENS)
  const temperature = resolveTemperature(options.temperature, DEFAULT_TEMPERATURE)
  const corruptionRetries = Number.isFinite(options.corruptionRetries) ? options.corruptionRetries : 2

  // Build a user prompt with available trial info
  const conditionsText = conditions?.length ? `Conditions: ${conditions.join(', ')}` : ''
  const interventionsText = interventions?.length 
    ? `Interventions: ${interventions.map(i => typeof i === 'string' ? i : i.name).join(', ')}`
    : ''

  const userPrompt = `Clinical Trial: ${officialTitle || briefTitle}

${conditionsText}
${interventionsText}

Brief Summary: ${briefSummary || 'Not available'}
Detailed Description: ${detailedDescription || 'Not available'}

Write a 3-5 sentence clinician-focused summary for physicians.
Focus on the study purpose, intervention, and target population.
Write in the present tense. Use common clinical abbreviations where appropriate.
Avoid marketing language.`

  if (debug) {
    console.info('[llm] Requesting trial summary', { nctId, provider, model })
  }

  try {
    let result
    switch (provider) {
      case 'openrouter':
        result = await callOpenRouter(userPrompt, { model, systemPrompt, apiKey, maxTokens, temperature })
        break
      case 'openai':
        result = await callOpenAI(userPrompt, { model, systemPrompt, apiKey, maxTokens, temperature })
        break
      default:
        result = await callOpenRouter(userPrompt, { model, systemPrompt, apiKey, maxTokens, temperature })
    }
    let summary = sanitizeSummary(nctId, result, { maxSentences: 5 })
    if (isLikelyCorruptedSummary(summary)) {
      const strictPrompt = `${userPrompt}

Important: Return clean, plain-English sentences only. Avoid any non-English characters or symbols.`
      const retries = Math.max(0, Number(corruptionRetries))
      for (let attempt = 1; attempt <= retries; attempt += 1) {
        if (debug) {
          console.info('[llm] Retrying trial summary after corruption check', { nctId, attempt })
        }
        let retryResult
        switch (provider) {
          case 'openrouter':
            retryResult = await callOpenRouter(strictPrompt, { model, systemPrompt, apiKey, maxTokens, temperature: 0 })
            break
          case 'openai':
            retryResult = await callOpenAI(strictPrompt, { model, systemPrompt, apiKey, maxTokens, temperature: 0 })
            break
          default:
            retryResult = await callOpenRouter(strictPrompt, { model, systemPrompt, apiKey, maxTokens, temperature: 0 })
        }
        summary = sanitizeSummary(nctId, retryResult, { maxSentences: 5 })
        if (!isLikelyCorruptedSummary(summary)) {
          break
        }
      }
    }
    return isLikelyCorruptedSummary(summary) ? null : summary
  } catch (error) {
    console.error('[llm] Error generating trial summary:', error)
    return null
  }
}

/**
 * Generate a short SEO-friendly summary for metadata and LLM outputs.
 */
export async function generateSeoSummary(input = {}, options = {}) {
  const debug = options.debug ?? LLM_DEBUG
  const title = normalizePromptValue(input.title)
  const body = normalizePromptValue(input.body)
  const hints = Array.isArray(input.hints)
    ? input.hints.map((item) => normalizePromptValue(item)).filter(Boolean)
    : []

  if (!title && !body) {
    if (debug) console.info('[llm] Skipping SEO summary - missing input')
    return null
  }

  const provider = options.provider || DEFAULT_PROVIDER
  const model = options.model || DEFAULT_MODEL
  const apiKey = options.apiKey || process.env.OPENROUTER_API_KEY
  const systemPrompt = options.systemPrompt || SEO_SUMMARY_SYSTEM_PROMPT
  const maxTokens = resolveMaxTokens(options.maxTokens, DEFAULT_MAX_TOKENS)
  const temperature = resolveTemperature(options.temperature, 0.2)

  const promptParts = [
    `Title: ${title || 'Not available'}`,
    '',
    `Content:\n${truncatePromptText(body, 2500)}`,
  ]

  if (hints.length) {
    promptParts.push('', `Key terms: ${hints.join(', ')}`)
  }

  const userPrompt = `${promptParts.join('\n')}

Write a 1-2 sentence meta description for search results. Avoid marketing language.`

  async function callProvider(prompt) {
    switch (provider) {
      case 'openrouter':
        return callOpenRouter(prompt, { model, systemPrompt, apiKey, maxTokens, temperature })
      case 'openai':
        return callOpenAI(prompt, { model, systemPrompt, apiKey, maxTokens, temperature })
      case 'together':
        return callTogether(prompt, { model, systemPrompt, apiKey, maxTokens, temperature })
      case 'groq':
        return callGroq(prompt, { model, systemPrompt, apiKey, maxTokens })
      case 'ollama':
        return callOllama(prompt, { model, systemPrompt, maxTokens })
      case 'anthropic':
        return callAnthropic(prompt, { model, systemPrompt, apiKey, maxTokens })
      default:
        throw new Error(`Unknown LLM provider: ${provider}`)
    }
  }

  try {
    if (debug) console.info('[llm] Requesting SEO summary', { provider, model })
    const responseText = await callProvider(userPrompt)
    const summary = sanitizeSummary(title || 'Summary', responseText, { maxSentences: 2 })
    return isLikelyCorruptedSummary(summary) ? null : summary
  } catch (error) {
    console.error('[llm] Error generating SEO summary:', error)
    return null
  }
}

/**
 * Generate topical keywords for SEO/LLM summaries.
 */
export async function generateSeoTopics(input = {}, options = {}) {
  const debug = options.debug ?? LLM_DEBUG
  const context = normalizePromptValue(input.context)
  const maxTopics = Number.isFinite(options.maxTopics) ? options.maxTopics : 8

  if (!context) {
    if (debug) console.info('[llm] Skipping SEO topics - missing input')
    return []
  }

  const provider = options.provider || DEFAULT_PROVIDER
  const model = options.model || DEFAULT_MODEL
  const apiKey = options.apiKey || process.env.OPENROUTER_API_KEY
  const systemPrompt = options.systemPrompt || SEO_TOPICS_SYSTEM_PROMPT
  const maxTokens = resolveMaxTokens(options.maxTokens, 300)
  const temperature = resolveTemperature(options.temperature, 0.2)

  const userPrompt = `Context:
${truncatePromptText(context, 2500)}

Return JSON only with this key:
{"topics":["topic 1","topic 2", "..."]}`

  async function callProvider(prompt) {
    switch (provider) {
      case 'openrouter':
        return callOpenRouter(prompt, { model, systemPrompt, apiKey, maxTokens, temperature })
      case 'openai':
        return callOpenAI(prompt, { model, systemPrompt, apiKey, maxTokens, temperature })
      case 'together':
        return callTogether(prompt, { model, systemPrompt, apiKey, maxTokens, temperature })
      case 'groq':
        return callGroq(prompt, { model, systemPrompt, apiKey, maxTokens })
      case 'ollama':
        return callOllama(prompt, { model, systemPrompt, maxTokens })
      case 'anthropic':
        return callAnthropic(prompt, { model, systemPrompt, apiKey, maxTokens })
      default:
        throw new Error(`Unknown LLM provider: ${provider}`)
    }
  }

  try {
    if (debug) console.info('[llm] Requesting SEO topics', { provider, model })
    const responseText = await callProvider(userPrompt)
    const obj = extractFirstJsonObject(responseText)
    const rawTopics = Array.isArray(obj?.topics) ? obj.topics : []
    const cleaned = rawTopics
      .map((topic) => String(topic || '').replace(/[`"'']/g, '').replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .filter((topic) => topic.length >= 3 && topic.length <= 60)
      .slice(0, maxTopics)

    return cleaned
  } catch (error) {
    console.error('[llm] Error generating SEO topics:', error)
    return []
  }
}

/**
 * Generate clinician-facing short titles and eligibility statements for trial communications.
 */
export async function generateTrialCommunications(trialData = {}, options = {}) {
  const debug = options.debug ?? LLM_DEBUG
  const provider = options.provider || DEFAULT_PROVIDER
  const model = options.model || DEFAULT_MODEL
  const systemPrompt = options.systemPrompt || 'You are a careful clinical research coordinator.'
  const apiKey = options.apiKey || process.env.OPENROUTER_API_KEY
  const titlePrompt = options.titlePrompt || TRIAL_COMMUNICATION_TITLE_PROMPT
  const eligibilityPrompt = options.eligibilityPrompt || TRIAL_COMMUNICATION_ELIGIBILITY_PROMPT
  const maxTokens = resolveMaxTokens(options.maxTokens, DEFAULT_MAX_TOKENS)
  const temperature = resolveTemperature(options.temperature, 0.2)

  const title = normalizePromptValue(trialData.title)
  const officialTitle = normalizePromptValue(trialData.officialTitle)
  const briefTitle = normalizePromptValue(trialData.briefTitle)
  const nctId = normalizePromptValue(trialData.nctId)
  const inclusionCriteria = normalizePromptList(trialData.inclusionCriteria)
  const exclusionCriteria = normalizePromptList(trialData.exclusionCriteria)
  const eligibilityCriteriaRaw = normalizePromptValue(trialData.eligibilityCriteriaRaw)

  const promptValues = {
    title: title || 'Not available',
    official_title: officialTitle || 'Not available',
    brief_title: briefTitle || 'Not available',
    nct_id: nctId || 'Not available',
    inclusion_criteria: formatPromptList(inclusionCriteria),
    exclusion_criteria: formatPromptList(exclusionCriteria),
    eligibility_criteria_raw: truncatePromptText(eligibilityCriteriaRaw),
  }

  const titleUserPrompt = fillPromptTemplate(titlePrompt, promptValues)
  const eligibilityUserPrompt = fillPromptTemplate(eligibilityPrompt, promptValues)

  async function callProvider(userPrompt) {
    switch (provider) {
      case 'openrouter':
        return callOpenRouter(userPrompt, { model, systemPrompt, apiKey, maxTokens, temperature })
      case 'openai':
        return callOpenAI(userPrompt, { model, systemPrompt, apiKey, maxTokens, temperature })
      case 'together':
        return callTogether(userPrompt, { model, systemPrompt, apiKey, maxTokens, temperature })
      case 'groq':
        return callGroq(userPrompt, { model, systemPrompt, apiKey, maxTokens })
      case 'ollama':
        return callOllama(userPrompt, { model, systemPrompt, maxTokens })
      case 'anthropic':
        return callAnthropic(userPrompt, { model, systemPrompt, apiKey, maxTokens })
      default:
        throw new Error(`Unknown LLM provider: ${provider}`)
    }
  }

  let emailTitle = null
  let emailEligibilitySummary = null

  try {
    if (debug) console.info('[llm] Requesting short clinical title', { nctId, provider, model })
    const responseText = await callProvider(titleUserPrompt)
    const obj = extractFirstJsonObject(responseText)
    const rawTitle = pickFirstString(obj, ['short_title', 'shortTitle', 'title']) || responseText
    emailTitle = cleanShortTitle(rawTitle)
  } catch (error) {
    console.error('[llm] Error generating short clinical title:', error)
  }

  try {
    if (debug) console.info('[llm] Requesting eligibility statement', { nctId, provider, model })
    const responseText = await callProvider(eligibilityUserPrompt)
    const obj = extractFirstJsonObject(responseText)
    const rawStatement =
      pickFirstString(obj, ['eligibility_statement', 'eligibilityStatement', 'statement']) || responseText
    emailEligibilitySummary = cleanEligibilityStatement(rawStatement)
  } catch (error) {
    console.error('[llm] Error generating eligibility statement:', error)
  }

  return {
    emailTitle,
    emailEligibilitySummary,
  }
}
