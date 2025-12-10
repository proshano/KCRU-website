import Image from 'next/image'
import Link from 'next/link'
import { sanityFetch, queries, urlFor } from '@/lib/sanity'

export const revalidate = 3600 // 1 hour

export default async function TeamPage() {
  const researchersRaw = await sanityFetch(queries.allResearchers)
  // Strip Sanity data to plain JSON to break any circular references
  const researchers = JSON.parse(JSON.stringify(researchersRaw || []))

  return (
    <main className="max-w-[1400px] mx-auto px-6 md:px-12 py-12 space-y-8">
      <header className="flex justify-between items-center">
        <div>
          <h2 className="text-sm font-semibold text-[#888] uppercase tracking-[0.08em] mb-2">
            Our Team
          </h2>
          <h1 className="text-4xl font-bold tracking-tight">Investigators</h1>
        </div>
      </header>

      {(!researchers || researchers.length === 0) && (
        <p className="text-[#666]">No team members found yet.</p>
      )}

      <div className="grid gap-5 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4">
        {researchers?.map((person) => {
          const slugValue = typeof person.slug === 'string' ? person.slug : person.slug?.current
          const href = slugValue ? `/team/${slugValue}` : null
          const initials = person.name
            ?.split(' ')
            .map(n => n[0])
            .join('')
            .slice(0, 2)
            .toUpperCase() || '?'

          const cardBody = (
            <div className="team-member">
              <div
                className="team-photo mx-auto"
                style={{ width: '105px', height: '105px' }}
              >
                {person.photo ? (
                  <Image
                    src={urlFor(person.photo).width(132).height(132).fit('crop').url()}
                    alt={person.name || 'Researcher'}
                    width={132}
                    height={132}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <span className="text-[24px] font-semibold text-[#aaa]">{initials}</span>
                )}
              </div>
              <div className="text-sm font-semibold text-[#1a1a1a]">
                {person.name}
              </div>
              <div className="text-xs text-[#888] mt-0.5 font-medium">
                {person.role || 'Researcher'}
              </div>
              {person.bio && (
                <p className="text-xs text-[#666] mt-2 line-clamp-2 text-left">{person.bio}</p>
              )}
            </div>
          )

          const social = <SocialLinks key={`${person._id}-social`} person={person} />

          return href ? (
            <div key={person._id} className="flex flex-col">
              <Link href={href}>{cardBody}</Link>
              {social}
            </div>
          ) : (
            <div key={person._id} className="flex flex-col">
              {cardBody}
              {social}
            </div>
          )
        })}
      </div>
    </main>
  )
}

function SocialLinks({ person }) {
  const hasLinks = person.twitter || person.linkedin || person.orcid
  if (!hasLinks) return null
  return (
    <div className="flex flex-wrap gap-2 mt-2 text-xs text-purple font-medium">
      {person.twitter && (
        <a
          href={`https://twitter.com/${person.twitter.replace('@', '')}`}
          target="_blank"
          rel="noopener noreferrer"
          className="hover:underline"
        >
          X
        </a>
      )}
      {person.linkedin && (
        <a
          href={person.linkedin}
          target="_blank"
          rel="noopener noreferrer"
          className="hover:underline"
        >
          LinkedIn
        </a>
      )}
      {person.orcid && (
        <a
          href={`https://orcid.org/${person.orcid.replace('https://orcid.org/', '')}`}
          target="_blank"
          rel="noopener noreferrer"
          className="hover:underline"
        >
          ORCID
        </a>
      )}
    </div>
  )
}
