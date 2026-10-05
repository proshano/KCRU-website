# Trial matching assistant handoff

The trial matching assistant is a public chat prescreener for non-identifying patient characteristics. It asks focused follow-up questions, builds a structured patient profile in memory, and ranks recruiting studies from the local roster. The LLM handles conversation and shortlist generation. If shortlist generation fails, the fallback matcher in `lib/trialMatcher.js` uses public study text only.

## Current public experience

The public entry point is the floating widget in `app/components/TrialAssistantWidget.js`, mounted globally from `app/layout.js`. It auto-opens on `/`, stays available in the bottom-right corner across public pages, and can be minimized to a launcher. Where the browser supports it, a microphone control uses the Web Speech API (`en-CA`) for dictation into the message field. The widget state lives in client state, so it persists during client-side navigation and resets on a full reload.

The widget is intentionally hidden on `/admin`, `/login`, `/protected`, `/trials/manage`, `/trials/approvals`, `/updates/admin`, and `/under-construction`. The route `/trials/find` is a noindexed fallback page that points visitors back to the floating widget.

## Gating and study roster

The feature only mounts when `siteSettings.trialMatchingAssistant.enabled` is true. `lib/trialMatchingSettings.js` treats any missing value as false, so older datasets can have a valid `siteSettings` document with `trialMatchingAssistant: null` and still hide the widget.

The public chat model is configured separately from the study-summary and publication-classification workflows. `siteSettings.trialMatchingAssistant.llmProvider`, `.llmModel`, and `.llmApiKey` override the older trial-summary LLM fields for this assistant only. If those assistant fields are blank, the API falls back to trial-summary LLM settings and then the general summary settings for backward compatibility.

The public assistant only sees studies returned by `queries.trialMatchingStudies` in `lib/sanity.js`. That query filters to `status == "recruiting"` and returns public study fields only:

- title
- lay summary
- inclusion criteria

Coming soon and active-not-recruiting studies do not participate in the public chat flow even though the matcher itself can technically score any study object it receives.

## Request and ranking flow

`app/components/TrialAssistantWidget.js` posts the current chat history and the in-memory patient profile to `app/api/trials/match/chat/route.js`. Both public routes start with `prepareTrialMatchRequest()` in `lib/trialMatchApi.js`, which claims the durable per-origin and aggregate rate limits, reads the bounded JSON body, and loads `siteSettings` plus the recruiting study roster from Sanity in one round of concurrent calls (the Sanity reads used to wait for both claims to finish). The aggregate claim is only made once the per-origin claim has passed, so a throttled origin cannot spend the shared hourly budget. If the assistant toggle is off, it returns a `503`. The per-origin budget is 30 requests per 15 minutes, because a turn that produces results costs two requests.

`generateTrialMatchConversation()` in `lib/summaries.js` sends the sanitized conversation, a compact study catalog from `buildTrialCatalogForPrompt()`, and inclusion excerpts from `buildTrialEligibilityCatalogForPrompt()` to the configured LLM. The model returns JSON with three fields: `assistant_reply`, `ready_for_matching`, and `patient_profile`. `lib/patientProfileSchema.js` defines that profile contract and normalizes every field before the API uses it. The chat turn should run at `temperature: 0` and needs enough output budget for the full required `patient_profile` object. Gemini 3.x models on OpenRouter should use minimal excluded reasoning for trial matching; after changing models, verify compact shorthand such as `GFR 40 ACR 45 IgA` completes without a `length` finish.

The backend also does deterministic parsing for numeric urine protein data. If a user provides `ACR`, `PCR`, or timed urine protein excretion such as `1 g/day`, `app/api/trials/match/chat/route.js` merges a parsed `patient_profile.urineProtein` object into the in-memory profile before and after the LLM turn. Unlabeled user-provided ACR/PCR defaults to Canadian `mg/mmol`. Same-assay conversions between `mg/g`, `mg/mmol`, and `g/g` (PCR), plus `mg/day` and `g/day` for timed protein excretion, are exact enough for screening; ACR↔PCR and ratio↔timed-protein conversions are approximate only and are retained as soft context, not definitive eligibility proof.

If the user mentions albuminuria or proteinuria qualitatively but a likely study depends on a urine protein threshold, the route can ask one focused follow-up for a recent `ACR`, `PCR`, or `24-hour urine protein` value. If the user does not have a number, the route should not loop on that question. It should proceed with conservative ranking and keep threshold-dependent studies as `possible` until coordinator confirmation.

Once the route has a normalized patient profile, it decides whether to show matches. When it does, it does not rank inline: it answers `rankingPending: true` with an interim reply that lists what the profile holds (`buildRankingPendingReply()` in `lib/trialMatchRanking.js`, for example "Checking the recruiting studies for: IgA nephropathy, eGFR 45, ACR 90 mg/mmol."). The widget shows that reply, switches its loading row to "Ranking the recruiting studies", and posts the same transcript and profile to `app/api/trials/match/rank/route.js`. That route runs `rankStudiesForProfile()`: the twelve-study shortlist, then `generateTrialMatchStudyRanking()` in `lib/summaries.js`, a second LLM request with the patient profile plus a compact per-study payload built from title, lay summary, and inclusion criteria. The model returns up to six studies with a short “may fit” reason; studies travel under short aliases (`S1`, `S2`, ...) so the model does not spend output tokens echoing Sanity ids, repeats of the same study are dropped, and the ranking runs at low reasoning effort (medium measured 10–17.5 s per ranking on GPT-6 Luna against 7–9.5 s at low, with the same studies surfacing). This step is nondeterministic. Splitting the two LLM calls across two requests is what lets the widget acknowledge the message after the conversation turn (about 3–5 s) instead of staying silent until the ranking is done too.

