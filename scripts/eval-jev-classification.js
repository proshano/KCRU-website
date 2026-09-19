import fs from 'node:fs/promises'

import { runClassificationEval } from '../lib/classificationEval.js'

function parsePmids(value) {
  return String(value || '')
    .split(/[\s,;]+/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function parseArgs(argv = []) {
  const options = {}
  for (const arg of argv) {
    if (arg === '--dry-run') {
      options.dryRun = true
      continue
    }
    if (arg === '--no-persist') {
      options.persist = false
      continue
    }
    if (arg.startsWith('--count=')) {
      options.count = Number(arg.slice('--count='.length))
      continue
    }
    if (arg.startsWith('--seed=')) {
      options.seed = Number(arg.slice('--seed='.length))
      continue
    }
    if (arg.startsWith('--concurrency=')) {
      options.concurrency = Number(arg.slice('--concurrency='.length))
      continue
    }
    if (arg.startsWith('--year=')) {
      options.year = arg.slice('--year='.length)
      continue
    }
    if (arg.startsWith('--pmids=')) {
      options.pmids = parsePmids(arg.slice('--pmids='.length))
      continue
    }
    if (arg.startsWith('--label=')) {
      options.label = arg.slice('--label='.length)
      continue
    }
    if (arg.startsWith('--model=')) {
      options.model = arg.slice('--model='.length)
      continue
    }
    if (arg.startsWith('--transport=')) {
      options.transport = arg.slice('--transport='.length)
      continue
    }
    if (arg.startsWith('--out=')) {
      options.out = arg.slice('--out='.length)
      continue
    }
    throw new Error(`Unknown argument: ${arg}`)
  }
  return options
}

function pct(value) {
  return Number.isFinite(value) ? `${Math.round(value * 100)}%` : '—'
}

function printSummary(result) {
  const { run, metrics } = result
  const lines = []
  lines.push(`Jev classification evaluation${run?._id ? ` (${run._id})` : ''}`)
  lines.push(`  model: ${run.model} via ${run.transport}`)
  lines.push(`  papers: ${metrics.papers} (scored ${metrics.scored}, errors ${metrics.errors})`)
  lines.push(`  all axes exact: ${metrics.allExact}/${metrics.scored} (${pct(metrics.allExactRate)})`)
  for (const axis of Object.values(metrics.axes)) {
    lines.push(
      `  ${axis.label.padEnd(22)} exact ${pct(axis.exactMatchRate).padStart(4)}  P ${pct(axis.precision).padStart(4)}  R ${pct(axis.recall).padStart(4)}  F1 ${pct(axis.f1).padStart(4)}  (baseline ${axis.baselineTags} tags, jev ${axis.jevTags})`
    )
  }
  lines.push(`  exclude agreement: ${pct(metrics.exclude.agreeRate)} (baseline ${metrics.exclude.baselineExcluded}, jev ${metrics.exclude.jevExcluded})`)
  lines.push(`  latency: mean ${metrics.latency.meanMs ?? '—'} ms, max ${metrics.latency.maxMs ?? '—'} ms`)
  lines.push(`  tokens: ${metrics.usage.inputTokens} in / ${metrics.usage.outputTokens} out, est. $${metrics.usage.estimatedUsd.toFixed(4)}`)
  const noisy = metrics.tags.filter((tag) => tag.disagreements > 0).slice(0, 10)
  if (noisy.length) {
    lines.push('  most-disagreed tags:')
    for (const tag of noisy) {
      lines.push(`    ${tag.tag.padEnd(40)} agree ${tag.agree}  jev-only ${tag.jevOnly}  baseline-only ${tag.baselineOnly}`)
    }
  }
  console.log(lines.join('\n'))
}

async function main() {
  try {
    const options = parseArgs(process.argv.slice(2))
    const result = await runClassificationEval(options)
    if (result.dryRun) {
      console.log(JSON.stringify({ ok: true, dryRun: true, selection: result.selection, config: result.config }, null, 2))
      return
    }
    printSummary(result)
    if (options.out) {
      await fs.writeFile(options.out, JSON.stringify({ run: result.run, metrics: result.metrics }, null, 2))
      console.log(`  wrote ${options.out}`)
    }
    if (!result.persisted) {
      console.log('  (not written to Sanity)')
    } else {
      console.log('  review at /admin/classification-eval')
    }
  } catch (error) {
    console.error('[jev] classification evaluation failed', error)
    process.exitCode = 1
  }
}

main()
