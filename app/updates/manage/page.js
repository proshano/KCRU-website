import { Suspense } from 'react'
import { ROLE_OPTIONS, SPECIALTY_OPTIONS, CORRESPONDENCE_OPTIONS } from '@/lib/communicationOptions'
import { buildTherapeuticAreaOptions, fetchTherapeuticAreas } from '@/lib/therapeuticAreas'
import ManagePreferencesClient from './ManagePreferencesClient'

export const revalidate = 3600

export default async function ManageUpdatesPage() {
  const areas = await fetchTherapeuticAreas()
  const interestAreaOptions = buildTherapeuticAreaOptions(areas)

  return (
    <main className="max-w-[1000px] mx-auto px-6 md:px-12 py-12">
      <Suspense fallback={<div className="bg-white border border-black/[0.06] p-6 shadow-sm animate-pulse h-64" />}>
        <ManagePreferencesClient
          roleOptions={ROLE_OPTIONS}
          specialtyOptions={SPECIALTY_OPTIONS}
          interestAreaOptions={interestAreaOptions}
          correspondenceOptions={CORRESPONDENCE_OPTIONS}
        />
      </Suspense>
    </main>
  )
}
