import {
  TRIAL_PRESCREEN_CKD_STAGE_OPTIONS,
  TRIAL_PRESCREEN_DIABETES_OPTIONS,
  TRIAL_PRESCREEN_DIALYSIS_STATUS_OPTIONS,
  TRIAL_PRESCREEN_EXCLUSION_OPTIONS,
  TRIAL_PRESCREEN_MUST_ASK_OPTIONS,
  TRIAL_PRESCREEN_POPULATION_OPTIONS,
  TRIAL_PRESCREEN_SEX_OPTIONS,
  TRIAL_PRESCREEN_TRANSPLANT_STATUS_OPTIONS,
} from '@/lib/trialPrescreen'

function CheckboxList({ legend, options, selectedValues, onToggle, helpText }) {
  return (
    <div className="space-y-2">
      <div>
        <p className="text-sm font-medium">{legend}</p>
        {helpText ? <p className="text-xs text-gray-500 mt-1">{helpText}</p> : null}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {options.map((option) => (
          <label
            key={option.value}
            className="inline-flex items-center gap-2 rounded-lg border border-black/10 bg-white px-3 py-2 text-sm"
          >
            <input
              type="checkbox"
              checked={selectedValues.includes(option.value)}
              onChange={() => onToggle(option.value)}
              className="h-4 w-4"
            />
            <span>{option.label}</span>
          </label>
        ))}
      </div>
    </div>
  )
}

