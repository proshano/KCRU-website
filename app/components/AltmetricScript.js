'use client'

import Script from 'next/script'
import { useEffect } from 'react'
import { usePathname } from 'next/navigation'

/**
 * Altmetric embed script loader with automatic reinitialization on route changes.
 * This ensures badges render correctly on client-side navigation in Next.js.
 */
export default function AltmetricScript() {
  const pathname = usePathname()

  // Reinitialize Altmetric badges when the route changes
  useEffect(() => {
    // Small delay to ensure DOM has updated with new badge elements
    const timer = setTimeout(() => {
      if (typeof window !== 'undefined' && window._altmetric_embed_init) {
        window._altmetric_embed_init()
      }
    }, 100)

    return () => clearTimeout(timer)
  }, [pathname])

  return (
    <Script
      src="https://d1bxh8uas1mnw7.cloudfront.net/assets/embed.js"
      strategy="lazyOnload"
      onLoad={() => {
        // Initialize immediately after script loads
        if (typeof window !== 'undefined' && window._altmetric_embed_init) {
          window._altmetric_embed_init()
        }
      }}
    />
  )
}
