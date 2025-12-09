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
            className="rounded-lg"
          />
        </div>
      )
    }
  },
  block: {
    h1: ({ children }) => <h1 className="text-3xl font-bold mt-8 mb-4 text-gray-900">{children}</h1>,
    h2: ({ children }) => <h2 className="text-2xl font-semibold mt-6 mb-3 text-gray-900">{children}</h2>,
    h3: ({ children }) => <h3 className="text-xl font-semibold mt-4 mb-2 text-gray-900">{children}</h3>,
    normal: ({ children }) => <p className="mb-4 text-gray-700 leading-relaxed">{children}</p>,
    blockquote: ({ children }) => (
      <blockquote className="border-l-4 border-blue-500 pl-4 my-4 italic text-gray-600">
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
          className="text-blue-700 hover:underline"
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
    <main className="max-w-4xl mx-auto px-4 py-10 space-y-6">
      <div>
        <Link href="/news" className="text-blue-700 hover:underline text-sm">
          ← Back to news
        </Link>
      </div>

      <article className="space-y-6">
        <header className="space-y-4">
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
          <h1 className="text-4xl font-bold text-gray-900">{post.title}</h1>
          {post.excerpt && (
            <p className="text-xl text-gray-600 leading-relaxed">{post.excerpt}</p>
          )}
        </header>

        {post.featuredImage && (
          <div className="aspect-video relative w-full rounded-lg overflow-hidden">
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
          <div className="flex flex-wrap gap-2 pt-4 border-t border-gray-200">
            {post.tags.map((tag, idx) => (
              <span
                key={idx}
                className="px-3 py-1 bg-blue-50 text-blue-700 rounded-full text-sm font-medium"
              >
                {tag}
              </span>
            ))}
          </div>
        )}

        {post.author && (
          <div className="border-t border-gray-200 pt-6">
            <div className="flex items-center gap-4">
              {post.author.photo && (
                <Image
                  src={urlFor(post.author.photo).width(80).height(80).fit('crop').url()}
                  alt={post.author.name}
                  width={80}
                  height={80}
                  className="rounded-full"
                />
              )}
              <div>
                <p className="font-semibold text-gray-900">{post.author.name}</p>
                {post.author.slug?.current && (
                  <Link
                    href={`/team/${post.author.slug.current}`}
                    className="text-sm text-blue-700 hover:underline"
                  >
                    View profile →
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
