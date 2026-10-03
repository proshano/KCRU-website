# Multi-site study coordination plan

Status: proposal, not yet implemented. Written 2026-10-03 from a read of the current code.

## The problem

Studies are coordinated out of two separate sites, Victoria Hospital and University Hospital. Each site has its own principal investigators and its own coordinators, and each collects its own startup fees. Most studies belong to one site. Some studies will have a PI and a coordinator team at both sites, and those two teams do not necessarily collaborate.

Where a study recruits is a separate matter. A University Hospital study can enrol patients at University Hospital, Victoria Hospital, Westmount (the Kidney Care Centre, KCC, which has clinics and a dialysis unit), and so on.

Two concepts therefore need to exist independently on the website:

- **Study team at a coordinating site.** The site whose PI and coordinators run the study locally. One study can have one or two teams.
- **Recruitment location.** Any place where patients are seen and enrolled for the study.

## What the site does today

- A study (`trialSummary`) has exactly one `principalInvestigator` (reference) or `principalInvestigatorName` (free text), one `localContact` (name, role, email, phone, `displayPublicly`) and one `acceptsReferrals` switch.
- The schema already has a `recruitmentSites` array of `site` references, but nothing reads or writes it. The Study Manager, the approval editor, the submission and draft schemas, every GROQ query and every page ignore it. An earlier migration (`scripts/migrate-trial-fields.js`) removed `payload.recruitmentSiteIds` from submissions.
- `site` documents are used for two things: the "Location of practice" checkboxes when someone subscribes to study updates (`updateSubscriber.practiceSites`) and the patient-volume totals on the capabilities page. Their `type` list has values such as academic hospital and dialysis centre.
- Coordinators are a flat allowlist (`siteSettings.studyApprovals.coordinatorEmails`). Any coordinator can edit any study. Approval admins approve everything. Each coordinator has one autosaved draft.
- An update submission carries the whole study payload. A newer pending submission supersedes any older pending one, and approval writes the whole payload onto the study. If a Victoria coordinator submits a change and a University Hospital coordinator then submits their own change starting from the published study, the Victoria change is silently lost when the second submission is approved. Today this is rare. With two teams on one study it becomes systematic.
- Referrals (`/api/referral`) are emailed to `localContact.email` only. The study update email shows one "PI: name" line and one "Refer a patient" button that mails the same address.
- Public pages show one PI badge (study list, detail page, featured study on the homepage). The detail page shows the contact when `displayPublicly` is on. A researcher's profile lists studies where `principalInvestigator._ref` matches. Markdown endpoints, the SEO refresh and the JSON-LD schema use the single PI name.
- Privacy wrinkle: the list and detail queries project `localContact.email` even when the contact is not displayed publicly, and the detail page passes that email to the client-side referral form. The email is not shown, but it is in the page payload. The referral rework is a natural moment to stop that.

## Target model

### Sanity schema

1. **`site`** gains two role switches, both defaulting to off:
   - `coordinatesStudies`: "Study coordination site. Has its own PIs, coordinators and startup fees." Expected: Victoria Hospital, University Hospital.
   - `recruitsPatients`: "Patients can be enrolled for studies here." Expected: University Hospital, Victoria Hospital, Westmount / Kidney Care Centre, and any others.
   Nothing else about `site` changes, so the subscriber practice list and the capabilities page keep working. A new site type value `kidney_care_centre` is optional; `dialysis_centre` already exists.

2. **`researcher`** gains an optional `primarySite` reference. It is a default only, never a constraint. The Study Manager uses it to pre-select the team's site when a PI is chosen, and the migration uses it to guess the site of existing studies.

3. **`trialSummary`** gains `siteTeams`, an array of objects, one per coordinating site:
   - `site`: reference to a `site` with `coordinatesStudies == true`. Required.
   - `principalInvestigator`: reference to `researcher`, or `principalInvestigatorName` for a PI who is not on the team roster. One of the two is required.
   - `contact`: object with `name`, `role`, `email`, `phone`, `displayPublicly`. Same shape as today's `localContact`.
   - `acceptsReferrals`: boolean. Requires `contact.email`, as today.
   - `_key` is the site's `_id`, which keeps a team's identity stable across edits and makes "one team per site" a natural rule.
   Validation: at least one team, distinct sites, a PI per team.

   The existing `recruitmentSites` field keeps its name and becomes "Recruitment locations", with the reference filter `recruitsPatients == true && active == true`. Keeping the name avoids a data migration for a field that currently holds nothing.

   The legacy single fields (`principalInvestigator`, `principalInvestigatorName`, `localContact`, `acceptsReferrals`) stay through the transition, hidden in Studio once a study has `siteTeams`, and are removed in the last phase.

   The Studio preview subtitle adds the teams' site short names so Studio lists show "UH" or "UH, VH" at a glance.

