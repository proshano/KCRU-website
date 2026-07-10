import { appendFile } from 'node:fs/promises'

import {
  fetchResearchDigestSettings,
  importResearchDigestContent,
  reselectAutomatedDigestIssue,
} from '../lib/researchDigest.js'

function readFlag(name) {
  return process.argv.includes(`--${name}`)
}

function readOption(name) {
  const prefix = `--${name}=`
  const match = process.argv.find((arg) => arg.startsWith(prefix))
  return match ? match.slice(prefix.length) : ''
}

function summarize(result) {
  const papers = result?.papers || {}
  const opportunities = result?.opportunities || {}
  return {
    issueDate: papers.issueDate || null,
    papers: {
      configuredGroups: papers.configuredGroups || 0,
      fetched: papers.fetched || 0,
      existing: papers.existing || 0,
      created: papers.created || 0,
      llmTriageAttempts: papers.llmTriageAttempts || 0,
      triageErrors: papers.triageErrors || 0,
      eligible: papers.selection?.eligible || 0,
      selected: papers.selection?.selected || 0,
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

async function writeGitHubSummary(summary) {
  if (!process.env.GITHUB_STEP_SUMMARY) return
  const lines = [
    '## Research digest import',
    '',
    `- Issue date: ${summary.issueDate || 'unknown'}`,
    `- Papers fetched: ${summary.papers.fetched}`,
    `- New papers triaged: ${summary.papers.created}`,
    `- Qualifying papers: ${summary.papers.eligible}`,
    `- Papers selected for email: ${summary.papers.selected}`,
    `- Triage errors: ${summary.papers.triageErrors}`,
    `- Source errors: ${summary.papers.errors + summary.opportunities.errors}`,
    '',
  ]
  await appendFile(process.env.GITHUB_STEP_SUMMARY, lines.join('\n'))
}

async function main() {
  try {
    const dryRun = readFlag('dry-run')
    const selectOnly = readFlag('select-only')
    const { settings } = await fetchResearchDigestSettings()

    if (selectOnly) {
      const issueDate = readOption('date') || undefined
      const selection = await reselectAutomatedDigestIssue({ settings, issueDate })
      const resolvedIssueDate = issueDate || selection.issueDate || null
      const summary = {
        issueDate: resolvedIssueDate,
        papers: {
          configuredGroups: 0,
          fetched: 0,
          existing: 0,
          created: 0,
          llmTriageAttempts: 0,
          triageErrors: 0,
          eligible: selection.eligible || 0,
          selected: selection.selected || 0,
          errors: 0,
        },
        opportunities: {
          configuredSources: 0,
          fetched: 0,
          existing: 0,
          created: 0,
          errors: 0,
        },
      }

      console.log('[research-digest] automated selection complete')
      console.log(JSON.stringify(summary, null, 2))
      await writeGitHubSummary(summary)
      return
    }

    const result = await importResearchDigestContent({ settings, dryRun })
    const summary = summarize(result)

    console.log(`[research-digest] import ${dryRun ? 'dry run ' : ''}complete`)
    console.log(JSON.stringify(summary, null, 2))
    await writeGitHubSummary(summary)

    const errors = [
      ...(result?.papers?.errors || []).map((error) => ({ type: 'paper', ...error })),
      ...(result?.opportunities?.errors || []).map((error) => ({ type: 'opportunity', ...error })),
    ]
    if (errors.length) {
      console.warn('[research-digest] import completed with source errors')
      console.warn(JSON.stringify(errors.slice(0, 12), null, 2))
    }

    const allJournalGroupsFailed = (
      summary.papers.configuredGroups > 0 &&
      summary.papers.fetched === 0 &&
      summary.papers.errors >= summary.papers.configuredGroups
    )
    const allLlmTriageFailed = (
      summary.papers.llmTriageAttempts > 0 &&
      summary.papers.triageErrors >= summary.papers.llmTriageAttempts
    )
    if (allJournalGroupsFailed) {
      throw new Error('All configured PubMed journal-group searches failed.')
    }
    if (allLlmTriageFailed) {
      throw new Error('LLM triage failed for every paper that required classification.')
    }
  } catch (error) {
    console.error('[research-digest] import failed', error)
    process.exitCode = 1
  }
}

main()
