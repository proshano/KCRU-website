import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DEFAULT_FILES = ['.env', '.env.local', '.env.development', '.env.development.local']

function parseEnvFile(contents) {
  const entries = {}
  const lines = contents.split(/\r?\n/)

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const idx = trimmed.indexOf('=')
    if (idx === -1) continue

    let key = trimmed.slice(0, idx).trim()
    if (key.startsWith('export ')) key = key.slice(7).trim()
    if (!key) continue

    let value = trimmed.slice(idx + 1).trim()
    if (value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1)
      value = value
        .replace(/\\n/g, '\n')
        .replace(/\\r/g, '\r')
        .replace(/\\t/g, '\t')
        .replace(/\\\\/g, '\\')
    } else if (value.startsWith("'") && value.endsWith("'")) {
      value = value.slice(1, -1)
    }

    entries[key] = value
  }

  return entries
}

export function loadEnvFiles({ root = rootDir, files = DEFAULT_FILES } = {}) {
  const existingKeys = new Set(Object.keys(process.env))

  for (const file of files) {
    const filePath = path.join(root, file)
    if (!fs.existsSync(filePath)) continue

    const entries = parseEnvFile(fs.readFileSync(filePath, 'utf8'))

    for (const [key, value] of Object.entries(entries)) {
      if (existingKeys.has(key)) continue
      process.env[key] = value
    }
  }

  return { loadedKeys: Object.keys(process.env).filter((key) => !existingKeys.has(key)) }
}