export default function TrialPrescreenEditor({
  value,
  onFieldChange,
  onToggleArrayValue,
}) {
  return (
    <div className="bg-white border border-black/5 rounded-xl p-5 md:p-6 shadow-sm space-y-5">
      <div>
        <h3 className="text-lg font-semibold">Trial Matching Assistant</h3>
        <p className="text-sm text-gray-500">
          All active studies are available to the public chat-style prescreener. These reviewed fields improve ranking
          and help the assistant ask the right follow-up questions.
        </p>
      </div>

      <div className="space-y-1">
        <label htmlFor="trial-prescreen-summary" className="text-sm font-medium">
          Public matching summary
        </label>
        <textarea
          id="trial-prescreen-summary"
          value={value.screeningSummary}
          onChange={(e) => onFieldChange('screeningSummary', e.target.value)}
          rows={3}
          className="w-full border border-black/10 px-3 py-2 rounded focus:outline-none focus:ring-2 focus:ring-purple"
        />
        <p className="text-xs text-gray-500">
          Shown in assistant results. Keep it factual and avoid saying the patient is definitely eligible.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="space-y-1">
          <label htmlFor="trial-prescreen-sex" className="text-sm font-medium">
            Sex requirement
          </label>
          <select
            id="trial-prescreen-sex"
            value={value.sexAllowed}
            onChange={(e) => onFieldChange('sexAllowed', e.target.value)}
            className="w-full border border-black/10 px-3 py-2 rounded bg-white focus:outline-none focus:ring-2 focus:ring-purple"
          >
            {TRIAL_PRESCREEN_SEX_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label htmlFor="trial-prescreen-min-age" className="text-sm font-medium">
            Minimum age (years)
          </label>
          <input
            id="trial-prescreen-min-age"
            type="number"
            min="0"
            max="120"
            step="1"
            value={value.minimumAgeYears}
            onChange={(e) => onFieldChange('minimumAgeYears', e.target.value)}
            className="w-full border border-black/10 px-3 py-2 rounded focus:outline-none focus:ring-2 focus:ring-purple"
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="trial-prescreen-max-age" className="text-sm font-medium">
            Maximum age (years)
          </label>
          <input
            id="trial-prescreen-max-age"
            type="number"
            min="0"
            max="120"
            step="1"
            value={value.maximumAgeYears}
            onChange={(e) => onFieldChange('maximumAgeYears', e.target.value)}
            className="w-full border border-black/10 px-3 py-2 rounded focus:outline-none focus:ring-2 focus:ring-purple"
          />
        </div>
      </div>

      <CheckboxList
        legend="Target populations"
        helpText="Select the broad kidney populations this study is designed for."
        options={TRIAL_PRESCREEN_POPULATION_OPTIONS}
        selectedValues={value.populationTags}
        onToggle={(selectedValue) => onToggleArrayValue('populationTags', selectedValue)}
      />

      <CheckboxList
        legend="CKD stages"
        helpText="Use only when CKD stage is central to who may fit this study."
        options={TRIAL_PRESCREEN_CKD_STAGE_OPTIONS}
        selectedValues={value.ckdStages}
        onToggle={(selectedValue) => onToggleArrayValue('ckdStages', selectedValue)}
      />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="space-y-1">
          <label htmlFor="trial-prescreen-dialysis" className="text-sm font-medium">
            Dialysis requirement
          </label>
          <select
            id="trial-prescreen-dialysis"
            value={value.dialysisStatus}
            onChange={(e) => onFieldChange('dialysisStatus', e.target.value)}
            className="w-full border border-black/10 px-3 py-2 rounded bg-white focus:outline-none focus:ring-2 focus:ring-purple"
          >
            {TRIAL_PRESCREEN_DIALYSIS_STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label htmlFor="trial-prescreen-transplant" className="text-sm font-medium">
            Transplant requirement
          </label>
          <select
            id="trial-prescreen-transplant"
            value={value.transplantStatus}
            onChange={(e) => onFieldChange('transplantStatus', e.target.value)}
            className="w-full border border-black/10 px-3 py-2 rounded bg-white focus:outline-none focus:ring-2 focus:ring-purple"
          >
            {TRIAL_PRESCREEN_TRANSPLANT_STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label htmlFor="trial-prescreen-diabetes" className="text-sm font-medium">
            Diabetes requirement
          </label>
          <select
            id="trial-prescreen-diabetes"
            value={value.diabetesRequirement}
            onChange={(e) => onFieldChange('diabetesRequirement', e.target.value)}
            className="w-full border border-black/10 px-3 py-2 rounded bg-white focus:outline-none focus:ring-2 focus:ring-purple"
          >
            {TRIAL_PRESCREEN_DIABETES_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-1">
          <label htmlFor="trial-prescreen-egfr-min" className="text-sm font-medium">
            Minimum eGFR
          </label>
          <input
            id="trial-prescreen-egfr-min"
            type="number"
            min="0"
            max="200"
            step="1"
            value={value.egfrMin}
            onChange={(e) => onFieldChange('egfrMin', e.target.value)}
            className="w-full border border-black/10 px-3 py-2 rounded focus:outline-none focus:ring-2 focus:ring-purple"
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="trial-prescreen-egfr-max" className="text-sm font-medium">
            Maximum eGFR
          </label>
          <input
            id="trial-prescreen-egfr-max"
            type="number"
            min="0"
            max="200"
            step="1"
            value={value.egfrMax}
            onChange={(e) => onFieldChange('egfrMax', e.target.value)}
            className="w-full border border-black/10 px-3 py-2 rounded focus:outline-none focus:ring-2 focus:ring-purple"
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-6 text-sm text-gray-700">
        <label className="inline-flex items-center gap-2">
          <input
            type="checkbox"
            checked={value.requiresAlbuminuria}
            onChange={(e) => onFieldChange('requiresAlbuminuria', e.target.checked)}
            className="h-4 w-4"
          />
          Requires albuminuria
        </label>
        <label className="inline-flex items-center gap-2">
          <input
            type="checkbox"
            checked={value.requiresProteinuria}
            onChange={(e) => onFieldChange('requiresProteinuria', e.target.checked)}
            className="h-4 w-4"
          />
          Requires proteinuria
        </label>
      </div>

      <CheckboxList
        legend="Major exclusion flags"
        helpText="Use only for broad exclusions that can be screened safely in a public tool."
        options={TRIAL_PRESCREEN_EXCLUSION_OPTIONS}
        selectedValues={value.exclusionTags}
        onToggle={(selectedValue) => onToggleArrayValue('exclusionTags', selectedValue)}
      />

      <CheckboxList
        legend="Must-ask questions"
        helpText="The assistant will prioritize these questions before showing a strong match."
        options={TRIAL_PRESCREEN_MUST_ASK_OPTIONS}
        selectedValues={value.mustAsk}
        onToggle={(selectedValue) => onToggleArrayValue('mustAsk', selectedValue)}
      />

      <div className="space-y-1">
        <label htmlFor="trial-prescreen-optional-questions" className="text-sm font-medium">
          Optional follow-up questions
        </label>
        <textarea
          id="trial-prescreen-optional-questions"
          rows={4}
          value={value.optionalQuestions.join('\n')}
          onChange={(e) =>
            onFieldChange(
              'optionalQuestions',
              e.target.value
                .split('\n')
                .map((item) => item.trim())
                .filter(Boolean)
            )
          }
          className="w-full border border-black/10 px-3 py-2 rounded focus:outline-none focus:ring-2 focus:ring-purple"
        />
        <p className="text-xs text-gray-500">Enter one plain-language question per line.</p>
      </div>
    </div>
  )
}
