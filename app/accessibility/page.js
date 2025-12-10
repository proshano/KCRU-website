import { sanityFetch, queries } from '@/lib/sanity'

export const revalidate = 3600

export default async function AccessibilityPage() {
  const settingsRaw = (await sanityFetch(queries.siteSettings)) || {}
  const settings = JSON.parse(JSON.stringify(settingsRaw))

  const orgName = settings?.unitName || 'London Kidney Clinical Trials'
  const contactEmail = settings?.contactEmail
  const phone = settings?.phone

  return (
    <main className="max-w-[1400px] mx-auto px-6 md:px-12 py-12 space-y-10">
      <header className="space-y-3">
        <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[#888]">Accessibility</p>
        <h1 className="text-4xl font-bold tracking-tight">Our commitment to accessibility</h1>
        <p className="text-[#555] max-w-3xl">
          We aim to provide an accessible experience for everyone who uses this site. Our approach
          is guided by the Accessibility for Ontarians with Disabilities Act (AODA) and the Web
          Content Accessibility Guidelines (WCAG) 2.1.
        </p>
      </header>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold text-[#1a1a1a]">What we are doing</h2>
        <ul className="list-disc list-inside space-y-2 text-[#555]">
          <li>Using clear headings, descriptive link text, and semantic HTML to support screen readers.</li>
          <li>Maintaining color contrast and scalable text to support low-vision users.</li>
          <li>Supporting keyboard navigation and visible focus states on interactive elements.</li>
          <li>Testing new features for accessibility considerations before release.</li>
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold text-[#1a1a1a]">Requesting accommodations</h2>
        <p className="text-[#555]">
          If you need information in another format or experience a barrier while using the site,
          we will work with you to provide an accessible alternative as quickly as possible.
          Please include any helpful details, such as the page you were visiting and the assistive
          technology you use.
        </p>
        <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3 text-[#1a1a1a]">
          {contactEmail && (
            <div className="p-4 bg-white border border-black/[0.06]">
              <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[#888]">Email</p>
              <a className="mt-1 block font-semibold text-purple hover:underline" href={`mailto:${contactEmail}`}>
                {contactEmail}
              </a>
            </div>
          )}
          {phone && (
            <div className="p-4 bg-white border border-black/[0.06]">
              <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[#888]">Phone</p>
              <a className="mt-1 block font-semibold text-purple hover:underline" href={`tel:${phone}`}>
                {phone}
              </a>
            </div>
          )}
          <div className="p-4 bg-white border border-black/[0.06]">
            <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[#888]">Organization</p>
            <p className="mt-1 font-semibold text-[#1a1a1a]">{orgName}</p>
            <p className="text-[#777] text-sm mt-1">Ontario, Canada</p>
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold text-[#1a1a1a]">Feedback and improvements</h2>
        <p className="text-[#555]">
          We review accessibility feedback promptly and use it to prioritize improvements. If a
          barrier cannot be removed immediately, we will propose an alternative way to access the
          information or service.
        </p>
      </section>
    </main>
  )
}
