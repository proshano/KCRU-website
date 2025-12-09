import Image from 'next/image'
import Link from 'next/link'
import { sanityFetch, queries, urlFor } from '@/lib/sanity'

export const revalidate = 3600

export default async function HomePage() {
  const [settings, trials = [], researchers = [], news = []] = await Promise.all([
    sanityFetch(queries.siteSettings),
    sanityFetch(queries.recruitingTrials),
    sanityFetch(queries.allResearchers),
    sanityFetch(queries.recentNews),
  ])

  return (
    <main className="relative mx-auto max-w-6xl space-y-14 px-6 py-12 lg:py-16">
      <div className="pointer-events-none absolute -left-32 top-12 h-72 w-72 rounded-full bg-gradient-to-br from-slate-100 via-white to-transparent blur-3xl" aria-hidden />
      <div className="pointer-events-none absolute -right-20 bottom-10 h-80 w-80 rounded-full bg-gradient-to-tl from-slate-200 via-white to-transparent blur-3xl" aria-hidden />

      <section className="relative overflow-hidden rounded-[32px] border border-slate-200/70 bg-white/70 shadow-[0_25px_80px_-50px_rgba(15,23,42,0.55)] backdrop-blur-2xl">
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-white/70 via-white/40 to-slate-50/70" aria-hidden />
        <div className="relative grid items-start gap-10 px-7 py-10 sm:px-10 lg:grid-cols-[1.1fr_1fr] lg:px-12 lg:py-14">
          <div className="space-y-6">
            <div className="space-y-3">
              <h1 className="text-4xl font-extrabold leading-tight tracking-[-0.035em] text-slate-900 sm:text-5xl lg:text-6xl">
                {settings?.unitName || 'London Kidney Clinical Trials'}
              </h1>
              <p className="max-w-3xl text-lg text-slate-600 sm:text-xl">
                Kidney specialists fighting disease through research.
              </p>
            </div>

            <div className="pt-1">
              <AvatarHoneycomb researchers={researchers} />
            </div>
          </div>

          <div className="grid grid-cols-12 auto-rows-[minmax(140px,1fr)] gap-4">
            <BentoCard
              href="/trials"
              label="Active trials"
              sublabel="See recruiting and upcoming studies"
              className="col-span-12 sm:col-span-7 lg:row-span-2"
            />
            <BentoCard
              href="/publications"
              label="Publications"
              sublabel="Latest outputs and five-year view"
              className="col-span-12 sm:col-span-5"
            />
            <BentoCard
              href="/team"
              label="Investigators"
              sublabel="Profiles and contact routes"
              className="col-span-12 sm:col-span-5"
            />
            <BentoCard
              href="/capabilities"
              label="Capabilities"
              sublabel="What we offer for sponsors & partners"
              className="col-span-12 sm:col-span-7"
            />
          </div>
        </div>
      </section>

      <ContentSection
        eyebrow="Clinical focus"
        title="Trials now recruiting"
        actionHref="/trials"
        actionLabel="All trials"
        description="Active and upcoming studies with eligibility and contacts up front."
      >
        {trials.length === 0 && (
          <p className="text-sm text-slate-600">No recruiting trials are listed yet. Please check back soon.</p>
        )}
        <div className="space-y-2">
          {trials.slice(0, 3).map((trial) => (
            <TrialCard key={trial._id} trial={trial} />
          ))}
        </div>
      </ContentSection>

      {news && news.length > 0 && (
        <ContentSection
          eyebrow="Updates"
          title="Latest news"
          actionHref="/news"
          actionLabel="All news"
          description="Recent announcements, research updates, and stories from our team."
        >
          <div className="space-y-3">
            {news.slice(0, 3).map((post) => (
              <NewsCard key={post._id} post={post} />
            ))}
          </div>
        </ContentSection>
      )}

    </main>
  )
}

function ContentSection({ eyebrow, title, description, actionHref, actionLabel, children }) {
  return (
    <section className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          {eyebrow && (
            <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-500">{eyebrow}</p>
          )}
          <h2 className="text-2xl font-semibold tracking-[-0.02em] text-slate-900 sm:text-3xl">{title}</h2>
          {description && <p className="max-w-3xl text-sm text-slate-600">{description}</p>}
        </div>
        {actionHref && actionLabel && (
          <Link
            href={actionHref}
            className="text-sm font-semibold text-slate-800 transition hover:text-black hover:underline"
          >
            {actionLabel}
          </Link>
        )}
      </header>
      {children}
    </section>
  )
}

