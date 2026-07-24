# Automated Research Digest

## Product goal

Send active subscribers who explicitly selected `research_digest` a short weekday email containing only the strongest new kidney research. By default the digest carries the single top paper of the day. Three papers is a hard ceiling that settings cannot exceed, and the system sends nothing when no paper clears the quality threshold.

Routine operation does not require staff review. The admin page at `/admin/research-digest` is diagnostics-only.

## Daily flow

1. `.github/workflows/research-digest.yml` starts the import at 10:00 UTC on weekdays.
2. `scripts/import-research-digest.js` scans the curated PubMed journal groups. Broad journal groups also require kidney-related title/abstract terms so general-medicine imports stay focused.
3. Clearly unsuitable publication types, including case reports, editorials, corrections, and retractions, are excluded before LLM triage.
4. The LLM assigns relevance, editorial tier, a conservative 0-100 daily priority score, summary copy, and topics. Triage runs as a bounded concurrent pool (`RESEARCH_DIGEST_TRIAGE_CONCURRENCY`, default 4).
5. `lib/researchDigest.js` automatically selects the highest-scoring qualifying papers, up to `maxPapers`, from a rolling pool of today's papers plus qualifying papers deferred from earlier days.
6. If at least one paper is selected, the issue becomes `approved`. If none qualify, the issue stays `draft` and no email is sent.
7. The workflow calls the dispatch route at 13:00 UTC. Workflow concurrency makes a delayed send wait for a still-running import.
8. The dispatch route sends only to deliverable subscribers who explicitly opted into the research digest.

## Selection rules

A paper is eligible only when all of the following are true:

- LLM relevance is `include`.
- The priority score is at least `minPriorityScore` (default `75`).
- The summary and “why it matters” copy are both present.
- LLM triage completed without an error.
- PubMed publication types do not identify a low-value format excluded by the deterministic filter.

Eligible papers are ordered by priority score, tier, publication date, and PMID. The default limit is one. `maxPapers` may raise that to a maximum of three; values above three are clamped rather than honoured. The selector never fills the quota with papers below the threshold.

Older imported papers without a priority score use a conservative tier fallback during a recovery rerun: Tier 1 = 90, Tier 2 = 75, and Tier 3 = 50.

## Carryover

Selection draws from a rolling pool, not just the papers imported that morning:

- Everything imported today, whatever its current selection status, so re-running selection for the same day is idempotent.
- Plus any paper discovered within the last `carryoverDays` (default `7`) that qualified but lost its slot. Those are marked `autoSelectionStatus: "deferred"`.

A paper that has already shipped (`autoSelectionStatus: "selected"` or `approvalStatus: "approved"`) never re-enters the pool, so nothing is sent twice. When a deferred paper is finally selected, its `issueDate` and `issue` reference move to the issue that ships it and `carriedOverFrom` records where it came from; `discoveredDate` always keeps the day it was first imported and bounds how long it stays eligible.

Deferred papers deliberately keep `approvalStatus: "rejected"`. `autoSelectionStatus` is the field that carries the real meaning; `approvalStatus` stays `rejected` so a deferred paper cannot leak into the email or archive queries, which all require `approved`, and so the admin "pending review" counters keep counting only genuine manual-review work.

Without this, a paper that scored 93 but lost to a 95 on a busy day was rejected permanently. That mattered little at three papers a day and a great deal at one.

Set `carryoverDays` to `0` to restore the older behaviour of only ever considering papers found that day.

## Settings

Settings live at `siteSettings.researchDigest`.

- `automaticSelection`: defaults to `true`.
- `maxPapers`: defaults to `1`, hard-capped at `3`.
- `minPriorityScore`: defaults to `75`.
- `carryoverDays`: defaults to `7`, capped at `30`. `0` disables carryover.
- `subjectTemplate`: defaults to `{{leadTitle}}{{andMore}} - {{date}}`. Available tokens are `{{leadTitle}}`, `{{leadTopic}}`, `{{andMore}}`, `{{date}}`, `{{paperCount}}`, `{{paperNoun}}`, `{{opportunityCount}}`, and `{{opportunityNoun}}`. A template using `{{leadTitle}}` falls back to a generic subject on days with no papers.
- `sendEmpty`: defaults to `false`.
- The dispatch route always requires an `approved` issue; automated selection grants that approval without staff action.
- `pilotMode`: defaults to `false`.
- `pilotRecipients`: used only when pilot mode is explicitly enabled.
- `llmProvider`, `llmModel`, and `llmApiKey`: optional digest-specific overrides.

Missing `researchDigest` settings use these safe automation defaults.

## Delivery and retries

- A successful recipient is immediately stamped with `lastResearchDigestSentAt`.
- Each issue-recipient send uses a deterministic Resend idempotency key so an accepted email is not duplicated if tracking fails.
- The issue is marked `sent` only when the whole delivery attempt completes without errors or provider skips.
- A partial failure returns a non-2xx response so GitHub Actions is visibly red.
- Rerun the `send` workflow without `force` to retry only recipients who were not already recorded as sent.
- `force` intentionally permits a full resend and should not be used for ordinary recovery.
- Missing daily issues and days without qualifying papers are successful skips, not workflow failures.
- A day with no opted-in recipients is also a successful skip and does not mark the issue as sent.

## Required configuration

The import job requires:

- `NEXT_PUBLIC_SANITY_PROJECT_ID`
- `NEXT_PUBLIC_SANITY_DATASET`
- `SANITY_API_TOKEN`
- A credential for the configured LLM provider
- `PUBMED_API_KEY` when available

The send job requires:

- `SITE_URL`
- `CRON_SECRET`
- `RESEARCH_DIGEST_SEND_TOKEN` for manual workflow sends

The deployed application also requires `SANITY_API_TOKEN` and `RESEND_API_KEY`.

## Email

Subscriber-facing copy deliberately excludes internal triage vocabulary; the editorial tier is never rendered in the email or on the public archive. Each paper shows its journal, a formatted publication date, why it matters, the summary, its topics, and a link to the paper.

Every send carries a `List-Unsubscribe` header pointing at the recipient's manage URL, which surfaces the native unsubscribe control in Gmail and Outlook. This is the header-only form, not RFC 8058 one-click; one-click would additionally need an endpoint that accepts a bare form POST.

## Failure behavior

The import workflow fails when every PubMed journal-group search fails or every paper requiring LLM classification fails triage. Partial source failures are reported in the GitHub job summary. A day with valid sources but no qualifying paper remains green and sends nothing.

The import job summary also reports the priority-score distribution for the selection pool and any journal group whose results were truncated by `RESEARCH_DIGEST_MAX_PUBMED_PER_GROUP`. The score distribution is the signal for whether `minPriorityScore` is still calibrated: if the count at or above 75 drifts toward zero or toward the whole pool, the threshold or the triage prompt needs revisiting rather than the volume silently changing.

The send workflow records the HTTP status and response body in its job summary. Recipient identifiers, rather than email addresses, are included in delivery errors.

## Optional diagnostics

`/admin/research-digest` and its API remain available for inspection and exceptional recovery. They are not part of the routine publishing path.

To re-run automated selection on an existing issue without re-importing every paper:

```bash
npm run reselect:research-digest
npm run reselect:research-digest -- --date=2026-07-10
```
