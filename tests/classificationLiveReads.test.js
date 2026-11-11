import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

// Files that read pubmedClassification documents another way, with the reason.
const ALLOWED = {
  // The evaluation sample takes whichever client its caller passes; nothing is rebuilt from it.
  'lib/classificationEval.js': 'client',
}

function sourceFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return sourceFiles(path)
    return /\.(js|ts|tsx)$/.test(name) ? [path] : []
  })
}

test('stored classifications are read from the live API, never through the CDN', () => {
  // On 2026-11-11 a reclassification wrote four documents and revalidated the pages; the
  // publications page rebuilt 25 seconds later, read the previous tags through the CDN and
  // would have shown them for up to an hour.
  const reads = []
  for (const file of [...sourceFiles(join(ROOT, 'lib')), ...sourceFiles(join(ROOT, 'app'))]) {
    const source = readFileSync(file, 'utf8')
    for (const match of source.matchAll(/(\w+)\.fetch\(\s*`\*\[_type == "pubmedClassification"/g)) {
      reads.push({ file: relative(ROOT, file), client: match[1] })
    }
  }

  assert.ok(reads.length >= 4, 'expected to find the classification reads')
  for (const { file, client } of reads) {
    assert.equal(client, ALLOWED[file] || 'liveClient', `${file} reads pubmedClassification with ${client}`)
  }
})
