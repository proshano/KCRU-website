import { sanityFetch, queries } from '@/lib/sanity'

export const revalidate = 3600

export default async function CapabilitiesPage() {
  const data = (await sanityFetch(queries.capabilities)) || {}

  const {
    headline = 'Capabilities for sponsors and partners',
    introduction = 'We combine investigator-led expertise with operational readiness to run high-quality kidney research.',
    therapeuticAreas = [],
    coreCapabilities = [],
    infrastructure,
    patientVolume,
    trackRecord = [],
    regulatoryExperience,
    previousSponsors = [],
    additionalServices = [],
    contactName,
    contactEmail,
    contactPhone,
  } = data

  return (
    <main className="mx-auto max-w-5xl space-y-8 px-6 py-10">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold text-slate-900">{headline}</h1>
        <p className="text-slate-700">{introduction}</p>
      </header>

      <section className="grid gap-4 md:grid-cols-2">
        <CapabilityCard title="Therapeutic areas" content={asList(therapeuticAreas)} />
        <CapabilityCard title="Core capabilities" content={asList(coreCapabilities)} />
        <CapabilityCard title="Infrastructure" content={infrastructure} />
        <CapabilityCard title="Patient volume" content={patientVolume} />
        <CapabilityCard title="Track record" content={asList(trackRecord)} />
        <CapabilityCard title="Regulatory experience" content={regulatoryExperience} />
        <CapabilityCard title="Previous sponsors" content={asList(previousSponsors)} />
        <CapabilityCard title="Additional services" content={asList(additionalServices)} />
      </section>

      <section className="rounded-2xl bg-slate-50 px-5 py-5 ring-1 ring-slate-200">
        <h2 className="text-lg font-semibold text-slate-900">Work with us</h2>
        <p className="mt-1 text-sm text-slate-700">
          Reach out to discuss feasibility, site selection, or collaborations for new studies.
        </p>
        <div className="mt-3 flex flex-wrap gap-3 text-sm font-semibold text-blue-700">
          {contactEmail && (
            <a className="rounded-full bg-white px-3 py-1 ring-1 ring-blue-100" href={`mailto:${contactEmail}`}>
              {contactEmail}
            </a>
          )}
          {contactPhone && (
            <a className="rounded-full bg-white px-3 py-1 ring-1 ring-blue-100" href={`tel:${contactPhone}`}>
              {contactPhone}
            </a>
          )}
          {contactName && <span className="rounded-full bg-white px-3 py-1 ring-1 ring-slate-200 text-slate-700">{contactName}</span>}
        </div>
      </section>
    </main>
  )
}

function CapabilityCard({ title, content }) {
  if (!content) return null
  return (
    <div className="rounded-2xl bg-white px-4 py-4 ring-1 ring-slate-200">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">{title}</h3>
      <div className="mt-2 text-sm text-slate-700 leading-relaxed">{content}</div>
    </div>
  )
}

function asList(value) {
  if (!value) return null
  if (Array.isArray(value) && value.length === 0) return null
  if (Array.isArray(value)) {
    return (
      <ul className="list-disc space-y-2 pl-5">
        {value.map((item, idx) => {
          if (item == null) return null

          if (typeof item === 'string' || typeof item === 'number') {
            return <li key={`${item}-${idx}`}>{item}</li>
          }

          const key = item._key || item.area || item.metric || item.service || idx

          if (item.area) {
            return (
              <li key={key}>
                <div className="font-semibold">{item.area}</div>
                {item.description && <p className="text-slate-600 text-sm">{item.description}</p>}
              </li>
            )
          }

          if (item.metric) {
            return (
              <li key={key}>
                <span className="font-semibold">{item.metric}: </span>
                {item.value}
              </li>
            )
          }

          if (item.service) {
            return (
              <li key={key}>
                <div className="font-semibold">{item.service}</div>
                {item.description && <p className="text-slate-600 text-sm">{item.description}</p>}
              </li>
            )
          }

          return <li key={key}>{String(item)}</li>
        })}
      </ul>
    )
  }
  return value
}
