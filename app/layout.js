import Link from 'next/link'
import { sanityFetch, queries } from '@/lib/sanity'
import AltmetricScript from './components/AltmetricScript'
import './globals.css'

export const metadata = {
  title: 'London Kidney Clinical Research',
  description: 'London Kidney Clinical Research site powered by Next.js, Sanity, and Tailwind.',
}

const navLinks = [
  { href: '/', label: 'Home' },
  { href: '/trials', label: 'Studies' },
  { href: '/team', label: 'Team' },
  { href: '/publications', label: 'Publications' },
  { href: '/contact', label: 'Contact' },
]

export default async function RootLayout({ children }) {
  const settingsRaw = await sanityFetch(queries.siteSettings)
  // Strip Sanity data to plain JSON to break any circular references
  const settings = JSON.parse(JSON.stringify(settingsRaw || {}))
  const altmetricEnabled = settings?.altmetric?.enabled === true

  return (
    <html lang="en">
      <body>
        {altmetricEnabled && <AltmetricScript />}
        <div className="min-h-screen flex flex-col">
          {/* Purple accent bar */}
          <div className="bg-purple h-10"></div>

          {/* Navigation */}
          <nav className="sticky top-0 z-50 bg-background border-b border-black/[0.06] px-6 md:px-12 py-5">
            <div className="max-w-[1400px] mx-auto flex flex-col gap-4 md:flex-row md:items-center md:justify-center md:gap-16">
              <Link href="/" className="font-bold text-base tracking-tight text-[#444]">
                {settings?.unitName || 'London Kidney Clinical Research'}
              </Link>
              <div className="flex flex-wrap gap-4 text-sm font-medium text-[#444] md:gap-8 md:text-base">
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
          <footer className="border-t border-black/[0.08] py-12 px-6 md:px-12 text-sm text-[#888] font-medium mt-6">
            <div className="max-w-[1400px] mx-auto flex flex-col sm:flex-row justify-between items-center gap-4">
              <div>© {new Date().getFullYear()}</div>
              <div className="flex gap-6">
                <Link href="/privacy" className="hover:text-purple transition-colors">Privacy</Link>
                <Link href="/accessibility" className="hover:text-purple transition-colors">Accessibility</Link>
              </div>
            </div>
          </footer>
        </div>
      </body>
    </html>
  )
}
