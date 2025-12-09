import { sanityFetch, queries } from '@/lib/sanity'

// Revalidate every 12 hours
export const revalidate = 43200

const statusStyles = {
  recruiting: 'bg-green-100 text-green-800',
  coming_soon: 'bg-yellow-100 text-yellow-800',
  closed: 'bg-gray-100 text-gray-700',
  RECRUITING: 'bg-green-100 text-green-800',
  NOT_YET_RECRUITING: 'bg-yellow-100 text-yellow-800',
  ACTIVE_NOT_RECRUITING: 'bg-blue-100 text-blue-800',
  COMPLETED: 'bg-gray-100 text-gray-700',
}

export default async function TrialsPage() {
  const patientTrials = await sanityFetch(queries.trialSummaries)

  return (
    <main className="space-y-10">
      <header className="space-y-2">
        <p className="text-sm uppercase tracking-wide text-blue-700 font-semibold">Clinical Trials</p>
        <h1 className="text-3xl font-bold text-gray-900">Current studies</h1>
        <p className="text-gray-600">Patient-friendly summaries.</p>
      </header>

      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-semibold text-gray-900">Patient-facing studies</h2>
          <span className="text-sm text-gray-600">{patientTrials?.length || 0} listed</span>
        </div>
        {(!patientTrials || patientTrials.length === 0) && (
          <p className="text-gray-500">No patient-facing studies published yet.</p>
        )}
        <div className="grid gap-4 md:grid-cols-2">
          {patientTrials?.map((trial) => (
            <div key={trial._id} className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-gray-900">{trial.title}</h3>
                {trial.status && (
                  <span className={`text-xs px-2 py-1 rounded-full ${statusStyles[trial.status] || 'bg-gray-100 text-gray-700'}`}>
                    {prettyStatus(trial.status)}
                  </span>
                )}
              </div>
              {trial.condition && <p className="text-sm text-gray-700">{trial.condition}</p>}
              <p className="text-sm text-gray-600 line-clamp-4">
                {buildTrialSummary(trial)}
              </p>
              <div className="flex flex-wrap gap-3 text-sm text-gray-600">
                {trial.principalInvestigator?.name && <span>PI: {trial.principalInvestigator.name}</span>}
                {trial.nctId && <span>NCT: {trial.nctId}</span>}
              </div>
              <div className="text-sm text-blue-700">
                {trial.nctId ? (
                  <a
                    className="hover:underline"
                    href={`https://clinicaltrials.gov/study/${trial.nctId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    ClinicalTrials.gov
                  </a>
                ) : (
                  <span className="text-gray-500">No registry link</span>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>
    </main>
  )
}

function prettyStatus(status) {
  const map = {
    recruiting: 'Recruiting',
    coming_soon: 'Coming soon',
    closed: 'Closed',
    RECRUITING: 'Recruiting',
    NOT_YET_RECRUITING: 'Not yet recruiting',
    ACTIVE_NOT_RECRUITING: 'Active, not recruiting',
    COMPLETED: 'Completed',
  }
  return map[status] || status || 'Status'
}

function buildTrialSummary(trial) {
  const text = trial.purpose || trial.whatToExpect || trial.briefSummary || ''
  if (!text) return 'Summary not available yet.'
  // Simple truncation to mimic a brief AI-like summary; replace with LLM if desired.
  const trimmed = text.trim()
  if (trimmed.length <= 280) return trimmed
  return `${trimmed.slice(0, 280).trim()}…`
}

