import { sanityFetch, queries } from '@/lib/sanity'

export const revalidate = 3600

export default async function CapabilitiesPage() {
  const dataRaw = (await sanityFetch(queries.capabilities)) || {}
  // Strip Sanity data to plain JSON to break any circular references
  const data = JSON.parse(JSON.stringify(dataRaw))

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
    contactEmail,
    contactPhone,
  } = data

  return (
    <main className="max-w-[1400px] mx-auto px-6 md:px-12 py-12 space-y-10">
      <header>
        <h2 className="text-sm font-semibold text-[#888] uppercase tracking-[0.08em] mb-2">
          For Sponsors & Partners
        </h2>
        <h1 className="text-4xl font-bold tracking-tight">Capabilities</h1>
        <p className="text-[#666] mt-3 max-w-2xl">{introduction}</p>
      </header>

      <section className="grid gap-5 md:grid-cols-2">
        <CapabilityCard title="Therapeutic areas" content={asList(therapeuticAreas)} />
        <CapabilityCard title="Core capabilities" content={asList(coreCapabilities)} />
        <CapabilityCard title="Infrastructure" content={infrastructure} />
        <CapabilityCard title="Patient volume" content={patientVolume} />
        <CapabilityCard title="Track record" content={asList(trackRecord)} />
        <CapabilityCard title="Regulatory experience" content={regulatoryExperience} />
        <CapabilityCard title="Previous sponsors" content={asList(previousSponsors)} />
        <CapabilityCard title="Additional services" content={asList(additionalServices)} />
      </section>

      <section className="p-6 bg-gradient-to-br from-[#F5F3F0] to-[#EEEBE6]">
        <h2 className="text-lg font-bold text-[#1a1a1a]">Work with us</h2>
        <p className="text-sm text-[#666] mt-1 mb-4">Get in touch to discuss partnership opportunities.</p>
        <div className="flex flex-wrap gap-3">
          {contactEmail && (
            <a className="btn-primary" href={`mailto:${contactEmail}`}>
              Contact via email
            </a>
          )}
          {contactPhone && (
            <a className="btn-secondary" href={`tel:${contactPhone}`}>
              Call us
            </a>
          )}
        </div>
      </section>
    </main>
  )
}

function CapabilityCard({ title, content }) {
  if (!content) return null
  return (
    <div className="p-5 bg-white border border-black/[0.06]">
      <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-[#888] mb-3">{title}</h3>
      <div className="text-sm text-[#555] leading-relaxed">{content}</div>
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
                <div className="font-semibold text-[#1a1a1a]">{item.area}</div>
                {item.description && <p className="text-[#666] text-sm">{item.description}</p>}
              </li>
            )
          }

          if (item.metric) {
            return (
              <li key={key}>
                <span className="font-semibold text-[#1a1a1a]">{item.metric}: </span>
                {item.value}
              </li>
            )
          }

          if (item.service) {
            return (
              <li key={key}>
                <div className="font-semibold text-[#1a1a1a]">{item.service}</div>
                {item.description && <p className="text-[#666] text-sm">{item.description}</p>}
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
