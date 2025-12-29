import { ROLE_OPTIONS, SPECIALTY_OPTIONS, INTEREST_AREA_OPTIONS } from '@/lib/communicationOptions'
import UpdatesSignupForm from './UpdatesSignupForm'

export const revalidate = 3600

export default async function UpdatesPage() {
  const recaptchaSiteKey = process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY || ''

  return (
    <main className="max-w-[1200px] mx-auto px-6 md:px-12 py-12">
      <div className="grid gap-10 lg:grid-cols-[1.4fr_0.9fr]">
        <div className="space-y-6">
          <div className="space-y-3">
            <h1 className="text-4xl font-bold tracking-tight">Subscribe for updates</h1>
            <p className="text-[#666]">
              Share your role, specialty, and interest areas so we can send updates about active studies. You can
              unsubscribe or change your preferences at any time.
            </p>
          </div>
          <UpdatesSignupForm
            roleOptions={ROLE_OPTIONS}
            specialtyOptions={SPECIALTY_OPTIONS}
            interestAreaOptions={INTEREST_AREA_OPTIONS}
            recaptchaSiteKey={recaptchaSiteKey}
          />
        </div>

        <aside className="space-y-4">
          <div className="p-6 bg-white border border-black/[0.06] space-y-3">
            <h2 className="text-xl font-semibold">What you can expect</h2>
            <ul className="space-y-2 text-sm text-[#555]">
              <li>Study updates aligned to your role, specialty, and interest areas.</li>
              <li>Publication summaries when new research is published.</li>
              <li>Occasional reminders about trials that are actively recruiting.</li>
            </ul>
          </div>
          <div className="p-6 bg-white border border-black/[0.06] space-y-2 text-sm text-[#555]">
            <h3 className="text-base font-semibold text-[#222]">Privacy note</h3>
            <p>
              We only use your details to share study and publication updates. Unsubscribe anytime using the link in
              each email or your preference page.
            </p>
          </div>
        </aside>
      </div>
    </main>
  )
}
