import { sanityFetch, queries } from '@/lib/sanity'

export const revalidate = 3600 // 1 hour

export default async function TrainingPage() {
  const [opportunities, alumni] = await Promise.all([
    sanityFetch(queries.openOpportunities),
    sanityFetch(queries.featuredAlumni)
  ])

  return (
    <main className="max-w-5xl mx-auto px-4 py-10 space-y-8">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold text-gray-900">Opportunities & alumni</h1>
        <p className="text-gray-600">Open roles, how to apply, and highlights from past trainees.</p>
      </header>

      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-semibold text-gray-900">Open opportunities</h2>
          <span className="text-sm text-gray-500">{opportunities?.length || 0} available</span>
        </div>
        {(!opportunities || opportunities.length === 0) && (
          <p className="text-gray-500">No open or ongoing opportunities right now.</p>
        )}
        <div className="space-y-3">
          {opportunities?.map((role) => (
            <OpportunityCard key={role._id} role={role} />
          ))}
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-2xl font-semibold text-gray-900">Featured alumni</h2>
        {(!alumni || alumni.length === 0) && (
          <p className="text-gray-500">Add alumni in Sanity to showcase past trainees.</p>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          {alumni?.map((person) => (
            <article key={person._id} className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-semibold text-gray-900">{person.name}</h3>
                  <p className="text-sm text-gray-600">{person.trainingType?.toUpperCase()} {person.yearCompleted && `• ${person.yearCompleted}`}</p>
                </div>
              </div>
              {person.currentPosition && (
                <p className="text-sm text-gray-700">
                  {person.currentPosition}{person.currentOrganization ? `, ${person.currentOrganization}` : ''}
                </p>
              )}
              {person.testimonial && (
                <blockquote className="text-sm text-gray-700 bg-gray-50 border border-gray-200 rounded p-3">
                  “{person.testimonial}”
                </blockquote>
              )}
              {person.linkedin && (
                <a
                  href={person.linkedin}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-blue-700 hover:underline"
                >
                  LinkedIn
                </a>
              )}
            </article>
          ))}
        </div>
      </section>
    </main>
  )
}

function OpportunityCard({ role }) {
  return (
    <article className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">{role.title}</h3>
          <p className="text-sm text-gray-600">
            {role.type && `${prettyType(role.type)} • `}{prettyStatus(role.status)}
          </p>
        </div>
        <StatusBadge status={role.status} />
      </div>
      {role.researchArea && <p className="text-sm text-gray-700">{role.researchArea}</p>}
      {role.startDate && (
        <p className="text-xs text-gray-600">Start: {role.startDate}{role.deadline ? ` • Apply by ${role.deadline}` : ''}</p>
      )}
      {role.supervisor?.length > 0 && (
        <p className="text-xs text-gray-600">
          Supervisors: {role.supervisor.map((s) => s.name).join(', ')}
        </p>
      )}
      {role.contactEmail && (
        <a
          className="text-sm text-blue-700 hover:underline"
          href={`mailto:${role.contactEmail}?subject=${encodeURIComponent(role.title)}`}
        >
          Contact: {role.contactEmail}
        </a>
      )}
    </article>
  )
}

function StatusBadge({ status }) {
  const styles = {
    open: 'bg-green-100 text-green-800 border-green-200',
    ongoing: 'bg-blue-100 text-blue-800 border-blue-200',
    closed: 'bg-gray-100 text-gray-700 border-gray-200'
  }
  return (
    <span className={`text-xs px-2 py-1 rounded-full border ${styles[status] || 'bg-gray-100 text-gray-700 border-gray-200'}`}>
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

