# Trial matching assistant handoff

The trial matching assistant is a public chat prescreener for non-identifying patient characteristics. It asks follow-up questions, builds a structured patient profile in memory, and ranks recruiting studies from the local roster. The LLM handles conversation and profile extraction. The final study ranking stays deterministic in `lib/trialMatcher.js`.

## Current public experience

The public entry point is the floating widget in `app/components/TrialAssistantWidget.js`, mounted globally from `app/layout.js`. It auto-opens on `/`, stays available in the bottom-right corner across public pages, and can be minimized to a launcher. Where the browser supports it, a **microphone** control uses the Web Speech API (`en-CA`) for dictation into the message field; users can edit text before sending. The widget state lives in client state, so it persists during client-side navigation and resets on a full reload. `app/layout.js` adds bottom padding on small screens when the assistant is enabled so the launcher does not sit directly on top of page content.

The widget does not render everywhere. It is intentionally hidden on `/admin`, `/login`, `/protected`, `/trials/manage`, `/trials/approvals`, `/updates/admin`, and `/under-construction`. The route `/trials/find` is no longer the primary experience. It is now a noindexed informational fallback page that points users back to the floating widget.

## Gating and study roster

The feature only mounts when `siteSettings.trialMatchingAssistant.enabled` is true. `lib/trialMatchingSettings.js` treats any missing value as false. That matters in existing datasets because the schema default in `sanity/schemas/siteSettings.js` does not backfill older `siteSettings` documents. A dataset can contain a valid `siteSettings` document with `trialMatchingAssistant: null`, and the widget will stay hidden until someone explicitly sets the field.

The public assistant only sees studies returned by `queries.trialMatchingStudies` in `lib/sanity.js`. That query filters to `status == "recruiting"` and returns the public trial fields plus the structured `prescreen` object. Coming soon and active-not-recruiting studies do not participate in the public chat flow even though the matcher itself can technically score any study object it receives.

## Request and ranking flow

`app/components/TrialAssistantWidget.js` posts the current chat history and the in-memory patient profile to `app/api/trials/match/chat/route.js`. The route trims the message list, redacts obvious identifiers such as email addresses, phone numbers, dates of birth, and long record-like numbers, and applies a simple in-memory IP rate limit. The route then loads `siteSettings` and the recruiting study roster from Sanity. If the assistant toggle is off, it returns a `503`.

`generateTrialMatchConversation()` in `lib/summaries.js` sends the sanitized conversation, a compact study catalog from `buildTrialCatalogForPrompt()`, and **truncated inclusion/exclusion excerpts** (`buildTrialEligibilityCatalogForPrompt()` from the same recruiting study list) to the configured LLM. The model returns JSON with three fields: `assistant_reply`, `ready_for_matching`, and `patient_profile`. `lib/patientProfileSchema.js` defines that profile contract and normalizes every field before the API uses it.

Once the route has a normalized patient profile, it decides whether to show matches and, by default, calls **`generateTrialMatchStudyRanking()`** in `lib/summaries.js`: a second LLM request with the profile plus a compact per-study payload (title, summary, inclusion excerpt, prescreen hints). The model returns up to six studies with a short “may fit” reason; this step is **nondeterministic**. If that call throws, the route falls back to **`rankTrialMatches()`** in `lib/trialMatcher.js` (rule-based scoring, `mustAsk`, and title/summary heuristics when prescreen is thin). The API returns the assistant reply, the updated profile, and up to six results with `Cache-Control: no-store`. The fallback path can cap how many `insufficient_info` rows appear when better-scored rows exist.

## Study-side data and staff workflow

The study-side contract lives in `lib/trialPrescreen.js`. It defines the supported prescreen fields, labels, empty-state defaults, and form normalization helpers. The current live fields are `screeningSummary`, `sexAllowed`, `minimumAgeYears`, `maximumAgeYears`, `populationTags`, `ckdStages`, `dialysisStatus`, `transplantStatus`, `diabetesRequirement`, `egfrMin`, `egfrMax`, `requiresAlbuminuria`, `requiresProteinuria`, `exclusionTags`, `mustAsk`, and `optionalQuestions`. **`populationTags`** includes both broad categories (e.g. chronic kidney disease, glomerular disease) and **disease-specific** tags (e.g. IgA nephropathy, FSGS/MCD, ADPKD, Alport) so the deterministic matcher can mark wrong-diagnosis trials as unlikely when those tags are set on the study and extracted into the patient profile.

Staff edit those fields through `app/trials/components/TrialPrescreenEditor.js`. The editor is embedded in both `app/trials/manage/StudyManagerClient.js` and `app/trials/approvals/edit/ApprovalEditClient.js`. `app/trials/approvals/ApprovalClient.js` shows the same data in read-only review form for approvals. Study drafts, submissions, and live studies all carry the `prescreen` object through the existing approvals pipeline.

