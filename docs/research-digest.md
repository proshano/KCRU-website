# Automated Research Digest

## Product goal

Send active subscribers who explicitly selected `research_digest` a short weekday email containing only the strongest new kidney research papers. The system should send no more than three papers by default and should send nothing when no paper clears the quality threshold.

Routine operation does not require staff review. The admin page at `/admin/research-digest` is diagnostics-only.

## Daily flow

1. `.github/workflows/research-digest.yml` starts the import at 10:00 UTC on weekdays.
2. `scripts/import-research-digest.js` scans the curated PubMed journal groups. Broad journal groups also require kidney-related title/abstract terms so general-medicine imports stay focused.
3. Clearly unsuitable publication types, including case reports, editorials, corrections, and retractions, are excluded before LLM triage.
4. The LLM assigns relevance, editorial tier, a conservative 0-100 daily priority score, summary copy, and topics.
5. `lib/researchDigest.js` automatically selects the highest-scoring qualifying papers, up to `maxPapers`.
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

Eligible papers are ordered by priority score, tier, publication date, and PMID. The default limit is three. The selector never fills the quota with papers below the threshold.

Older imported papers without a priority score use a conservative tier fallback during a recovery rerun: Tier 1 = 90, Tier 2 = 75, and Tier 3 = 50.

## Settings

Settings live at `siteSettings.researchDigest`.

- `automaticSelection`: defaults to `true`.
- `maxPapers`: defaults to `3`.
- `minPriorityScore`: defaults to `75`.
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

## Failure behavior

The import workflow fails when every PubMed journal-group search fails or every paper requiring LLM classification fails triage. Partial source failures are reported in the GitHub job summary. A day with valid sources but no qualifying paper remains green and sends nothing.

The send workflow records the HTTP status and response body in its job summary. Recipient identifiers, rather than email addresses, are included in delivery errors.

## Optional diagnostics

`/admin/research-digest` and its API remain available for inspection and exceptional recovery. They are not part of the routine publishing path.

To re-run automated selection on an existing issue without re-importing every paper:

```bash
npm run reselect:research-digest
npm run reselect:research-digest -- --date=2026-07-10
```
