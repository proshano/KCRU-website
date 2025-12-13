import { sanityFetch, queries } from '@/lib/sanity'
import TrialsClient from './TrialsClient'

// Revalidate every 12 hours
export const revalidate = 43200

export const metadata = {
  title: 'Clinical Studies | KCRU',
  description: 'Find kidney research studies currently recruiting participants at our sites.',
}

export default async function TrialsPage({ searchParams }) {
  // In Next.js 15+, searchParams is a Promise
  const params = await searchParams
  
  const [trialsRaw, areasRaw] = await Promise.all([
    sanityFetch(queries.trialSummaries),
    sanityFetch(queries.therapeuticAreas)
  ])
  
  const allTrials = JSON.parse(JSON.stringify(trialsRaw || []))
  const areas = JSON.parse(JSON.stringify(areasRaw || []))

  // Get selected area filter from URL
  const selectedArea = params?.area || null

  return (
    <main className="max-w-[1400px] mx-auto px-6 md:px-12 py-12">
      {/* Header */}
      <header className="mb-10">
        <p className="text-sm font-semibold text-purple uppercase tracking-wide mb-2">
          Clinical Research
        </p>
        <h1 className="text-4xl md:text-5xl font-bold tracking-tight mb-4">
          Active Studies
        </h1>
        <p className="text-lg text-gray-600 max-w-2xl">
          The details on this site are oriented to healthcare providers. 
          Please contact us if you have questions about eligibility for your patients.
        </p>
      </header>

      {/* Client-side interactive content with search */}
      <TrialsClient 
        allTrials={allTrials} 
        areas={areas} 
        selectedArea={selectedArea} 
      />
    </main>
  )
}