ClinicalTrials.gov sync seeds a narrow set of defaults in `lib/trialSync.js`. Right now that sync only infers sex and min/max age from the CT.gov payload and leaves the rest of the prescreen object blank. `mergeSyncedPrescreen()` in the manage and approval edit clients preserves human-reviewed prescreen fields after a study has already been synced once. Future agents should keep that human-first behavior intact.

## Matching rules and current edge cases

The matcher does not exclude studies just because the prescreen object is blank. If a study lacks structured criteria, `matchTrialToPatient()` returns an `insufficient_info` result (no automated match reasons) instead of dropping the study from the assistant entirely. That behavior keeps recruiting studies visible while the staff team fills in matching metadata.

The exclusion workflow has a specific rule that already caused one regression. If a study marks `exclusionTags` as `mustAsk`, the patient profile must carry `exclusionScreeningComplete === true` before the matcher will stop asking about major exclusions. That flag lives in `lib/patientProfileSchema.js` and is part of the structured LLM response.

The old per-study `prescreen.enabled` flag no longer exists in the live schema or queries. Some compatibility code and older test fixtures still pass an `enabled` property through helper functions. Another agent should not reintroduce that flag unless the product requirement changes.

## Privacy and safety rules

Patient details stay ephemeral. The public flow does not write transcripts, patient profiles, or chat outputs to Sanity. The assistant must only expose public-safe `prescreen.screeningSummary`, `laySummary`, and other public study metadata. It must not expose clinician-only or coordinator-only fields such as internal communication summaries.

PII redaction in `app/api/trials/match/chat/route.js` is best-effort string replacement, not a formal privacy guarantee. The public UI still tells users to avoid names, exact birth dates, contact details, and record numbers. The rate limiter is a process-local `Map`, so it resets on restart and is not shared across instances.

## Key files

- `app/components/TrialAssistantWidget.js`: floating public widget, launcher, minimize behavior, optional voice dictation (Web Speech API), client-side chat state, accessibility behavior
- `app/layout.js`: global mount point for the widget and small-screen bottom spacing
- `app/api/trials/match/chat/route.js`: public API, PII redaction, rate limiting, toggle check, LLM call, deterministic ranking
- `app/trials/find/page.js`: informational fallback page for the assistant
- `lib/summaries.js`: structured LLM prompts, `generateTrialMatchConversation()`, `generateTrialMatchStudyRanking()`, and `buildTrialEligibilityCatalogForPrompt()`
- `lib/patientProfileSchema.js`: patient profile schema, normalization, summary chips, exclusion-screening flag
- `lib/trialMatcher.js`: deterministic trial matching and ranking logic
- `lib/trialPrescreen.js`: prescreen option lists, labels, empty state, form normalization
- `lib/trialMatchingSettings.js`: feature-flag check for the assistant
- `lib/sanity.js`: `queries.siteSettings` and `queries.trialMatchingStudies`
- `lib/trialSync.js`: ClinicalTrials.gov sync and prescreen seeding
- `app/trials/components/TrialPrescreenEditor.js`: staff editor for structured matching fields
- `app/trials/manage/StudyManagerClient.js`: coordinator workflow for editing live studies and syncing CT.gov data
- `app/trials/approvals/edit/ApprovalEditClient.js`: approval-side editing workflow for pending submissions
- `app/trials/approvals/ApprovalClient.js`: read-only approval review for prescreen fields
- `sanity/schemas/siteSettings.js`: global assistant toggle
- `sanity/schemas/trialSummary.js`, `sanity/schemas/studyDraft.js`, `sanity/schemas/studySubmission.js`: structured `prescreen` schema fields
- `tests/trialMatcher.test.js`: matcher regression tests
- `docs/trial-matching-pilot.md`: coordinator beta checklist and validation scenarios

## Verification and troubleshooting

Start with the feature flag. If the widget is missing locally or in preview, inspect the current `siteSettings` document and check `trialMatchingAssistant.enabled`. A missing field reads as disabled. During local work, another agent can inspect the setting with:

```sh
node --env-file=.env.local --input-type=module -e "import { client, queries } from './lib/sanity.js'; const settings = await client.fetch(queries.siteSettings); console.log(JSON.stringify(settings?.trialMatchingAssistant ?? null, null, 2));"
```

An agent can enable it with:

```sh
node --env-file=.env.local --input-type=module -e "import { client, writeClient } from './lib/sanity.js'; const settings = await client.fetch('*[_type == \"siteSettings\"][0]{ _id }'); await writeClient.patch(settings._id).set({ trialMatchingAssistant: { enabled: true } }).commit();"
```

For code verification, the current focused check is `node --test tests/trialMatcher.test.js`. Run `npm run lint` after non-trivial changes when the local toolchain is healthy. Manual verification should include the homepage auto-open behavior, minimized launcher behavior on another public page, hidden behavior on admin pages, and a `503` response from `app/api/trials/match/chat/route.js` when the toggle is off.
