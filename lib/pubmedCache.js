import fs from 'fs/promises'
import path from 'path'

const CACHE_PATH = path.join(process.cwd(), 'runtime', 'pubmed-cache.json')
const LOCK_PATH = path.join(process.cwd(), 'runtime', 'pubmed-cache.lock')
const CANCEL_PATH = path.join(process.cwd(), 'runtime', 'pubmed-cache.cancel')

const DEFAULT_MAX_AGE_MS = Number(process.env.PUBMED_CACHE_MAX_AGE_MS || 24 * 60 * 60 * 1000) // 24h
const LOCK_TTL_MS = Number(process.env.PUBMED_CACHE_LOCK_TTL_MS || 10 * 60 * 1000) // 10m

async function ensureDir() {
  const dir = path.dirname(CACHE_PATH)
  await fs.mkdir(dir, { recursive: true })
}

export function isCacheStale(cache, maxAgeMs = DEFAULT_MAX_AGE_MS) {
  if (!cache?.generatedAt) return true
  const ts = Date.parse(cache.generatedAt)
  if (Number.isNaN(ts)) return true
  return Date.now() - ts > maxAgeMs
}

export async function readCache() {
  try {
    const raw = await fs.readFile(CACHE_PATH, 'utf8')
    return JSON.parse(raw)
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.error('Failed to read PubMed cache', err)
    }
    return null
  }
}

export async function writeCache(payload) {
  await ensureDir()
  const tmpPath = `${CACHE_PATH}.tmp`
  const body = JSON.stringify(payload, null, 2)
  await fs.writeFile(tmpPath, body, 'utf8')
  await fs.rename(tmpPath, CACHE_PATH)
}

async function readLock() {
  try {
    const raw = await fs.readFile(LOCK_PATH, 'utf8')
    return JSON.parse(raw)
  } catch (err) {
    return null
  }
}

async function writeLock(info) {
  await ensureDir()
  await fs.writeFile(LOCK_PATH, JSON.stringify(info, null, 2), 'utf8')
}

async function clearLock() {
  try {
    await fs.unlink(LOCK_PATH)
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.error('Failed to clear PubMed cache lock', err)
    }
  }
}

async function clearCancelRequest() {
  try {
    await fs.unlink(CANCEL_PATH)
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.error('Failed to clear PubMed cache cancel request', err)
    }
  }
}

async function requestCancel() {
  try {
    await ensureDir()
    await fs.writeFile(CANCEL_PATH, JSON.stringify({ timestamp: Date.now() }, null, 2), 'utf8')
  } catch (err) {
    console.error('Failed to write cancel request', err)
  }
}

async function isCancelRequested() {
  try {
    await fs.access(CANCEL_PATH)
    return true
  } catch {
    return false
  }
}

async function getLockInfo() {
  return readLock()
}

export async function withCacheLock(action) {
  const existing = await readLock()
  const now = Date.now()
  if (existing?.timestamp && now - existing.timestamp < LOCK_TTL_MS) {
    throw new Error('PubMed cache refresh already in progress')
  }

  await writeLock({ timestamp: now, pid: process.pid })

  try {
    const result = await action()
    await clearLock()
    await clearCancelRequest()
    return result
  } catch (err) {
    await clearLock()
    await clearCancelRequest()
    throw err
  }
}

export { CACHE_PATH, requestCancel, isCancelRequested, clearCancelRequest, getLockInfo }
