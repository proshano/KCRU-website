import { revalidatePath } from 'next/cache'

// The study pages are statically regenerated on long windows (/trials every 30
// minutes, a study page every 12 hours). Call this after any write that changes
// a study so an approval or direct publish shows up right away.
export function revalidateStudyPages(slug) {
  revalidatePath('/')
  revalidatePath('/trials')
  const cleaned = String(slug || '').trim()
  if (cleaned) revalidatePath(`/trials/${cleaned}`)
}
