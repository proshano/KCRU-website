import Link from 'next/link'
import './globals.css'

export const metadata = {
  title: 'London Kidney Clinical Trials',
  description: 'London Kidney Clinical Trials site powered by Next.js, Sanity, and Tailwind.',
}

const navLinks = [
  { href: '/', label: 'Home' },
  { href: '/trials', label: 'Studies' },
  { href: '/team', label: 'Investigators' },
  { href: '/publications', label: 'Publications' },
  { href: '/news', label: 'News' },
  { href: '/capabilities', label: 'Capabilities' },
  { href: '/contact', label: 'Contact' },
]

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className="bg-slate-50 text-gray-900 antialiased">
        <div className="min-h-screen">
          <header className="border-b border-slate-200/80 bg-white/80 backdrop-blur">
            <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4">
              <Link href="/" aria-label="Home" className="flex items-center gap-2 text-blue-700">
                <span className="sr-only">Home</span>
                <span className="h-2.5 w-2.5 rounded-full bg-blue-700" aria-hidden />
              </Link>
              <nav className="flex flex-wrap items-center gap-5 text-sm font-semibold text-slate-700 tracking-tight">
                {navLinks.map((link) => (
                  <Link
                    key={link.href}
                    href={link.href}
                    className="transition hover:text-blue-700 hover:underline decoration-2 underline-offset-4"
                  >
                    {link.label}
                  </Link>
                ))}
              </nav>
            </div>
          </header>

          <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>

          <footer className="border-t border-gray-200 bg-white py-6">
            <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 text-sm text-gray-600 tracking-tight">
              <span>© {new Date().getFullYear()} Pavel Roshanov</span>
              <div className="flex gap-3">
                <Link href="/trials" className="hover:text-blue-700">Trials</Link>
                <Link href="/team" className="hover:text-blue-700">Investigators</Link>
                <Link href="/publications" className="hover:text-blue-700">Publications</Link>
                <Link href="/news" className="hover:text-blue-700">News</Link>
                <Link href="/capabilities" className="hover:text-blue-700">Capabilities</Link>
                <Link href="/contact" className="hover:text-blue-700">Contact</Link>
              </div>
            </div>
          </footer>
        </div>
      </body>
    </html>
  )
}

