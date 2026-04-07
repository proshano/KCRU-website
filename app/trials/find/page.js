import Link from 'next/link'

import { sanityFetch, queries } from '@/lib/sanity'
import { buildOpenGraph, buildTwitterMetadata, normalizeDescription, resolveSiteTitle } from '@/lib/seo'
import { isTrialMatchingAssistantEnabled } from '@/lib/trialMatchingSettings'

export const revalidate = 1800

export async function generateMetadata() {
  const settingsRaw = await sanityFetch(queries.siteSettings)
  const settings = JSON.parse(JSON.stringify(settingsRaw || {}))
  const siteTitle = resolveSiteTitle(settings)
  const title = 'Trial Matching Assistant'
  const description = normalizeDescription(
    `Answer a few non-identifying questions to explore studies from ${siteTitle} that may fit a patient's characteristics. This tool does not determine final eligibility.`
  )
  const canonical = '/trials/find'

  return {
    title,
    description,
    robots: {
      index: false,
      follow: true,
    },
    alternates: {
      canonical,
    },
    openGraph: buildOpenGraph({
      settings,
      title,
      description,
      path: canonical,
    }),
    twitter: buildTwitterMetadata({
      settings,
      title,
      description,
    }),
  }
}

export default async function TrialMatchingAssistantPage() {
  const [settingsRaw, studiesRaw] = await Promise.all([
    sanityFetch(queries.siteSettings),
    sanityFetch(queries.trialMatchingStudies),
  ])
  const settings = JSON.parse(JSON.stringify(settingsRaw || {}))
  const isTrialMatchingEnabled = isTrialMatchingAssistantEnabled(settings)
  const studies = Array.isArray(studiesRaw) ? JSON.parse(JSON.stringify(studiesRaw)) : []
  const studyCount = studies.length

  return (
    <main className="max-w-[1400px] mx-auto px-6 md:px-12 py-12 space-y-8">
      <div className="space-y-3">
        <Link href="/trials" prefetch={false} className="text-sm text-gray-500 hover:text-purple transition">
          ← Back to all studies
        </Link>
        <p className="text-sm font-semibold text-purple uppercase tracking-wide">Clinical Research</p>
        <h1 className="text-4xl md:text-5xl font-bold tracking-tight">Trial Matching Assistant</h1>
        <p className="text-lg text-gray-600 max-w-3xl">
          Share non-identifying patient characteristics in a chat-style flow to narrow down possible studies. This tool
          offers high-level guidance only and does not determine final eligibility.
        </p>
        {isTrialMatchingEnabled ? (
          <p className="text-sm text-gray-500">
            Currently covering {studyCount} actively recruiting {studyCount === 1 ? 'study' : 'studies'}.
          </p>
        ) : (
          <p className="text-sm text-gray-500">
            The trial conversational assistant is currently turned off in site settings.
          </p>
        )}
      </div>

      {isTrialMatchingEnabled ? (
        <section className="bg-white border border-black/5 rounded-xl p-6 shadow-sm space-y-4">
          <h2 className="text-xl font-semibold">Use The Floating Assistant</h2>
          <p className="text-sm text-gray-700">
            The trial assistant now appears in the bottom-right corner across public pages and can be minimized while
            you browse. On the homepage it opens automatically to invite the first question.
          </p>
          <p className="text-sm text-gray-700">
            It currently searches across {studyCount} actively recruiting {studyCount === 1 ? 'study' : 'studies'} and
            keeps the conversation available as you move between pages.
          </p>
          <div className="flex flex-wrap items-center gap-4">
            <Link href="/" prefetch={false} className="inline-flex text-sm font-medium text-purple hover:text-purple/80">
              Go to homepage
            </Link>
            <Link href="/trials" prefetch={false} className="inline-flex text-sm font-medium text-purple hover:text-purple/80">
              Browse studies
            </Link>
          </div>
        </section>
      ) : (
        <section className="bg-white border border-black/5 rounded-xl p-6 shadow-sm space-y-3">
          <h2 className="text-xl font-semibold">Assistant Unavailable</h2>
          <p className="text-sm text-gray-700">
            The public trial conversational assistant is disabled right now. You can still browse the actively
            recruiting studies on the main studies page.
          </p>
          <Link href="/trials" prefetch={false} className="inline-flex text-sm font-medium text-purple hover:text-purple/80">
            View recruiting studies
          </Link>
        </section>
      )}
    </main>
  )
}
