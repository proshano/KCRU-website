/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
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