function TrialCard({ trial }) {
  const status = (trial.status || 'recruiting').toLowerCase()
  const statusStyles =
    status === 'recruiting'
      ? 'text-emerald-800 bg-emerald-50/80 ring-1 ring-emerald-200/80'
      : status === 'active'
      ? 'text-slate-900 bg-slate-100 ring-1 ring-slate-200'
      : 'text-slate-700 bg-slate-100 ring-1 ring-slate-200'

  const slug = trial.slug?.current || trial.slug
  const isRecruiting = status === 'recruiting'

  return (
    <Link
      href={slug ? `/trials/${slug}` : '/trials'}
      className="group relative flex flex-col gap-3 overflow-hidden rounded-2xl border border-slate-200/70 bg-white/70 p-5 shadow-[0_25px_80px_-55px_rgba(15,23,42,0.7)] backdrop-blur-xl transition hover:-translate-y-1 hover:scale-[1.01] hover:shadow-[0_25px_80px_-45px_rgba(15,23,42,0.8)]"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <span
            className={`relative inline-flex items-center gap-2 rounded-full px-3 py-1 text-[11px] font-semibold ${statusStyles}`}
          >
            {isRecruiting && (
              <span className="relative flex h-2.5 w-2.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
              </span>
            )}
            {trial.status || 'Recruiting'}
          </span>
          <h3 className="text-xl font-semibold leading-tight text-slate-900">{trial.title}</h3>
          <p className="text-sm text-slate-600">
            {trial.purpose || trial.condition || 'Patient-facing summary available.'}
          </p>
          <p className="text-xs uppercase tracking-[0.24em] text-slate-500">
            {trial.condition ? `${trial.condition}` : 'Kidney research'}{' '}
            {trial.principalInvestigator?.name ? `· PI: ${trial.principalInvestigator.name}` : ''}
          </p>
        </div>
        <span className="flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-slate-900 text-sm font-semibold text-white shadow-sm transition group-hover:-translate-y-0.5 group-hover:shadow-lg">
          →
        </span>
      </div>
    </Link>
  )
}

function AvatarCircle({ photo, name, sizeClass = 'h-12 w-12' }) {
  if (photo) {
    const src = urlFor(photo).width(140).height(140).fit('crop').url()
    return (
      <div className={`${sizeClass} overflow-hidden rounded-full bg-slate-100 ring-2 ring-white shadow-sm transition group-hover/avatar:scale-[1.06] group-hover/avatar:shadow-md`}>
        <Image src={src} alt={name || 'Researcher'} width={140} height={140} className="h-full w-full object-cover" />
      </div>
    )
  }

  return (
    <div className={`flex ${sizeClass} items-center justify-center rounded-full bg-slate-200 text-xs font-semibold text-slate-600 ring-2 ring-white shadow-sm transition group-hover/avatar:scale-[1.06] group-hover/avatar:shadow-md`}>
      {name?.slice(0, 1)?.toUpperCase() || '?'}
    </div>
  )
}

function AvatarHoneycomb({ researchers = [] }) {
  const list = researchers

  if (list.length === 0) return <p className="text-sm text-slate-600">No investigators listed yet.</p>

  const offsets = [0, 8, 16, 8, -4, 12]

  return (
    <div className="flex max-w-4xl flex-wrap gap-4">
      {list.map((r, idx) => {
        const slugValue = typeof r.slug === 'string' ? r.slug : r.slug?.current
        const href = slugValue && slugValue.trim() ? `/team/${slugValue}` : '/team'
        const offset = offsets[idx % offsets.length]
        return (
          <Link
            key={r._id || slugValue || r.name || idx}
            href={href}
            className="group/avatar relative inline-flex transition duration-200 ease-out"
            style={{ transform: `translateY(${offset}px)` }}
          >
            <span className="block overflow-hidden rounded-full border border-white/80 bg-slate-200 shadow-sm ring-1 ring-slate-200/60">
              <AvatarCircle photo={r.photo} name={r.name} sizeClass="h-16 w-16" />
            </span>
          </Link>
        )
      })}
    </div>
  )
}

function BentoCard({ href, label, sublabel, className = '' }) {
  return (
    <Link
      href={href}
      className={`group relative flex flex-col justify-between overflow-hidden rounded-2xl border border-slate-200/70 bg-white/70 p-5 shadow-[0_20px_70px_-50px_rgba(15,23,42,0.6)] backdrop-blur-xl transition hover:-translate-y-1 hover:scale-[1.02] hover:shadow-[0_20px_70px_-40px_rgba(15,23,42,0.7)] ${className}`}
    >
      <div className="space-y-2">
        <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">Navigate</p>
        <h3 className="text-xl font-semibold text-slate-900">{label}</h3>
        {sublabel && <p className="text-sm text-slate-600">{sublabel}</p>}
      </div>
      <div className="mt-4 flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <span className="h-1.5 w-1.5 rounded-full bg-slate-900/70" />
          Updated weekly
        </div>
        <span className="flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-slate-900 text-white shadow-sm transition group-hover:-translate-y-0.5 group-hover:shadow-lg">
          →
        </span>
      </div>
    </Link>
  )
}

function NewsCard({ post }) {
  const slug = post.slug?.current
  const href = slug ? `/news/${slug}` : '#'
  
  return (
    <Link
      href={href}
      className="group block rounded-2xl border border-slate-200/70 bg-white/70 p-5 shadow-[0_20px_70px_-55px_rgba(15,23,42,0.7)] backdrop-blur-xl transition hover:-translate-y-1 hover:scale-[1.01] hover:shadow-[0_20px_70px_-45px_rgba(15,23,42,0.8)]"
    >
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-xs text-slate-500">
          {post.publishedAt && (
            <time dateTime={post.publishedAt}>
              {new Date(post.publishedAt).toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'short',
                day: 'numeric'
              })}
            </time>
          )}
          {post.author?.name && (
            <>
              <span>•</span>
              <span>{post.author.name}</span>
            </>
          )}
        </div>
        <h3 className="text-lg font-semibold leading-tight text-slate-900 group-hover:text-blue-700">
          {post.title}
        </h3>
        {post.excerpt && (
          <p className="text-sm text-slate-600 line-clamp-2">{post.excerpt}</p>
        )}
      </div>
    </Link>
  )
}
