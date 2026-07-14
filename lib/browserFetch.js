/**
 * Headless Chromium fetcher for pages behind Cloudflare/bot protection.
 *
 * Uses puppeteer-core + @sparticuz/chromium-min on Vercel (serverless),
 * or a local Chrome/Chromium install during development.
 *
 * Intended as a last-resort fallback when plain fetch() is blocked.
 */

import { validatePublicOutboundUrl } from './outboundUrlSafety.js'

// Vercel Lambda runs x64 Linux; @sparticuz/chromium-min downloads this at cold start
const CHROMIUM_REMOTE_URL =
  'https://github.com/Sparticuz/chromium/releases/download/v143.0.4/chromium-v143.0.4-pack.x64.tar'

const DEFAULT_TIMEOUT_MS = Number(process.env.BROWSER_FETCH_TIMEOUT_MS || 25000)
const MAX_BROWSER_BYTES = Number(process.env.BROWSER_FETCH_MAX_BYTES || 5 * 1024 * 1024)
const MAX_BROWSER_REQUESTS = Number(process.env.BROWSER_FETCH_MAX_REQUESTS || 100)
const MAX_BROWSER_HTML_CHARS = Number(process.env.BROWSER_FETCH_MAX_HTML_CHARS || 2 * 1024 * 1024)

const LOCAL_CHROME_PATHS = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
]

async function findLocalChrome() {
  const { existsSync } = await import('fs')
  for (const p of LOCAL_CHROME_PATHS) {
    if (existsSync(p)) return p
  }
  return null
}

let _browserPromise = null

async function launchBrowser() {
  const puppeteer = (await import('puppeteer-core')).default

  const isVercel = !!process.env.VERCEL || !!process.env.AWS_LAMBDA_FUNCTION_NAME

  if (isVercel) {
    const chromium = (await import('@sparticuz/chromium-min')).default
    const execPath = await chromium.executablePath(CHROMIUM_REMOTE_URL)
    return puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: execPath,
      headless: chromium.headless,
    })
  }

  const localPath = await findLocalChrome()
  if (!localPath) {
    throw new Error('[browserFetch] No local Chrome found — install Chrome or set CHROME_PATH')
  }
  return puppeteer.launch({
    executablePath: process.env.CHROME_PATH || localPath,
    headless: 'shell',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  })
}

async function getBrowser() {
  if (!_browserPromise) {
    _browserPromise = launchBrowser().catch((err) => {
      _browserPromise = null
      throw err
    })
  }
  return _browserPromise
}

/**
 * Close the shared browser instance (call during cleanup / after a batch).
 */
export async function closeBrowser() {
  if (!_browserPromise) return
  try {
    const browser = await _browserPromise
    await browser.close()
  } catch {
    // ignore
  } finally {
    _browserPromise = null
  }
}

/**
 * Fetch a URL with a real headless browser, returning the fully-rendered HTML.
 * Waits for network idle so Cloudflare challenges and JS-rendered content resolve.
 *
 * Returns null on any failure (timeout, crash, etc.).
 */
export async function browserFetchHtml(url, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  let page = null
  try {
    await validatePublicOutboundUrl(url)
    const browser = await getBrowser()
    page = await browser.newPage()

    let requestCount = 0
    let receivedBytes = 0
    let budgetExceeded = false

    const validateRequestUrl = async (value) => {
      const parsed = new URL(value)
      if (!['http:', 'https:'].includes(parsed.protocol)) return true
      await validatePublicOutboundUrl(parsed)
      return true
    }

    const cdp = await page.createCDPSession()
    await cdp.send('Network.enable')
    cdp.on('Network.dataReceived', ({ encodedDataLength = 0 }) => {
      receivedBytes += Number(encodedDataLength) || 0
      if (receivedBytes > MAX_BROWSER_BYTES) budgetExceeded = true
    })

    // Block images, fonts, and stylesheets to speed up load
    await page.setRequestInterception(true)
    page.on('request', async (req) => {
      const type = req.resourceType()
      requestCount += 1
      if (
        requestCount > MAX_BROWSER_REQUESTS ||
        budgetExceeded ||
        ['image', 'font', 'stylesheet', 'media', 'xhr', 'fetch', 'websocket', 'eventsource'].includes(type)
      ) {
        await req.abort().catch(() => {})
        return
      }
      try {
        await validateRequestUrl(req.url())
        await req.continue()
      } catch {
        await req.abort().catch(() => {})
      }
    })

    await page.setUserAgent(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
    )
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' })

    // Use domcontentloaded — publisher pages have heavy analytics that prevent networkidle
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs })

    if (budgetExceeded || requestCount > MAX_BROWSER_REQUESTS) {
      throw new Error('Browser fetch exceeded its network work budget.')
    }

    // Wait for article content to appear (most publishers use one of these selectors)
    try {
      await page.waitForSelector(
        'meta[name="citation_abstract"], .article-section__abstract, #abstract, article, .fulltext',
        { timeout: Math.min(timeoutMs / 2, 10000) }
      )
    } catch {
      // Selector didn't appear — still grab whatever HTML loaded
    }

    // Brief extra wait for any JS-rendered content
    await new Promise((r) => setTimeout(r, 1500))

    if (budgetExceeded || requestCount > MAX_BROWSER_REQUESTS) {
      throw new Error('Browser fetch exceeded its network work budget.')
    }
    const htmlLength = await page.evaluate(() => document.documentElement?.outerHTML?.length || 0)
    if (htmlLength > MAX_BROWSER_HTML_CHARS) {
      throw new Error('Browser page exceeded the HTML size limit.')
    }
    return await page.content()
  } catch (err) {
    console.warn(`[browserFetch] Failed for ${url} — ${err?.message || 'unknown'}`)
    return null
  } finally {
    if (page) {
      try { await page.close() } catch { /* ignore */ }
    }
  }
}
