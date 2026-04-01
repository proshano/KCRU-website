import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ['puppeteer-core', '@sparticuz/chromium-min'],
  turbopack: {
    root: __dirname
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'cdn.sanity.io'
      }
    ]
  },
  async rewrites() {
    return [
      {
        source: '/:path*.md',
        destination: '/markdown/:path*'
      }
    ]
  }
}

export default nextConfig
