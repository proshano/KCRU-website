import fs from 'node:fs/promises'
import { runPubmedReclassification } from '../lib/pubmedReclassification.js'

function parsePmids(value) {
  return String(value || '')
    .split(/[\s,;]+/)
    .map((item) => item.trim())
    .filter(Boolean)
}

async function parseArgs(argv = []) {
  const options = {}

  for (const arg of argv) {
    if (arg === '--all') {
      options.all = true
      continue
    }
    if (arg === '--clear') {
      options.clear = true
      continue
    }
    if (arg === '--dry-run') {
      options.dryRun = true
      continue
    }
    if (arg.startsWith('--count=')) {
      options.count = Number(arg.slice('--count='.length))
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
    if (arg.startsWith('--batch-size=')) {
      options.batchSize = Number(arg.slice('--batch-size='.length))
      continue
    }
    if (arg.startsWith('--delay-ms=')) {
      options.delayMs = Number(arg.slice('--delay-ms='.length))
      continue
    }
    if (arg.startsWith('--concurrency=')) {
      options.concurrency = Number(arg.slice('--concurrency='.length))
      continue
    }
    if (arg.startsWith('--provider=')) {
      options.provider = arg.slice('--provider='.length)
      continue
    }
    if (arg.startsWith('--model=')) {
      options.model = arg.slice('--model='.length)
      continue
    }
    if (arg.startsWith('--api-key=')) {
      options.apiKey = arg.slice('--api-key='.length)
      continue
    }
    if (arg.startsWith('--prompt=')) {
      options.prompt = arg.slice('--prompt='.length)
      continue
    }
    if (arg.startsWith('--prompt-file=')) {
      const promptPath = arg.slice('--prompt-file='.length)
      options.prompt = await fs.readFile(promptPath, 'utf8')
      continue
    }
    throw new Error(`Unknown argument: ${arg}`)
  }

  return options
}

async function main() {
  try {
    const options = await parseArgs(process.argv.slice(2))
    const result = await runPubmedReclassification(options)
    console.log(JSON.stringify({ ok: true, ...result }, null, 2))
  } catch (error) {
    console.error('[pubmed] reclassify script failed', error)
    process.exitCode = 1
  }
}

main()