If LLM ranking throws, the route falls back to `rankTrialMatches()` in `lib/trialMatcher.js`. The fallback matcher does not rely on staff-maintained matching metadata. It uses title, lay summary, and inclusion criteria to:

- reject obviously wrong-population studies, such as dialysis-only or transplant-only studies for clearly mismatched profiles
- favor disease-specific studies when the reported diagnosis clearly aligns with the study text
- keep broad studies available as `possible` or `insufficient_info` instead of dropping them entirely
- parse some study `ACR` / `PCR` / timed-protein threshold language and compare it conservatively against the structured urine protein profile; near-threshold or estimated cross-format values stay `possible`

When results are shown, the ranking route uses the fixed closing reply: `See the potential studies below. A coordinator would confirm final eligibility.` The widget appends it after the interim reply, so the chat route's completion guard, which looks for that line in the last assistant message, still works. The LLM in these calls generates output at roughly 50–90 tokens a second, so output tokens are what the person waits on; keep the structured outputs small when changing the prompts.

## Staff workflow

Staff no longer enter trial-matching metadata in the Study Manager or approvals editor. The assistant operates from the existing public study record instead of any assistant-specific fields.

ClinicalTrials.gov sync still refreshes inclusion and exclusion criteria plus the synced CT.gov payload in `lib/trialSync.js`, but the assistant does not depend on any separate study-matching metadata object. Do not add new staff-only assistant fields unless product requirements explicitly change.

## Privacy and safety rules

Patient details stay ephemeral. The public flow does not write transcripts, patient profiles, or chat outputs to Sanity. The assistant must only expose public-safe study metadata such as title, `laySummary`, and inclusion criteria. It must not expose clinician-only or coordinator-only fields such as internal communication summaries.

The public UI tells users to avoid names, exact birth dates, contact details, and record numbers; the routes bound the transcript but do not try to scrub it (see `sanitizeTrialMatchMessages`). The rate limiter stores hashed claims in Sanity (`lib/securityRateLimit.js`), so it is shared across instances and survives restarts.

## Key files

- `app/components/TrialAssistantWidget.js`: floating public widget, launcher, minimize behavior, optional voice dictation, client-side chat state
- `app/layout.js`: global mount point for the widget and small-screen bottom spacing
- `app/api/trials/match/chat/route.js`: public chat API, conversation turn, follow-up selection, and the `rankingPending` handover
- `app/api/trials/match/rank/route.js`: public ranking API for the second half of a results turn
- `lib/trialMatchApi.js`: rate limits, body bounds, and Sanity context shared by both routes
- `lib/trialMatchRanking.js`: shortlist, interim reply, LLM ranking with rule-based fallback, closing replies
- `app/trials/find/page.js`: informational fallback page for the assistant
- `lib/summaries.js`: structured LLM prompts, `generateTrialMatchConversation()`, `generateTrialMatchStudyRanking()`, and `buildTrialEligibilityCatalogForPrompt()`
- `lib/patientProfileSchema.js`: patient profile schema, normalization, summary chips
- `lib/trialMatcher.js`: deterministic fallback matching and ranking logic
- `lib/urineProtein.js`: deterministic urine protein parsing, conversion, threshold extraction, and conservative comparison helpers
- `lib/trialMatchingSettings.js`: feature-flag check and assistant-specific LLM setting resolution
- `lib/sanity.js`: `queries.siteSettings` and `queries.trialMatchingStudies`
- `lib/trialSync.js`: ClinicalTrials.gov sync and study import pipeline
- `app/trials/manage/StudyManagerClient.js`: coordinator workflow for editing live studies and syncing CT.gov data
- `app/trials/approvals/edit/ApprovalEditClient.js`: approval-side editing workflow for pending submissions
- `app/trials/approvals/ApprovalClient.js`: approval review list
- `sanity/schemas/siteSettings.js`: global assistant toggle and assistant-specific LLM settings
- `tests/trialMatcher.test.js`: fallback matcher regression tests
- `tests/urineProtein.test.js`: urine protein parsing and conversion regression tests
- `docs/trial-matching-pilot.md`: coordinator beta checklist and validation scenarios

## Verification and troubleshooting

Start with the feature flag. If the widget is missing locally or in preview, inspect the current `siteSettings` document and check `trialMatchingAssistant.enabled`. A missing field reads as disabled.

For code verification, the current focused checks are:

- `node --test tests/trialMatcher.test.js`
- `node --test tests/urineProtein.test.js`
- `node --test tests/trialMatchPromptBuilders.test.js`
- `npm run lint`

Manual verification should include the homepage auto-open behavior, minimized launcher behavior on another public page, hidden behavior on admin pages, and a `503` response from `app/api/trials/match/chat/route.js` when the toggle is off.
