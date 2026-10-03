# Multi-site study coordination

Status: implemented in code on 2026-10-03; waiting on the Studio redeploy and the data migration below. This page started as the plan and now describes what was built and how to roll it out.

## The problem

Studies are coordinated out of two separate sites, Victoria Hospital and University Hospital. Each site has its own principal investigators and coordinators and collects its own startup fees. Most studies belong to one site. Some have a PI and a coordinator team at both sites, and those teams do not necessarily collaborate. Referring clinicians know which site they are sending a patient to, because there is financial competition between the sites.

Where a study recruits is a separate matter. A University Hospital study can enrol patients at University Hospital, Victoria Hospital or Westmount (the Kidney Care Centre).

## The model

- **Study team.** One per coordinating site, on `trialSummary.siteTeams`: the site, the team's enrolment status (enrolling, not yet enrolling, closed), its principal investigator (team roster or free text), its coordinator contact with a "display publicly" switch, and whether the team takes referrals. Each site starts up on its own, so one team can be enrolling while the other is still contracting.
- **Recruitment locations.** `trialSummary.recruitmentSites`: where patients can be seen and enrolled. Independent of the teams.
- **Sites.** The existing `site` documents gained two switches: "Coordinates studies" (Victoria Hospital, University Hospital) and "Patients can be enrolled here" (both hospitals, Westmount). The subscriber "Location of practice" list and the capabilities page are unchanged.
- **Researchers.** Optional "Primary study site", used only as the default site when an investigator is chosen as a team's PI, and by the migration.
- **Referrals.** Each `studyReferral` records the team that received it.

The single PI, local contact and "accepts referrals" fields are legacy. The app reads teams only through `lib/studyTeams.js`, which builds one team from those fields on any record the migration has not reached, and never writes them again.

## What staff see

- The Study Manager and the approval editor have a "Study teams" card with one panel per team and "Add a team at another site", plus a "Recruitment locations" card. Choosing a PI pre-selects their primary site. Validation says which team and field needs attention.
- The study list shows a chip per team (site short name, amber "No site" for migrated teams that still need one), a "Change pending" chip, a site filter, and search by site or PI.
- Opening a study that has a pending change starts the form from that change: "Changes by X are awaiting approval. Your edits build on them." Submitting while a newer change exists is refused with a reload button. An approval admin publishing directly closes the pending changes their version includes; rejecting a submission brings back the one it superseded.
- Approvers see, for every update, what the submission changes on the live study, grouped by team, in the approvals list, in the editor and in the approval email.
- A coordinator who enters an NCT ID another site already registered is offered "Open this study and add my team"; the team they were typing comes with them.

## What clinicians see

- Study cards and the study page show each team's investigator with the site, "starting soon" for a team not yet enrolling, and "Patients can be seen at" the recruitment locations.
- The study page has one block per team with its public contact. When more than one team takes referrals, the referral form asks which team should follow up, labelled "Investigator, Site team". The confirmation and the coordinator's email name the receiving site.
- The monthly study update email names each PI with their site, lists where patients can be seen, and has one "Refer a patient" button per team that takes referrals (labelled by investigator and site when a study has several teams). The buttons stay mailto links, by decision.
- Hidden coordinator emails and phone numbers no longer reach the browser or the markdown endpoints. Only a contact marked public is projected.

## Rollout

1. Deploy the app. Everything falls back to the legacy fields until the migration runs, so nothing changes for existing studies yet.
2. Redeploy Sanity Studio so the new fields appear.
3. In Studio, mark Victoria Hospital and University Hospital as "Coordinates studies" and every enrolment place (both hospitals, Westmount / KCC) as "Patients can be enrolled here". Confirm the site names and short names; the public pages use the full name, the staff tools the short name.
4. In Studio, set "Primary study site" on each clinical investigator and publish.
5. Run `npm run migrate:site-teams`. It prints one line per study: the site it inferred and from whom, or why it could not. Fix what the lines point at (an unpublished researcher draft, a PI outside the roster), rerun, then `npm run migrate:site-teams -- --apply`.
6. Studies that still have no coordinating site show an amber chip in the Study Manager; a coordinator picks the site on their next edit. Approval admins can also set it in Studio.
7. Once every study has a team with a PI, run `npm run migrate:site-teams -- --apply --remove-legacy`. Later, remove the legacy fields from `sanity/schemas/trialSummary.js` and the legacy branches from `studyTeamsProjection` and `lib/studyTeams.js`.

## Verification

- `npm test` covers the teams module (legacy fallback, validation, referral routing, public contact, change summary), the submission normalizer and document builders, the update email, and the migration planner.
- Manual pass on a preview deployment: create a two-team study, approve it, check the list and study page, send a referral to each team, open both PIs' profile pages, load `/trials/<slug>.md`, and run the study update dispatch in `dryRun`.

## Key files

- Model and rules: `lib/studyTeams.js`, `lib/studySubmissions.js`, `lib/studyApprovals.js`, `lib/studyRevalidation.js`, `lib/sanity.js` (`studyTeamsProjection`, `STUDY_TEAMS_STAFF_PROJECTION`, `STUDY_STAFF_PROJECTION`).
- Schemas: `sanity/schemas/trialSummary.js`, `site.js`, `researcher.js`, `studyReferral.js`, `studyPayloadTeams.js` (shared by `studySubmission.js` and `studyDraft.js`).
- Staff tools: `app/trials/components/StudyTeamsFieldset.js`, `studyFormModel.js`, `app/trials/manage/StudyManagerClient.js`, `app/trials/approvals/ApprovalClient.js`, `app/trials/approvals/edit/ApprovalEditClient.js`, `app/api/trials/manage/route.js`, `app/api/trials/approvals/route.js`, `app/api/trials/approvals/submission/route.js`, `app/api/trials/approvals/quick/route.js`.
- Public: `app/trials/TrialCards.js`, `app/trials/TrialsClient.js`, `app/trials/[slug]/page.js`, `app/trials/[slug]/ReferralForm.js`, `app/api/referral/route.js`, `app/components/FeaturedStudy.js`, `app/markdown/[...path]/route.js`, `app/api/seo/refresh/route.js`.
- Emails: `lib/studyUpdateEmail.js`, `lib/studyUpdateEmailTemplate.js`, `app/api/updates/study-email/dispatch/route.js`.
- Migration: `scripts/migrate-site-teams.js`.

## Decisions taken

- Referrals with two accepting teams: the clinician chooses the team. No "no preference" option.
- The coordinating site is shown publicly beside each investigator, using the full site name.
- Per-team enrolment status exists; the study-level status remains the public headline.
- Coordinators are not restricted to their own site's team. The pending-change flow, the change summary for approvers and the reinstatement on rejection are the safeguards.
- The study update email keeps mailto links to each accepting team's contact.
