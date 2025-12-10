import Link from 'next/link'
import { sanityFetch, queries } from '@/lib/sanity'

export const revalidate = 3600

export default async function ContactPage() {
  const settingsRaw = (await sanityFetch(queries.siteSettings)) || {}
  const referralRaw = (await sanityFetch(queries.referralInfo)) || {}
  // Strip Sanity data to plain JSON to break any circular references
  const settings = JSON.parse(JSON.stringify(settingsRaw))
  const referral = JSON.parse(JSON.stringify(referralRaw))

  const contacts = [
    settings.contactEmail && { label: 'General inquiries', value: 'Send email', href: `mailto:${settings.contactEmail}` },
    settings.phone && { label: 'Phone', value: settings.phone, href: `tel:${settings.phone}` },
    referral.referralPhone && { label: 'Referral phone', value: referral.referralPhone, href: `tel:${referral.referralPhone}` },
    referral.referralFax && { label: 'Referral fax', value: referral.referralFax },
    referral.referralEmail && { label: 'Referral inquiries', value: 'Send email', href: `mailto:${referral.referralEmail}` },
  ].filter(Boolean)

  return (
    <main className="max-w-[1400px] mx-auto px-6 md:px-12 py-12 space-y-10">
      <header>
        <h2 className="text-sm font-semibold text-[#888] uppercase tracking-[0.08em] mb-2">
          Reach Out
        </h2>
        <h1 className="text-4xl font-bold tracking-tight">Get in touch</h1>
        <p className="text-[#666] mt-3 max-w-2xl">
          Reach the team for collaborations, study referrals, or general inquiries.
        </p>
      </header>

      <section className="grid gap-5 sm:grid-cols-2 md:grid-cols-3">
        {contacts.map((item) => (
          <div key={`${item.label}-${item.value}`} className="p-5 bg-white border border-black/[0.06]">
            <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[#888]">{item.label}</p>
            {item.href ? (
              <a className="mt-2 block text-base font-semibold text-purple hover:underline" href={item.href}>
                {item.value}
              </a>
            ) : (
              <p className="mt-2 text-base font-semibold text-[#1a1a1a]">{item.value}</p>
            )}
          </div>
        ))}
      </section>

      <section className="p-6 bg-gradient-to-br from-[#F5F3F0] to-[#EEEBE6] space-y-4">
        <h2 className="text-lg font-bold text-[#1a1a1a]">Refer a patient to a study</h2>
        <p className="text-sm text-[#666]">
          Use the referral contact details above or send the referral form if provided below.
        </p>
        <div className="flex flex-wrap gap-3">
          {referral.referralFormUrl && (
            <Link className="btn-primary" href={referral.referralFormUrl}>
              Referral form (link)
            </Link>
          )}
          {referral.referralFormFile && (
            <Link className="btn-secondary" href={referral.referralFormFile}>
              Download referral form
            </Link>
          )}
          {referral.howToRefer && (
            <span className="px-4 py-3 bg-white border border-black/[0.06] text-sm text-[#666]">
              {referral.howToRefer}
            </span>
          )}
        </div>
        {(referral.geographicArea || referral.urgentReferrals) && (
          <div className="text-sm text-[#666] space-y-1 pt-2">
            {referral.geographicArea && <p><span className="font-semibold text-[#1a1a1a]">Geographic area:</span> {referral.geographicArea}</p>}
            {referral.urgentReferrals && <p><span className="font-semibold text-[#1a1a1a]">Urgent referrals:</span> {referral.urgentReferrals}</p>}
          </div>
        )}
      </section>
    </main>
  )
}
