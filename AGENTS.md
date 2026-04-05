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
- Public navigation and dense link collections intentionally use `prefetch={false}` in several places to limit background requests and Vercel invocation noise; do not re-enable broad automatic prefetching without checking production impact.

## Maintenance Mode
- Settings live in Sanity (`siteSettings.maintenanceMode`) and are read via `lib/sanity/client.js`.
- Under-construction flow uses `proxy.js`, `/under-construction`, `/api/maintenance`, and `/api/auth` (cookie `site-auth`).
- If you change this flow, keep it simple and stable so staff can toggle maintenance mode without dev help.
- During maintenance, allowlisted paths still resolve: `/llms.txt`, `/sitemap.xml`, `/robots.txt`, and markdown endpoints (`/markdown/*` and `*.md`).
- `proxy.js` intentionally excludes API/static asset requests from the matcher to reduce Vercel middleware invocations; keep the matcher tight if you add new public asset types.
- The proxy's maintenance fetch is hardened for non-OK and non-JSON responses, especially on preview deployments; preserve that defensive behavior if you refactor it.

## Contact & Email
- Contact form posts to `app/api/contact/route.js` and routes via Sanity `contactRouting`.
- Email delivery uses `lib/email.js` (Resend), optional reCAPTCHA, and PDF-only attachments (6MB max).
- Keep error states and form fields straightforward for nontechnical users.

## Study Updates
- Subscriber management uses `app/api/updates/manage/route.js` with `manageToken`.
- Dispatch runs via `/api/updates/study-email/dispatch`; scheduled sends are triggered from `.github/workflows/study-email.yml`, which runs daily at 11:00 UTC (morning Eastern time) and lets the route enforce only the configured nth weekday from Sanity.
- Requires `SANITY_API_TOKEN` to record send status.
- Interest area options come from active `therapeuticArea` docs; subscribers store `interestAreas` references plus `allTherapeuticAreas` for opt-in-all.
- `siteSettings.studyUpdates` includes `scheduleOccurrence` and `scheduleDayOfWeek` so staff can choose schedules like 1st Monday.

## Newsletters
- Publication newsletter dispatch lives at `/api/updates/publication-newsletter/dispatch` with admin endpoints `/api/updates/publication-newsletter/admin` and `/api/updates/publication-newsletter/send`.
- Custom one-off newsletters send via `/api/updates/custom-newsletter` (filters by role/specialty/interest areas).
- Settings live in `siteSettings.publicationNewsletter`; send tracking uses `updateSubscriber.lastPublicationNewsletterSentAt` and `updateSubscriber.lastNewsletterSentAt`.
- Scheduled publication sends run from `.github/workflows/publication-newsletter.yml`; the workflow runs daily at 11:00 UTC (morning Eastern time) and the route checks only the configured nth weekday in Sanity before sending.
- `siteSettings.publicationNewsletter` includes `scheduleOccurrence` and `scheduleDayOfWeek` for staff-managed timing.

## Admin Access
- Admin hub at `/admin` with module-specific entry points at `/admin/approvals` and `/admin/updates`.
- Legacy admin URLs `/trials/approvals` and `/updates/admin` remain supported.
- Admin sessions are scoped to approvals vs updates based on `siteSettings.studyApprovals.admins` and `siteSettings.studyUpdates.admins`.
- `app/api/admin/login/route.js` and `app/api/admin/verify/route.js` accept a `scope` to limit access (`approvals`, `updates`, or `any`).
- `app/api/admin/access/route.js` returns the current session's access flags for the admin hub.

## Authentication
- NextAuth (Auth.js v4) with Azure AD lives in `lib/auth.js` and is exposed via `app/api/auth/[...nextauth]/route.js`.
- Maintenance mode still uses `app/api/auth/route.js` for the `site-auth` cookie; NextAuth endpoints remain under `/api/auth/*`.
- The login flow is in `app/login/page.js`, with a protected example at `app/protected/page.js`.
- Client session context is provided by `app/components/AuthSessionProvider.js` only on login/admin/protected tool pages that need `useSession`; public pages do not include the global NextAuth session provider.
- Access is allowlisted in Sanity: `siteSettings.studyApprovals.coordinatorEmails` (coordinators) plus `siteSettings.studyApprovals.admins` and `siteSettings.studyUpdates.admins` (admins). Sign-in is restricted to the allowlist and `studyApprovals.coordinatorDomain`.
- Role flags are stored on `session.user.access` (`admin`, `approvals`, `updates`, `coordinator`) and enforced in API routes via `lib/authAccess.js`.