4. **`studySubmission.payload`** and **`studyDraft.data`** gain `siteTeams` (with `siteId`, `principalInvestigatorId`, `principalInvestigatorName`, `contact`, `acceptsReferrals`, `_key`) and `recruitmentSiteIds`.

5. **`studyReferral`** gains a denormalized `team` object (`siteId`, `siteName`) so Studio shows which team received each referral.

Sanity Studio must be redeployed for the new fields to appear. The app reads and writes them regardless.

### Study status stays study-level

The user's framing treats recruitment status and recruitment place as separate from coordination. The existing `status` field (recruiting, coming soon, active not recruiting, completed) stays on the study. Recruitment locations are a list, not a per-location status. If a per-location status is ever needed it can be added to the `recruitmentSites` entries later without disturbing this design.

### Shared helper: `lib/studyTeams.js`

A browser-safe module, imported by pages, API routes, email templates and the client forms (the same split as `lib/peopleSettings.js` versus `lib/peopleSettingsStore.js`). It must not import `lib/sanity.js` or `lib/sites.js`, which are server-only.

- `resolveStudyTeams(study)`: returns `study.siteTeams` when present, otherwise synthesizes one team from the legacy fields with `_key: 'legacy'` and no site. Every consumer calls this, so each phase below can ship before the data is migrated.
- `listTeamInvestigators(teams)`: PI display entries (name, slug, photo, site short name) in team order.
- `teamsAcceptingReferrals(teams)`: teams with `acceptsReferrals` and a contact email.
- `studyAcceptsReferrals(study)`: true when any team accepts referrals. Replaces reads of the study-level switch.
- `teamLabel(team)`: the site's short name, else its name, else "Study team".
- `normalizeSiteTeams(rawTeams, { sites, researchers })` and `validateSiteTeams(teams)`: the payload normalization and the user-facing validation messages shared by the API and the forms.

### Staff tools

**Study Manager (`/trials/manage`, `/admin/studies`) and the approval editor.** The "Local Contact & PI" card becomes "Study teams":

- One panel per team: coordinating site (select, limited to coordination sites), principal investigator (the existing select with "Other"), contact name, role, email, phone, "Display contact publicly", "Accepts referrals". Choosing a PI with a `primarySite` pre-selects the site when the panel has none.
- "Add a team at another site" adds a second panel; the site select excludes sites already used. "Remove this team" on each panel, disabled when it is the only one.
- A "Recruitment locations" group of checkboxes listing sites with `recruitsPatients`.
- Validation messages come from `validateSiteTeams`, so the form and the API say the same thing.
- The autosaved draft, duplicate NCT check, ClinicalTrials.gov sync and the Clinical Communications card are untouched.

**API (`app/api/trials/manage/route.js`, `app/api/trials/approvals/route.js`).** GET projects `siteTeams` (with `siteId` and `principalInvestigatorId`) and `recruitmentSiteIds`, and adds `meta.sites` (id, name, short name, role flags) plus `primarySiteId` on each researcher. POST and PATCH validate teams against the site list through `normalizeStudyPayload`, which replaces today's "principal investigator is required" check with "at least one team with a PI". The approval notification email lists one row per team (site, PI, contact, accepts referrals) and a "Recruitment locations" row. The approvals list (`ApprovalClient`) shows the same per-team summary.

**`lib/studySubmissions.js` and `lib/studyApprovals.js`.** `normalizeStudyPayload`, `buildPatchFields`, `buildUnsetFields` and the create path in `reviewSubmission` write `siteTeams` and `recruitmentSites` references and, during the transition, mirror team one into the legacy fields so an unmigrated reader still sees a PI. The admin bypass path, which publishes immediately, uses the same builders.

**Pending-change awareness.** To stop two teams overwriting each other, GET also returns the latest pending submission for each study. When a coordinator opens a study with a pending submission, the form starts from the pending payload and shows a banner: "Changes by name, submitted on date, are awaiting approval. Your edits build on them." The approval email already says when a submission supersedes an earlier one. This is a small change and it protects both teams without needing to know which coordinator belongs to which site.

### Public pages

