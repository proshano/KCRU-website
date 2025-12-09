import Link from 'next/link'
import { sanityFetch, queries } from '@/lib/sanity'

export const revalidate = 3600

export default async function ContactPage() {
  const settings = (await sanityFetch(queries.siteSettings)) || {}
  const referral = (await sanityFetch(queries.referralInfo)) || {}

  const contacts = [
    settings.contactEmail && { label: 'Email', value: settings.contactEmail, href: `mailto:${settings.contactEmail}` },
    settings.phone && { label: 'Phone', value: settings.phone, href: `tel:${settings.phone}` },
    referral.referralPhone && { label: 'Referral phone', value: referral.referralPhone, href: `tel:${referral.referralPhone}` },
    referral.referralFax && { label: 'Referral fax', value: referral.referralFax },
    referral.referralEmail && { label: 'Referral email', value: referral.referralEmail, href: `mailto:${referral.referralEmail}` },
  ].filter(Boolean)

  return (
    <main className="mx-auto max-w-4xl space-y-10 px-6 py-10">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold text-slate-900">Get in touch</h1>
        <p className="text-slate-700">
          Reach the team for collaborations, study referrals, or general inquiries.
        </p>
      </header>

      <section className="grid gap-4 md:grid-cols-2">
        {contacts.map((item) => (
          <div key={`${item.label}-${item.value}`} className="rounded-2xl bg-white px-4 py-4 ring-1 ring-slate-200">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{item.label}</p>
            {item.href ? (
              <a className="mt-1 block text-sm font-semibold text-blue-700" href={item.href}>
                {item.value}
              </a>
            ) : (
              <p className="mt-1 text-sm font-semibold text-slate-900">{item.value}</p>
            )}
          </div>
        ))}
      </section>

      <section className="space-y-3 rounded-2xl bg-slate-50 px-5 py-5 ring-1 ring-slate-200">
        <h2 className="text-lg font-semibold text-slate-900">Refer a patient to a study</h2>
        <p className="text-sm text-slate-700">
          Use the referral contact details above or send the referral form if provided below.
        </p>
        <div className="flex flex-wrap gap-3 text-sm font-semibold text-blue-700">
          {referral.referralFormUrl && (
            <Link className="rounded-full bg-white px-3 py-1 ring-1 ring-blue-100" href={referral.referralFormUrl}>
              Referral form (link)
            </Link>
          )}
          {referral.referralFormFile && (
            <Link className="rounded-full bg-white px-3 py-1 ring-1 ring-blue-100" href={referral.referralFormFile}>
              Download referral form
            </Link>
          )}
          {referral.howToRefer && (
            <span className="rounded-full bg-white px-3 py-1 ring-1 ring-slate-200 text-slate-700">
              {referral.howToRefer}
            </span>
          )}
        </div>
        {(referral.geographicArea || referral.urgentReferrals) && (
          <div className="text-sm text-slate-700 space-y-1">
            {referral.geographicArea && <p>Geographic area: {referral.geographicArea}</p>}
            {referral.urgentReferrals && <p>Urgent referrals: {referral.urgentReferrals}</p>}
          </div>
        )}
      </section>
    </main>
  )
}
