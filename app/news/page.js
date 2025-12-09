import Image from 'next/image'
import Link from 'next/link'
import { sanityFetch, queries, urlFor } from '@/lib/sanity'

export const revalidate = 3600 // 1 hour

export default async function NewsPage() {
  const newsPostsRaw = await sanityFetch(queries.allNews)
  // Strip Sanity data to plain JSON to break any circular references
  const newsPosts = JSON.parse(JSON.stringify(newsPostsRaw || []))

  return (
    <main className="max-w-[1400px] mx-auto px-6 md:px-12 py-12 space-y-8">
      <header className="flex justify-between items-center">
        <div>
          <h2 className="text-sm font-semibold text-[#888] uppercase tracking-[0.08em] mb-2">
            Latest Updates
          </h2>
          <h1 className="text-4xl font-bold tracking-tight">News</h1>
        </div>
        <span className="text-sm text-[#666] font-medium">{newsPosts?.length || 0} posts</span>
      </header>

      {(!newsPosts || newsPosts.length === 0) && (
        <p className="text-[#666]">No news posts yet. Check back soon for updates.</p>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        {newsPosts?.map((post) => (
          <article key={post._id} className="group bg-white border border-black/[0.06] overflow-hidden transition-all hover:-translate-y-1 hover:shadow-lg">
            {post.featuredImage && (
              <div className="aspect-video relative w-full overflow-hidden">
                <Image
                  src={urlFor(post.featuredImage).width(800).height(450).fit('crop').url()}
                  alt={post.title}
                  fill
                  className="object-cover transition-transform group-hover:scale-105"
                />
              </div>
            )}
            <div className="p-6 space-y-3">
              <div className="flex items-center gap-3 text-xs text-[#888] font-medium">
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
                    <span className="opacity-50">•</span>
                    <Link
                      href={post.author.slug?.current ? `/team/${post.author.slug.current}` : '#'}
                      className="text-purple hover:underline"
                    >
                      {post.author.name}
                    </Link>
                  </>
                )}
              </div>
              <h2 className="text-xl font-semibold text-[#1a1a1a] leading-snug">
                {post.slug?.current ? (
                  <Link href={`/news/${post.slug.current}`} className="hover:text-purple transition-colors">
                    {post.title}
                  </Link>
                ) : (
                  post.title
                )}
              </h2>
              {post.excerpt && (
                <p className="text-sm text-[#666] leading-relaxed line-clamp-3">{post.excerpt}</p>
              )}
              {post.slug?.current && (
                <Link
                  href={`/news/${post.slug.current}`}
                  className="arrow-link text-[13px]"
                >
                  Read more
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M5 12h14M12 5l7 7-7 7"/>
                  </svg>
                </Link>
              )}
            </div>
          </article>
        ))}
      </div>
    </main>
  )
}