- **Study list (`TrialCards.js`).** One PI badge per team, each suffixed with the site short name when the study has more than one team. Recruitment locations appear as a muted line ("Patients seen at: University Hospital, Westmount") when set.
- **Study detail page.** PI badges in the header as on the cards. In the recruiting call-to-action block, one contact block per team whose contact is public, headed by the site name. A "Where patients are seen" line lists the recruitment locations. The JSON-LD `principalInvestigator` becomes an array when there are several PIs.
- **Referral form and `/api/referral`.** The form receives only `teams: [{ key, label, acceptsReferrals }]`, never an email. When more than one team accepts referrals it shows a required choice, "Which study team should follow up?", listing the sites. When one team accepts, there is no choice. The request carries `teamKey`; the server resolves the team's contact email with a server-only query, stores the team on the `studyReferral`, and puts the site name in the email subject. A `teamKey` that does not match, or a missing key when several teams accept, is a 400.
- **Featured study on the homepage.** PI names joined with "and".
- **Researcher profile.** The `studies` subquery in `researcherBySlug` matches either the legacy reference or `^._id in siteTeams[].principalInvestigator._ref`.
- **Markdown endpoints and SEO refresh.** One "Principal investigator" line per team with the site, a contact section per public contact, and a "Recruitment locations" line. The SEO summary input lists all PI names.
- **Trial matching assistant.** No change in this pass. Showing recruitment locations in its results is a cheap later addition once the data exists.
- **Privacy tightening.** Public queries project `contact.email` and `contact.phone` only when `displayPublicly` is true, using a GROQ `select()`. The server-only `trialCoordinator` query is the one place that reads every team's email.

### Study update emails (promotion)

- The dispatch query projects `siteTeams` with each team's site short name, PI and contact email.
- The study block shows "PI: Dr. A (UH), Dr. B (VH)". With one team accepting referrals, the single "Refer a patient" button stays. With two, there are two buttons, "Refer a patient (University Hospital team)" and "Refer a patient (Victoria Hospital team)", each a mailto to that team's coordinator. The `canShowReferralLink` and `buildStudyReferralMailto` helpers in `lib/studyUpdateEmail.js` are applied per team.
- `pickStudiesForSubscriber` keeps a study when any team accepts referrals.
- A later option, not in this plan: order the referral buttons by the subscriber's `practiceSites`, since subscribers already say where they practise.

### Migration: `scripts/migrate-site-teams.js`

Run as `npm run migrate:site-teams` (dry run, prints counts and ids only) and `npm run migrate:site-teams -- --apply`.

1. For every `trialSummary` without `siteTeams`, including `drafts.*` copies: build one team from the legacy fields. The site is the PI's `primarySite` when the PI is a referenced researcher with one set; otherwise the team has no site and the study is reported under "needs a coordinating site". `_key` is the site id when known, else `legacy`.
2. For every pending `studySubmission` and every `studyDraft`: the same conversion on `payload` and `data`. Approved and rejected submissions are history and are left alone.
3. Studies with a team but no site show a "Coordinating site not set" warning in the Study Manager and the approvals list until a coordinator fixes them. The public pages simply omit the site label for such a team.
4. `npm run migrate:site-teams -- --apply --remove-legacy` unsets the legacy fields. It refuses to run while any study lacks `siteTeams`, and it skips a study whose team still has no site, so the legacy PI is never dropped before its replacement is complete.

The script follows the existing migration conventions: dry run by default, `scripts/_preload-env.js` for env loading, `SANITY_API_TOKEN` required for `--apply`, and one revision-guarded patch per document.

### Access control: deliberately unchanged in this pass

Coordinators keep the flat allowlist and can still edit any study. The pending-change banner handles the overwrite problem. If the two teams later need hard separation, the extension is: a per-site coordinator list in `/admin/people` (`studyApprovals.siteCoordinators`), a `coordinatorSiteIds` flag on the session, and a server rule that a coordinator may only change the team panel for their own sites. Nothing in this plan blocks that, and `_key` equal to the site id makes the server-side merge simple.

## Decisions to confirm

Each has a recommended default. The plan is written against the defaults.

