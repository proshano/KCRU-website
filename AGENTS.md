# AGENTS.md

## Project Overview
A clinical research team website built with Next.js (App Router), Sanity CMS, and Tailwind CSS. Data sources include PubMed, ClinicalTrials.gov, and OpenAlex with cached results in `runtime/`.

## Development Ethos
- Prioritize maintainability.
- Optimize for ease of use by nontechnical research staff.
- Favor stable patterns that minimize breakage when dependencies or frameworks update.
- Prefer well-supported Next.js/Sanity patterns over custom or experimental approaches.
- Keep editable content in Sanity when staff need to change it; avoid hard-coded copy.
- After major changes, review and update this file (`AGENTS.md`) for consistency.

## Key Paths
- `app/` pages/layouts and API route handlers (`app/api/**/route.js`)
- `app/admin/` admin hub and `/admin/*` entry points
- `app/components/` shared UI components
- `app/llms.txt/` LLM summary endpoint
- `app/markdown/` markdown endpoints (used via `.md` URLs)
- `lib/` data clients, caching, and shared helpers
- `sanity/` Sanity Studio config and schemas
- `scripts/` maintenance/migration scripts
- `runtime/` generated caches and lock/cancel files (do not edit by hand)
- `dist/` build output (do not edit)
 - `core` tracked binary artifact (avoid touching unless explicitly required)

## Conventions
- Server components by default; add `"use client"` only when needed.
- Keep data-fetching helpers in `lib/` and call them from pages or route handlers.
- Use Tailwind classes for styling unless a nearby component already uses `styled-components`.
- Node scripts are ESM (`"type": "module"`); use `import` syntax.
- Prefer `lib/sanity.js` for general reads/writes; `lib/sanity/client.js` is a no-CDN client for maintenance checks.

## Maintenance Mode
- Settings live in Sanity (`siteSettings.maintenanceMode`) and are read via `lib/sanity/client.js`.
- Under-construction flow uses `/under-construction`, `/api/maintenance`, and `/api/auth` (cookie `site-auth`).
- If you change this flow, keep it simple and stable so staff can toggle maintenance mode without dev help.
- During maintenance, allowlisted paths still resolve: `/llms.txt`, `/sitemap.xml`, `/robots.txt`, and markdown endpoints (`/markdown/*` and `*.md`).

## Contact & Email
- Contact form posts to `app/api/contact/route.js` and routes via Sanity `contactRouting`.
- Email delivery uses `lib/email.js` (Resend), optional reCAPTCHA, and PDF-only attachments (6MB max).
- Keep error states and form fields straightforward for nontechnical users.

## Study Updates
- Subscriber management uses `app/api/updates/manage/route.js` with `manageToken`.
- Dispatch runs via `/api/updates/study-email/dispatch` (cron is daily; handler sends on the 1st in local time).
- Requires `SANITY_API_TOKEN` to record send status.

## Newsletters
- Publication newsletter dispatch lives at `/api/updates/publication-newsletter/dispatch` with admin endpoints `/api/updates/publication-newsletter/admin` and `/api/updates/publication-newsletter/send`.
- Custom one-off newsletters send via `/api/updates/custom-newsletter` (filters by role/specialty/interest areas).
- Settings live in `siteSettings.publicationNewsletter`; send tracking uses `updateSubscriber.lastPublicationNewsletterSentAt` and `updateSubscriber.lastNewsletterSentAt`.

## Admin Access
- Admin hub at `/admin` with module-specific entry points at `/admin/approvals` and `/admin/updates`.
- Legacy admin URLs `/trials/approvals` and `/updates/admin` remain supported.
- Admin sessions are scoped to approvals vs updates based on `siteSettings.studyApprovals.admins` and `siteSettings.studyUpdates.admins`.
- `app/api/admin/login/route.js` and `app/api/admin/verify/route.js` accept a `scope` to limit access (`approvals`, `updates`, or `any`).
- `app/api/admin/access/route.js` returns the current session's access flags for the admin hub.

## Aliases & File Types
- `@/` path aliases are defined in `jsconfig.json` and `tsconfig.json`.
- Project mixes JS/TS; keep a feature's files consistent when editing.

## Environment & Secrets
- `.env.local` holds secrets (Sanity tokens, API keys). Never commit or echo values.
- Mutations require `SANITY_API_TOKEN` (used by `writeClient` in `lib/sanity.js`).
- `NEXT_PUBLIC_SANITY_PROJECT_ID` and `NEXT_PUBLIC_SANITY_DATASET` are required for the app, Studio, and scripts (no fallbacks).
- Studio cache tooling that queries Sanity directly needs `SANITY_STUDIO_PROJECT_ID` and `SANITY_STUDIO_DATASET`.

## Sanity Content Model
- Schemas live in `sanity/schemas/` and are registered in `sanity/schemas/index.js`.
- Singletons include `siteSettings`, `capabilities`, `referralInfo`, `pubmedCache`, `pageContent`.
- Collections include `researcher`, `newsPost`, `trialSummary`, `therapeuticArea`, `traineeOpportunity`, `alumnus`, `site`, and study/update records.

## Common Commands
- `npm run dev`, `npm run lint`, `npm run build`
- PubMed cache: `npm run refresh:pubmed`, `npm run clear:pubmed`, `npm run upload:pubmed`

## Data Refresh
- PubMed cache file: `runtime/pubmed-cache.json` with lock/cancel files.
- If cache changes are needed, use the scripts rather than editing files directly.
- Sanity Studio includes a Site Settings action to refresh SEO metadata (configure `SANITY_STUDIO_SEO_REFRESH_URL` and `SANITY_STUDIO_SEO_REFRESH_TOKEN`).

## Cron Jobs
- Scheduled routes are defined in `vercel.json`.
- `/api/pubmed/refresh` uses `CRON_SECRET` (cron) or `PUBMED_REFRESH_TOKEN` (manual POST).
- `/api/seo/refresh` auto-generates SEO/LLM summaries and snapshots publication topics/highlights for llms.txt/markdown (manual via `SEO_REFRESH_TOKEN`; requires `SANITY_API_TOKEN`). To keep within the 2-cron limit, enable optional piggybacking on `/api/pubmed/refresh` by setting `SEO_REFRESH_ON_PUBMED_CRON=true`.
- `/api/updates/study-email/dispatch` is the daily email dispatch cron.

## Testing
- No dedicated test suite; run `npm run lint` for non-trivial changes.
- Preferred lint check: `npm run lint` (uses ESLint flat config via `eslint.config.js`).
