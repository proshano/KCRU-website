import { Suspense } from 'react'
import { ROLE_OPTIONS, SPECIALTY_OPTIONS, INTEREST_AREA_OPTIONS, CORRESPONDENCE_OPTIONS } from '@/lib/communicationOptions'
import ManagePreferencesClient from './ManagePreferencesClient'

export const revalidate = 3600

export default async function ManageUpdatesPage() {
  return (
    <main className="max-w-[1000px] mx-auto px-6 md:px-12 py-12">
      <Suspense fallback={<div className="bg-white border border-black/[0.06] p-6 shadow-sm animate-pulse h-64" />}>
        <ManagePreferencesClient
          roleOptions={ROLE_OPTIONS}
          specialtyOptions={SPECIALTY_OPTIONS}
          interestAreaOptions={INTEREST_AREA_OPTIONS}
          correspondenceOptions={CORRESPONDENCE_OPTIONS}
        />
      </Suspense>
    </main>
  )
}
