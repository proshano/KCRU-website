import { sanityFetch, queries } from '@/lib/sanity'

export const revalidate = 3600 // 1 hour

export default async function TrainingPage() {
  const [opportunitiesRaw, pageContentRaw] = await Promise.all([
    sanityFetch(queries.openOpportunities),
    sanityFetch(queries.pageContent)
  ])
  // Strip Sanity data to plain JSON to break any circular references
  const opportunities = JSON.parse(JSON.stringify(opportunitiesRaw || []))
  const content = JSON.parse(JSON.stringify(pageContentRaw || {}))

  // Page content with fallbacks
  const eyebrow = content.trainingEyebrow || 'Join Our Team'
  const title = content.trainingTitle || 'Opportunities'
  const description = (content.trainingDescription || 'Open roles, how to apply, and highlights from past trainees.').trim()

  return (
    <main className="max-w-[1400px] mx-auto px-6 md:px-12 py-12 space-y-8">
      <header>
        <h2 className="text-sm font-semibold text-[#888] uppercase tracking-[0.08em] mb-2">
          {eyebrow}
        </h2>
        <h1 className="text-4xl font-bold tracking-tight">{title}</h1>
        {description && (
          <p className="text-[#666] mt-3">{description}</p>
        )}
      </header>

      <section className="space-y-6">
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-bold tracking-tight">Open opportunities</h2>
          <span className="text-sm text-[#666] font-medium">{opportunities?.length || 0} available</span>
        </div>
        {(!opportunities || opportunities.length === 0) && (
          <p className="text-[#666]">No open or ongoing opportunities right now.</p>
        )}
        <div className="grid gap-5 md:grid-cols-2">
          {opportunities?.map((role) => (
            <OpportunityCard key={role._id} role={role} />
          ))}
        </div>
      </section>
    </main>
  )
}

function OpportunityCard({ role }) {
  return (
    <article className="p-6 bg-white border border-black/[0.06] space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-lg font-semibold text-[#1a1a1a]">{role.title}</h3>
          <p className="text-sm text-[#666]">
            {role.type && `${prettyType(role.type)} · `}{prettyStatus(role.status)}
          </p>
        </div>
        <StatusBadge status={role.status} />
      </div>
      {role.researchArea && <p className="text-sm text-[#555]">{role.researchArea}</p>}
      {role.startDate && (
        <p className="text-xs text-[#888] font-medium">
          Start: {role.startDate}{role.deadline ? ` · Apply by ${role.deadline}` : ''}
        </p>
      )}
      {role.supervisor?.length > 0 && (
        <p className="text-xs text-[#888] font-medium">
          Supervisors: {role.supervisor.map((s) => s.name).join(', ')}
        </p>
      )}
      {role.contactEmail && (
        <a
          className="arrow-link text-[13px]"
          href={`mailto:${role.contactEmail}?subject=${encodeURIComponent(role.title)}`}
        >
          Contact
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M5 12h14M12 5l7 7-7 7"/>
          </svg>
        </a>
      )}
    </article>
  )
}

function StatusBadge({ status }) {
  const styles = {
    open: 'text-emerald-800 bg-emerald-50 ring-1 ring-emerald-200',
    ongoing: 'text-purple bg-purple/10 ring-1 ring-purple/30',
    closed: 'text-[#666] bg-[#f5f5f5] ring-1 ring-[#ddd]'
  }
  return (
    <span className={`text-[11px] px-3 py-1 rounded-full font-semibold ${styles[status] || styles.closed}`}>
      {prettyStatus(status)}
    </span>
  )
}

function prettyStatus(status) {
  if (!status) return 'Status TBD'
  const map = {
    open: 'Open',
    closed: 'Closed',
    ongoing: 'Always accepting'
  }
  return map[status] || status
}

function prettyType(type) {
  const map = {
    phd: 'PhD Student',
    msc: 'MSc Student',
    postdoc: 'Postdoctoral Fellow',
    clinical_fellow: 'Clinical Fellow',
    ra: 'Research Assistant',
    summer: 'Summer Student',
    undergrad: 'Undergraduate Thesis',
    visiting: 'Visiting Scholar'
  }
  return map[type] || type
}