1. **Referral with two accepting teams.** Default: the clinician chooses the team on the form and in the email. Alternative: send every referral to both teams and let them sort it out.
2. **Show the coordinating site publicly.** Default: yes, as the site short name beside each PI, and only when a study has more than one team. Alternative: never label PIs with a site.
3. **Restrict coordinators to their own site's team.** Default: no, rely on the pending-change banner and approval review. See "Access control".
4. **Recruitment status per location.** Default: no, status stays study-level.
5. **Public filter by recruitment location on `/trials`.** Default: not now. Cheap to add later next to the therapeutic area pills.
6. **Site records.** Confirm the `site` documents and their short names before the migration runs: "University Hospital" (UH), "Victoria Hospital" (VH), "Westmount / Kidney Care Centre" (KCC). Only the first two get `coordinatesStudies`. All three get `recruitsPatients`. The container used for this plan has no Sanity credentials, so the live list was not checked.
7. **Which researchers get a `primarySite`.** Set it in Studio for every clinical investigator before the migration so most existing studies get their site automatically.

## Phases

Each phase is deployable on its own because `resolveStudyTeams` falls back to the legacy fields.

**Phase 1, data model.** `site` role flags, `researcher.primarySite`, `trialSummary.siteTeams` and the retitled `recruitmentSites`, submission and draft payload fields, `studyReferral.team`, `lib/studyTeams.js` with tests, the migration script. Deploy, redeploy Studio, set site flags and PI primary sites in Studio, run the migration dry run, then apply.

**Phase 2, staff tools.** Study Manager and approval editor team panels and recruitment locations, API validation and projections, approval email and approvals list, pending-change banner, `lib/studySubmissions.js` and `lib/studyApprovals.js` changes with tests.

**Phase 3, public pages and emails.** Cards, detail page, referral form and API, featured study, profile studies query, markdown and SEO, JSON-LD, study update email template and dispatch, privacy tightening of the public queries.

**Phase 4, cleanup.** Run `--remove-legacy`, remove the legacy fields from the schema and queries, drop the mirroring in the patch builders, update `AGENTS.md` and `README.md`.

## Tests and verification

Unit tests with `node:test`, in the existing `tests/` style:

- `tests/studyTeams.test.js`: legacy fallback, team labels, referral team selection, validation messages (missing site, duplicate site, missing PI, referrals without email).
- `tests/studySubmissions.test.js`: `normalizeStudyPayload` with zero, one and two teams; legacy payloads still normalize; `buildPatchFields` and `buildUnsetFields` output.
- `tests/studyUpdateEmail.test.js`: one and two referral buttons, PI line with site labels.
- The migration's pure conversion function, tested on a legacy study with and without a known primary site.

Before each push: `npm run lint`, `npm test`, `npm run build`. Then a manual pass on a preview deployment: create a two-team study in the Study Manager, approve it, check the study list and detail page, send a referral to each team, open both PIs' profile pages, load `/trials/<slug>.md`, and run the study update dispatch in `dryRun`.

## Files touched

- Schema: `sanity/schemas/site.js`, `researcher.js`, `trialSummary.js`, `studySubmission.js`, `studyDraft.js`, `studyReferral.js`.
- Shared logic: new `lib/studyTeams.js`; `lib/studySubmissions.js`; `lib/studyApprovals.js`; `lib/studyUpdateEmail.js`; `lib/studyUpdateEmailTemplate.js`; `lib/sanity.js` queries `trialSummaries`, `recruitingTrials`, `trialBySlug`, `trialCoordinator`, `researcherBySlug`, `seoTrials`.
- API: `app/api/trials/manage/route.js`, `app/api/trials/approvals/route.js`, `app/api/referral/route.js`, `app/api/updates/study-email/dispatch/route.js`, `app/api/seo/refresh/route.js`.
- Staff UI: `app/trials/manage/StudyManagerClient.js`, `app/trials/approvals/edit/ApprovalEditClient.js`, `app/trials/approvals/ApprovalClient.js`.
- Public UI: `app/trials/TrialCards.js`, `app/trials/[slug]/page.js`, `app/trials/[slug]/ReferralForm.js`, `app/components/FeaturedStudy.js`, `app/team/[slug]/page.js`, `app/markdown/[...path]/route.js`.
- Scripts and docs: new `scripts/migrate-site-teams.js` and its `package.json` entry; `AGENTS.md`; `README.md`.

## AGENTS.md section to add once implemented

"Studies and site teams": a study has one or more `siteTeams`, one per coordinating site (a `site` with `coordinatesStudies`), each with its own PI, contact and referral switch, and a separate `recruitmentSites` list of places where patients are enrolled (sites with `recruitsPatients`). Read teams only through `resolveStudyTeams` in `lib/studyTeams.js`, never from the legacy single PI and contact fields. Referrals carry a `teamKey` and go to that team's contact only. Public queries project a contact's email and phone only when `displayPublicly` is true. The Study Manager starts from the latest pending submission when one exists so one team's edit never drops another's.
