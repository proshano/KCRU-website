import Image from 'next/image'
import Link from 'next/link'
import { sanityFetch, queries, urlFor } from '@/lib/sanity'

export const revalidate = 3600 // 1 hour

export default async function TeamPage() {
  const researchers = await sanityFetch(queries.allResearchers)

  return (
    <main className="max-w-6xl mx-auto px-4 py-10 space-y-6">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold text-gray-900">Investigators</h1>
      </header>

      {(!researchers || researchers.length === 0) && (
        <p className="text-gray-500">No team members found yet.</p>
      )}

      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {researchers?.map((person) => (
          <article key={person._id} className="rounded-lg border border-gray-200 bg-white shadow-sm p-4 space-y-3">
            {person.slug?.current ? (
              <div className="space-y-3">
                <Link
                  href={`/team/${person.slug.current}`}
                  className="group block space-y-3 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 rounded-lg"
                >
                  <CardContent person={person} />
                </Link>
                <SocialLinks person={person} />
              </div>
            ) : (
              <div className="space-y-3">
                <CardContent person={person} />
                <SocialLinks person={person} />
              </div>
            )}
          </article>
        ))}
      </div>
    </main>
  )
}

function CardContent({ person }) {
  return (
    <>
      <div className="flex items-center gap-3">
        <Avatar photo={person.photo} name={person.name} />
        <div>
          <h2 className="text-lg font-semibold text-gray-900 group-hover:text-blue-700">{person.name}</h2>
          {person.role && <p className="text-sm text-gray-600">{person.role}</p>}
        </div>
      </div>
      {person.bio && <p className="text-sm text-gray-700 line-clamp-3">{person.bio}</p>}
    </>
  )
}

function SocialLinks({ person }) {
  const hasLinks = person.twitter || person.linkedin || person.orcid
  if (!hasLinks) return null
  return (
    <div className="flex flex-wrap gap-3 text-sm text-blue-700">
      {person.twitter && (
        <a href={`https://twitter.com/${person.twitter.replace('@', '')}`} target="_blank" rel="noopener noreferrer" className="hover:underline">
          X / Twitter
        </a>
      )}
      {person.linkedin && (
        <a href={person.linkedin} target="_blank" rel="noopener noreferrer" className="hover:underline">
          LinkedIn
        </a>
      )}
      {person.orcid && (
        <a href={`https://orcid.org/${person.orcid.replace('https://orcid.org/', '')}`} target="_blank" rel="noopener noreferrer" className="hover:underline">
          ORCID
        </a>
      )}
    </div>
  )
}

function Avatar({ photo, name }) {
  if (photo) {
    const src = urlFor(photo).width(120).height(120).fit('crop').url()
    return (
      <Image
        src={src}
        alt={name}
        width={56}
        height={56}
        className="h-14 w-14 rounded-full object-cover"
      />
    )
  }
  return (
    <div className="h-14 w-14 rounded-full bg-gray-200 flex items-center justify-center text-gray-600 text-sm font-semibold">
      {name?.slice(0, 2)?.toUpperCase() || '?'}
    </div>
  )
}