## Aliases & File Types
- `@/` path aliases are defined in `jsconfig.json` and `tsconfig.json`.
- Project mixes JS/TS; keep a feature's files consistent when editing.

## Environment & Secrets
- `.env.local` holds secrets (Sanity tokens, API keys). Never commit or echo values.
- Mutations require `SANITY_API_TOKEN` (used by `writeClient` in `lib/sanity.js`).
- `NEXT_PUBLIC_SANITY_PROJECT_ID` and `NEXT_PUBLIC_SANITY_DATASET` are required for the app and scripts (no fallbacks).
- `SANITY_STUDIO_PROJECT_ID` and `SANITY_STUDIO_DATASET` are required for the Studio (including cache tooling).

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
- DOI abstract backfill (`lib/doiAbstract.js`) uses a four-tier fallback: (1) plain fetch of publisher page meta tags, (2) CrossRef API, (3) OpenAlex API inverted-index abstract, (4) headless Chromium via `lib/browserFetch.js` to bypass Cloudflare/bot protection and extract article text.
- Headless browser uses `puppeteer-core` + `@sparticuz/chromium-min` on Vercel, local Chrome in dev. Enabled by default on Vercel; set `DOI_BROWSER_FETCH=true` locally. Set `DOI_BROWSER_FETCH=false` to disable.
- Both packages are listed in `serverExternalPackages` in `next.config.js` to prevent bundling.

## Cron Jobs
- Scheduled routes are defined in `vercel.json`.
- `/api/pubmed/refresh` uses `CRON_SECRET` (cron) or `PUBMED_REFRESH_TOKEN` (manual POST).
- `/api/seo/refresh` auto-generates SEO/LLM summaries and snapshots publication topics/highlights for llms.txt/markdown (manual via `SEO_REFRESH_TOKEN`; requires `SANITY_API_TOKEN`). To keep within the 2-cron limit, enable optional piggybacking on `/api/pubmed/refresh` by setting `SEO_REFRESH_ON_PUBMED_CRON=true`.
- Study email scheduling uses GitHub Actions rather than `vercel.json`; scheduled runs authenticate with `CRON_SECRET` and flow through the route's nth-weekday guard.
- Publication newsletter scheduling uses GitHub Actions rather than `vercel.json`; scheduled runs authenticate with `CRON_SECRET` and flow through the route's nth-weekday guard.
- Shared nth-weekday scheduling helpers live in `lib/cronUtils.js`.

## Dependency Upgrades
- **Pin `next` to an exact version** in `package.json` (no `^` or `~`). Turbopack regressions in minor releases have caused production-wide 500 errors on all server-rendered pages. Only upgrade Next.js intentionally, test the build, and verify at least one dynamic page works locally before pushing.
- After upgrading Next.js, check every dynamic page (`ƒ` in build output) locally — static/ISR pages can mask server-rendering crashes because they are served from cache.
- `next-auth` v4 is not officially compatible with Next.js 16+; it works today but may break on future upgrades. Plan to migrate to Auth.js v5 when practical.
- `puppeteer-core` and `@sparticuz/chromium-min` are large native packages. They must stay in `serverExternalPackages` in `next.config.js` and should only be imported dynamically (via `await import(...)`) to avoid cold-start and bundling issues.
- In Next.js 15+ (and enforced in 16), `params` and `searchParams` page props are Promises. Always `await` them before accessing properties — synchronous access will crash in production even if it appears to work in dev.

## Testing
- No dedicated test suite; run `npm run lint` for non-trivial changes.
- Preferred lint check: `npm run lint` (uses ESLint flat config via `eslint.config.js`).
