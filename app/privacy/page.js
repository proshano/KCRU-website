import { sanityFetch, queries } from '@/lib/sanity'

export const revalidate = 3600

export default async function PrivacyPage() {
  const settingsRaw = (await sanityFetch(queries.siteSettings)) || {}
  const settings = JSON.parse(JSON.stringify(settingsRaw))

  const orgName = settings?.unitName || 'London Kidney Clinical Trials'
  const contactEmail = settings?.contactEmail
  const phone = settings?.phone

  return (
    <main className="max-w-[1400px] mx-auto px-6 md:px-12 py-12 space-y-10">
      <header className="space-y-3">
        <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[#888]">Privacy</p>
        <h1 className="text-4xl font-bold tracking-tight">How we protect your information</h1>
        <p className="text-[#555] max-w-3xl">
          We are committed to protecting personal health information in line with Ontario&apos;s
          Personal Health Information Protection Act (PHIPA) and applicable federal privacy
          requirements. This statement explains what we collect on this website, why we collect it,
          and how you can reach us with questions.
        </p>
      </header>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold text-[#1a1a1a]">What we collect</h2>
        <ul className="list-disc list-inside space-y-2 text-[#555]">
          <li>Details you choose to provide in referral forms or emails (e.g., contact information and clinical context needed to coordinate a study referral).</li>
          <li>Technical information automatically sent by your browser (IP address, device type, and basic usage logs) that helps us keep the site secure and reliable.</li>
          <li>Minimal, essential cookies and similar technologies required to deliver the site and protect against fraud or abuse.</li>
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold text-[#1a1a1a]">How we use and share information</h2>
        <ul className="list-disc list-inside space-y-2 text-[#555]">
          <li>To respond to inquiries and coordinate study referrals or collaborations.</li>
          <li>To maintain site security, measure availability, and improve usability.</li>
          <li>To meet legal or regulatory requirements when we are required to do so.</li>
        </ul>
        <p className="text-[#555]">
          We do not sell personal information. Access to referral or contact details is restricted to
          team members who need it for clinical research coordination. When service providers help us
          operate the site, they must protect the information they handle and use it only for our
          purposes.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold text-[#1a1a1a]">Storage and retention</h2>
        <p className="text-[#555]">
          Information is retained only as long as necessary to fulfill the purpose for which it was
          collected or to meet legal obligations. Administrative and security logs are kept for a
          limited period to monitor performance and protect against misuse.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold text-[#1a1a1a]">Your choices</h2>
        <ul className="list-disc list-inside space-y-2 text-[#555]">
          <li>You may decline optional cookies through your browser settings; essential cookies are necessary for basic site functionality.</li>
          <li>You can ask us to update or correct contact details you have provided.</li>
          <li>You may withdraw consent for non-essential uses, subject to legal or clinical research obligations.</li>
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold text-[#1a1a1a]">Contact us</h2>
        <p className="text-[#555]">
          If you have questions about this statement, need to request an accommodation, or want to
          exercise a privacy right under PHIPA or applicable law, please reach out:
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
    </main>
  )
}
