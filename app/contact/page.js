import Link from 'next/link'
import ContactForm from './ContactForm'
import { sanityFetch, queries } from '@/lib/sanity'

export const revalidate = 3600

const DEFAULT_OPTIONS = [
  {
    key: 'referral',
    label: 'Healthcare provider making a research or clinical referral',
    description: 'For clinical or research referrals. You will continue to our referral flow.',
    showOceanLink: true
  },
  {
    key: 'industry',
    label: 'Industry interested in partnering on research',
    description: 'Sponsors, CROs, or industry partners exploring collaboration.',
    showOceanLink: false
  },
  {
    key: 'training',
    label: 'Interested in research training opportunities',
    description: 'Fellowships, studentships, or research placements.',
    showOceanLink: false
  },
  {
    key: 'donation',
    label: 'Interested in donating to support research',
    description: 'Philanthropy or community support.',
    showOceanLink: false
  }
]

function buildPublicOptions(routing) {
  const options = routing?.options || []
  const cleaned = options
    .map((opt) => ({
      key: opt.key,
      label: opt.label,
      description: opt.description,
      showOceanLink: Boolean(opt.showOceanLink),
      oceanUrl: opt.oceanUrl || '',
      messagePlaceholder: opt.messagePlaceholder || '',
      successMessage: opt.successMessage || ''
    }))
    .filter((opt) => opt.key && opt.label)

  if (cleaned.length) return cleaned
  return DEFAULT_OPTIONS
}

export default async function ContactPage() {
  const [settingsRaw, referralRaw, routingRaw, locationsRaw] = await Promise.all([
    sanityFetch(queries.siteSettings),
    sanityFetch(queries.referralInfo),
    sanityFetch(queries.contactRouting),
    sanityFetch(queries.contactLocations)
  ])

  const settings = JSON.parse(JSON.stringify(settingsRaw || {}))
  const referral = JSON.parse(JSON.stringify(referralRaw || {}))
  const routing = JSON.parse(JSON.stringify(routingRaw || {}))
  const locationsData = JSON.parse(JSON.stringify(locationsRaw || {}))
  const referralNote = typeof referral.howToRefer === 'string' ? referral.howToRefer : ''

  const recaptchaSiteKey = process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY || ''
  const publicOptions = buildPublicOptions(routing)

  const locations = (locationsData?.locations || []).filter((loc) => loc?.name)

  return (
    <main className="max-w-[1400px] mx-auto px-6 md:px-12 py-12 space-y-10">
      <header>
        <h2 className="text-sm font-semibold text-[#888] uppercase tracking-[0.08em] mb-2">
          Reach Out
        </h2>
        <h1 className="text-4xl font-bold tracking-tight">Get in touch</h1>
        <p className="text-[#666] mt-3 max-w-2xl">
          Connect with the team for referrals, research partnerships, training opportunities, or
          philanthropic support.
        </p>
      </header>

      <div className="grid gap-8 lg:grid-cols-[1.4fr_1fr]">
        <div className="space-y-6">
          <section className="space-y-4">
            <div className="space-y-1">
              <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[#888]">
                Contact form
              </p>
              <h2 className="text-2xl font-bold text-[#1a1a1a]">Tell us how we can help</h2>
              <p className="text-sm text-[#555]">
                We route messages directly based on the reason you choose. Every submission requires
                a contact email.
              </p>
            </div>
            <ContactForm options={publicOptions} recaptchaSiteKey={recaptchaSiteKey} />
          </section>
        </div>

        <aside className="space-y-4">
          <div className="space-y-2">
            <h3 className="text-xl font-bold text-[#1a1a1a]">Locations</h3>
          </div>
          <section className="grid gap-4">
            {locations.map((loc, idx) => (
              <div key={`${loc.name}-${idx}`} className="p-5 bg-white border border-black/[0.06] space-y-2">
                <p className="text-sm font-semibold text-[#1a1a1a]">{loc.name}</p>
                {loc.address && <p className="text-sm text-[#555] whitespace-pre-line">{loc.address}</p>}
                <div className="flex flex-col gap-1 text-sm">
                  {loc.phone && (
                    <p>
                      <span className="text-[#555]">Phone: </span>
                      <a className="text-purple font-semibold hover:underline" href={`tel:${loc.phone}`}>
                        {loc.phone}
                      </a>
                    </p>
                  )}
                  {loc.fax && (
                    <p>
                      <span className="text-[#555]">Fax: </span>
                      <span className="text-[#555]">{loc.fax}</span>
                    </p>
                  )}
                  {loc.email && (
                    <a className="text-purple font-semibold hover:underline" href={`mailto:${loc.email}`}>
                      {loc.email}
                    </a>
                  )}
                </div>
                {loc.note && <p className="text-xs text-[#777]">{loc.note}</p>}
                {loc.mapUrl && (
                  <a
                    className="inline-flex text-xs font-semibold text-purple hover:underline"
                    href={loc.mapUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    View map / directions
                  </a>
                )}
              </div>
            ))}
            {!locations.length && (
              <div className="p-5 bg-white border border-black/[0.06]">
                <p className="text-sm text-[#666]">Add locations in Sanity to show them here.</p>
              </div>
            )}
          </section>
        </aside>
      </div>
    </main>
  )
}
