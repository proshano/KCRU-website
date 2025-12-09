import Image from 'next/image'
import Link from 'next/link'
import { sanityFetch, queries, urlFor } from '@/lib/sanity'

export const revalidate = 3600 // 1 hour

export default async function NewsPage() {
  const newsPosts = await sanityFetch(queries.allNews)

  return (
    <main className="max-w-5xl mx-auto px-4 py-10 space-y-6">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold text-gray-900">News</h1>
      </header>

      {(!newsPosts || newsPosts.length === 0) && (
        <p className="text-gray-500">No news posts yet. Check back soon for updates.</p>
      )}

      <div className="space-y-8">
        {newsPosts?.map((post) => (
          <article key={post._id} className="rounded-lg border border-gray-200 bg-white shadow-sm overflow-hidden">
            {post.featuredImage && (
              <div className="aspect-video relative w-full">
                <Image
                  src={urlFor(post.featuredImage).width(800).height(450).fit('crop').url()}
                  alt={post.title}
                  fill
                  className="object-cover"
                />
              </div>
            )}
            <div className="p-6 space-y-4">
              <div className="space-y-2">
                <div className="flex items-center gap-3 text-sm text-gray-600">
                  {post.publishedAt && (
                    <time dateTime={post.publishedAt}>
                      {new Date(post.publishedAt).toLocaleDateString('en-US', {
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric'
                      })}
                    </time>
                  )}
                  {post.author?.name && (
                    <>
                      <span>•</span>
                      <Link
                        href={post.author.slug?.current ? `/team/${post.author.slug.current}` : '#'}
                        className="hover:text-blue-700 hover:underline"
                      >
                        {post.author.name}
                      </Link>
                    </>
                  )}
                </div>
                <h2 className="text-2xl font-semibold text-gray-900">
                  {post.slug?.current ? (
                    <Link href={`/news/${post.slug.current}`} className="hover:text-blue-700">
                      {post.title}
                    </Link>
                  ) : (
                    post.title
                  )}
                </h2>
              </div>
              {post.excerpt && (
                <p className="text-gray-700 leading-relaxed">{post.excerpt}</p>
              )}
              {post.slug?.current && (
                <Link
                  href={`/news/${post.slug.current}`}
                  className="inline-block text-blue-700 hover:underline font-medium text-sm"
                >
                  Read more →
                </Link>
              )}
            </div>
          </article>
        ))}
      </div>
    </main>
  )
}
