import {
  fetchResearchDigestSettings,
  importResearchDigestContent,
} from '../lib/researchDigest.js'

function readFlag(name) {
  return process.argv.includes(`--${name}`)
}

function summarize(result) {
  const papers = result?.papers || {}
  const opportunities = result?.opportunities || {}
  return {
    issueDate: papers.issueDate || null,
    papers: {
      fetched: papers.fetched || 0,
      existing: papers.existing || 0,
      created: papers.created || 0,
      errors: Array.isArray(papers.errors) ? papers.errors.length : 0,
    },
    opportunities: {
      configuredSources: opportunities.configuredSources || 0,
      fetched: opportunities.fetched || 0,
      existing: opportunities.existing || 0,
      created: opportunities.created || 0,
      errors: Array.isArray(opportunities.errors) ? opportunities.errors.length : 0,
    },
  }
}

async function main() {
  try {
    const dryRun = readFlag('dry-run')
    const { settings } = await fetchResearchDigestSettings()
    const result = await importResearchDigestContent({ settings, dryRun })
    const summary = summarize(result)

    console.log(`[research-digest] import ${dryRun ? 'dry run ' : ''}complete`)
    console.log(JSON.stringify(summary, null, 2))

    const errors = [
      ...(result?.papers?.errors || []).map((error) => ({ type: 'paper', ...error })),
      ...(result?.opportunities?.errors || []).map((error) => ({ type: 'opportunity', ...error })),
    ]
    if (errors.length) {
      console.warn('[research-digest] import completed with source errors')
      console.warn(JSON.stringify(errors.slice(0, 12), null, 2))
    }
  } catch (error) {
    console.error('[research-digest] import failed', error)
    process.exitCode = 1
  }
}

main()
