import Link from 'next/link'
import { sanityFetch, queries } from '@/lib/sanity'
import './globals.css'

export const metadata = {
  title: 'London Kidney Clinical Trials',
  description: 'London Kidney Clinical Trials site powered by Next.js, Sanity, and Tailwind.',
}

const navLinks = [
  { href: '/trials', label: 'Studies' },
  { href: '/team', label: 'Investigators' },
  { href: '/publications', label: 'Publications' },
  { href: '/capabilities', label: 'Capabilities' },
  { href: '/news', label: 'News' },
  { href: '/contact', label: 'Contact' },
]

export default async function RootLayout({ children }) {
  const settingsRaw = await sanityFetch(queries.siteSettings)
  // Strip Sanity data to plain JSON to break any circular references
  const settings = JSON.parse(JSON.stringify(settingsRaw || {}))
  const affiliations = settings?.affiliations || []

  return (
    <html lang="en">
      <body>
        <div className="min-h-screen flex flex-col">
          {/* Institutional bar */}
          {affiliations.length > 0 && (
            <div className="bg-purple py-2.5 px-6 md:px-12 flex flex-wrap gap-x-6 gap-y-1 text-xs font-medium tracking-wide text-white/90">
              {affiliations.map((aff, idx) => (
                <span key={aff._key || aff.name || idx} className="flex items-center gap-2">
                  {idx > 0 && <span className="opacity-50 hidden sm:inline">•</span>}
                  {aff.url ? (
                    <Link href={aff.url} className="hover:text-white transition-colors">
                      {aff.name}
                    </Link>
                  ) : (
                    <span>{aff.name}</span>
                  )}
                </span>
              ))}
            </div>
          )}

          {/* Navigation */}
          <nav className="sticky top-0 z-50 bg-background border-b border-black/[0.06] px-6 md:px-12 py-5">
            <div className="max-w-[1400px] mx-auto flex justify-between items-center">
              <Link href="/" className="font-bold text-base tracking-tight">
                {settings?.unitName || 'London Kidney Clinical Research'}
              </Link>
              <div className="hidden md:flex gap-9 text-sm font-medium text-[#444]">
                {navLinks.map((link) => (
                  <Link
                    key={link.href}
                    href={link.href}
                    className="nav-link"
                  >
                    {link.label}
                  </Link>
                ))}
              </div>
            </div>
          </nav>

          {/* Main content */}
          <main className="flex-1">{children}</main>

          {/* Footer */}
          <footer className="border-t border-black/[0.08] py-12 px-6 md:px-12 text-sm text-[#888] font-medium mt-12">
            <div className="max-w-[1400px] mx-auto flex flex-col sm:flex-row justify-between items-center gap-4">
              <div>
                © {new Date().getFullYear()} {settings?.unitName || 'London Kidney Clinical Research'}
                {affiliations.length > 0 && (
                  <span className="hidden sm:inline">
                    {' · '}
                    {affiliations.map((aff) => aff.name).join(' · ')}
                  </span>
                )}
              </div>
              <div className="flex gap-6">
                <Link href="/contact" className="hover:text-purple transition-colors">Privacy</Link>
                <Link href="/contact" className="hover:text-purple transition-colors">Accessibility</Link>
                <Link href="/contact" className="hover:text-purple transition-colors">Contact</Link>
              </div>
            </div>
          </footer>
        </div>
      </body>
    </html>
  )
}
