import { sanityFetch, queries } from '../lib/sanity.js'
import { refreshPubmedCache } from '../lib/publications.js'

const MAX_PER_RESEARCHER = Number(process.env.PUBMED_MAX_PER_RESEARCHER || 1000)

function hasConfiguredLlmAccess({ provider }) {
  switch (provider) {
    case 'openrouter':
      return Boolean(process.env.OPENROUTER_API_KEY)
    case 'openai':
      return Boolean(process.env.OPENAI_API_KEY)
    case 'together':
      return Boolean(process.env.TOGETHER_API_KEY)
    case 'groq':
      return Boolean(process.env.GROQ_API_KEY)
    case 'anthropic':
      return Boolean(process.env.ANTHROPIC_API_KEY)
    case 'ollama':
      return true
    default:
      return false
  }
}

async function main() {
  try {
    const settings = (await sanityFetch(queries.siteSettings)) || {}
    const researchers = ((await sanityFetch(queries.allResearchers)) || []).map((r) => ({
      _id: r._id,
      name: r.name,
      slug: r.slug,
      pubmedQuery: r.pubmedQuery,
      orcid: r.orcid,
    }))
    const provider = settings.llmProvider || process.env.LLM_PROVIDER || 'openrouter'

    const result = await refreshPubmedCache({
      researchers,
      maxPerResearcher: MAX_PER_RESEARCHER,
      force: true,
      summariesPerRun: Infinity,
      llmOptions: {
        provider,
        model: settings.llmModel,
        systemPrompt: settings.llmSystemPrompt,
        // Conservative rate limits to avoid throttling; adjust via env if desired.
        concurrency: Number(process.env.LLM_CONCURRENCY || 1),
        delayMs: Number(process.env.LLM_DELAY_MS || 3000),
        retryAttempts: Number(process.env.LLM_RETRY_ATTEMPTS || 4),
        retryDelayMs: Number(process.env.LLM_RETRY_DELAY_MS || 5000)
      }
    })

    const count = result?.meta?.counts?.total || result?.publications?.length || 0
    const summariesGenerated = result?.meta?.summaries?.generated || 0
    const hasLlmAccess = hasConfiguredLlmAccess({ provider })
    const summaryCandidates = (result?.publications || []).filter((pub) => {
      return !pub?.laySummary && String(pub?.abstract || '').trim().length >= 50
    })

    if (!hasLlmAccess && summaryCandidates.length > 0) {
      const sampleIds = summaryCandidates.slice(0, 5).map((pub) => pub.pmid || pub.doi).filter(Boolean)
      throw new Error(
        `[pubmed] ${summaryCandidates.length} publication(s) still need summaries, but no LLM credentials are configured for provider "${provider}". Configure the GitHub Actions secret for that provider. Sample publication ID(s): ${sampleIds.join(', ')}`
      )
    }

    console.log(`[pubmed] cache refreshed: ${count} publications; summaries generated this run: ${summariesGenerated}; cache at ${result?.meta?.cachePath || 'runtime/pubmed-cache.json'}`)
  } catch (err) {
    console.error('[pubmed] cache refresh failed', err)
    process.exitCode = 1
  }
}

main()
