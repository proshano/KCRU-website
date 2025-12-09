import Image from 'next/image'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { sanityFetch, queries, urlFor } from '@/lib/sanity'
import { PortableText } from '@portabletext/react'

export const revalidate = 0
export const dynamic = 'force-dynamic'

const portableTextComponents = {
  types: {
    image: ({ value }) => {
      if (!value?.asset) return null
      return (
        <div className="my-6">
          <Image
            src={urlFor(value).width(800).fit('max').url()}
            alt={value.alt || 'Image'}
            width={800}
            height={600}
            className="w-full"
          />
        </div>
      )
    }
  },
  block: {
    h1: ({ children }) => <h1 className="text-3xl font-bold mt-8 mb-4 text-[#1a1a1a]">{children}</h1>,
    h2: ({ children }) => <h2 className="text-2xl font-bold mt-6 mb-3 text-[#1a1a1a]">{children}</h2>,
    h3: ({ children }) => <h3 className="text-xl font-bold mt-4 mb-2 text-[#1a1a1a]">{children}</h3>,
    normal: ({ children }) => <p className="mb-4 text-[#555] leading-relaxed">{children}</p>,
    blockquote: ({ children }) => (
      <blockquote className="border-l-4 border-purple pl-4 my-4 italic text-[#666]">
        {children}
      </blockquote>
    )
  },
  marks: {
    link: ({ children, value }) => {
      const target = (value?.href || '').startsWith('http') ? '_blank' : undefined
      return (
        <a
          href={value?.href}
          target={target}
          rel={target === '_blank' ? 'noopener noreferrer' : undefined}
          className="text-purple hover:underline"
        >
          {children}
        </a>
      )
    }
  }
}

export default async function NewsPostPage({ params }) {
  const resolvedParams = await params
  const slugRaw = resolvedParams?.slug
  const slug = typeof slugRaw === 'string' ? decodeURIComponent(slugRaw).replace(/^\/+|\/+$/g, '') : ''
  if (!slug) return notFound()

  const post = await sanityFetch(queries.newsPostBySlug, { slug })
  if (!post) return notFound()

  return (
    <main className="max-w-[900px] mx-auto px-6 md:px-12 py-12 space-y-8">
      <div>
        <Link href="/news" className="arrow-link text-[13px]">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="rotate-180">
            <path d="M5 12h14M12 5l7 7-7 7"/>
          </svg>
          Back to news
        </Link>
      </div>

      <article className="space-y-8">
        <header className="space-y-4">
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
          <h1 className="text-4xl font-bold tracking-tight">{post.title}</h1>
          {post.excerpt && (
            <p className="text-xl text-[#666] leading-relaxed">{post.excerpt}</p>
          )}
        </header>

        {post.featuredImage && (
          <div className="aspect-video relative w-full overflow-hidden">
            <Image
              src={urlFor(post.featuredImage).width(1200).height(675).fit('crop').url()}
              alt={post.title}
              fill
              className="object-cover"
            />
          </div>
        )}

        {post.body && (
          <div className="prose prose-lg max-w-none">
            <PortableText value={post.body} components={portableTextComponents} />
          </div>
        )}

        {post.tags && post.tags.length > 0 && (
          <div className="flex flex-wrap gap-2 pt-6 border-t border-black/[0.06]">
            {post.tags.map((tag, idx) => (
              <span
                key={idx}
                className="px-3 py-1.5 bg-purple/10 text-purple text-sm font-medium"
              >
                {tag}
              </span>
            ))}
          </div>
        )}

        {post.author && (
          <div className="border-t border-black/[0.06] pt-8">
            <div className="flex items-center gap-4">
              {post.author.photo ? (
                <Image
                  src={urlFor(post.author.photo).width(80).height(80).fit('crop').url()}
                  alt={post.author.name}
                  width={80}
                  height={80}
                  className="rounded-full"
                />
              ) : (
                <div className="w-20 h-20 rounded-full bg-[#E8E5E0] flex items-center justify-center text-2xl font-semibold text-[#aaa]">
                  {post.author.name?.slice(0, 1)?.toUpperCase() || '?'}
                </div>
              )}
              <div>
                <p className="font-semibold text-[#1a1a1a]">{post.author.name}</p>
                {post.author.slug?.current && (
                  <Link
                    href={`/team/${post.author.slug.current}`}
                    className="arrow-link text-[13px]"
                  >
                    View profile
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M5 12h14M12 5l7 7-7 7"/>
                    </svg>
                  </Link>
                )}
              </div>
            </div>
          </div>
        )}
      </article>
    </main>
  )
}
