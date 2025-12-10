import { sanityFetch, queries } from '../lib/sanity.js'
import { refreshPubmedCache } from '../lib/publications.js'

const MAX_PER_RESEARCHER = Number(process.env.PUBMED_MAX_PER_RESEARCHER || 120)
const MAX_AFFILIATION = Number(process.env.PUBMED_MAX_AFFILIATION || 80)

async function main() {
  try {
    const settings = (await sanityFetch(queries.siteSettings)) || {}
    const researchers = ((await sanityFetch(queries.allResearchers)) || []).map((r) => ({
      _id: r._id,
      name: r.name,
      slug: r.slug,
      pubmedQuery: r.pubmedQuery,
    }))

    const result = await refreshPubmedCache({
      researchers,
      affiliation: settings?.pubmedAffiliation || '',
      maxPerResearcher: MAX_PER_RESEARCHER,
      maxAffiliation: MAX_AFFILIATION,
      force: true,
      summariesPerRun: Infinity,
      llmOptions: {
        provider: settings.llmProvider || 'openrouter',
        model: settings.llmModel,
        apiKey: settings.llmApiKey,
        systemPrompt: settings.llmSystemPrompt,
        // Conservative rate limits to avoid throttling; adjust via env if desired.
        concurrency: Number(process.env.LLM_CONCURRENCY || 1),
        delayMs: Number(process.env.LLM_DELAY_MS || 3000),
        retryAttempts: Number(process.env.LLM_RETRY_ATTEMPTS || 4),
        retryDelayMs: Number(process.env.LLM_RETRY_DELAY_MS || 5000)
      }
    })

    const count = result?.meta?.counts?.combined || result?.publications?.length || 0
    const summariesGenerated = result?.meta?.summaries?.generated || 0
    console.log(`[pubmed] cache refreshed: ${count} publications; summaries generated this run: ${summariesGenerated}; cache at ${result?.meta?.cachePath || 'runtime/pubmed-cache.json'}`)
  } catch (err) {
    console.error('[pubmed] cache refresh failed', err)
    process.exitCode = 1
  }
}

main()
