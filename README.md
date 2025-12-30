# Research Unit Website

## Project Structure

```
/kcru-website
├── app/                         # Next.js App Router (pages, layouts, API routes)
│   ├── admin/                   # Admin hub and entry points
│   ├── api/                     # Route handlers
│   ├── components/              # Shared UI components
│   ├── news/                    # Inactive (legacy section)
│   ├── publications/            # Publications pages
│   ├── team/                    # Team listing + detail
│   ├── trials/                  # Trials pages + approvals
│   ├── updates/                 # Study updates flows
│   └── ...                      # Other site sections
├── lib/                         # Data clients/helpers (Sanity, PubMed, ClinicalTrials.gov, OpenAlex)
├── sanity/                      # Sanity Studio config + schemas
├── scripts/                     # Maintenance/migration scripts
├── runtime/                     # Generated caches/locks (do not edit)
├── dist/                        # Build output (do not edit)
├── core                         # Tracked binary artifact
├── vercel.json                  # Cron jobs
└── package.json
```

## Automated Data Sources

### 1. PubMed (Publications)
- Searches by affiliation or individual researcher queries
- Returns title, authors, journal, DOI, abstract
- Cached to `runtime/pubmed-cache.json` and refreshed daily

## Admin Access
- Admin hub: `/admin`
- Module entry points: `/admin/approvals` (study approvals) and `/admin/updates` (study update emails)
- Legacy URLs remain supported: `/trials/approvals` and `/updates/admin`
- Access is scoped by email lists in Sanity `siteSettings.studyApprovals.admins` and `siteSettings.studyUpdates.admins`

## Setup Steps

### 1. Create Next.js project
```bash
npx create-next-app@latest research-unit-site
cd research-unit-site
```

### 2. Install dependencies
```bash
npm install @sanity/client @sanity/image-url
npm install -g sanity
sanity init --coupon sonext
```

### 3. Add environment variables
Create `.env.local`:
```
NEXT_PUBLIC_SANITY_PROJECT_ID=your_project_id
NEXT_PUBLIC_SANITY_DATASET=production
SANITY_API_TOKEN=your_token
```

### 4. Deploy
- Push to GitHub
- Connect repo to Vercel
- Add environment variables in Vercel dashboard
- Done

## Cron Jobs (vercel.json)

```json
{
  "crons": [
    {
      "path": "/api/pubmed/refresh",
      "schedule": "0 7 * * *"
    },
    {
      "path": "/api/updates/study-email/dispatch",
      "schedule": "0 11 * * *"
    }
  ]
}
```

Refreshes PubMed daily and dispatches study update emails.

## PubMed Cache (filesystem)
- Cache file: `runtime/pubmed-cache.json` (metadata + publications + provenance)
- Refresh manually: `npm run refresh:pubmed`
- Refresh via Sanity Studio: open `Site Settings` and click **Refresh PubMed cache** (configure `SANITY_STUDIO_PUBMED_REFRESH_URL` + `SANITY_STUDIO_PUBMED_REFRESH_TOKEN` to point at your deployed API)
- Refresh via API: `POST /api/pubmed/refresh` with `Authorization: Bearer $PUBMED_REFRESH_TOKEN`
- Cancel a running refresh: `POST /api/pubmed/cancel` (same bearer token). The running job checks for cancellation and exits early; lock clears automatically.
- Configure: `PUBMED_API_KEY` (higher PubMed limits), `PUBMED_TIMEOUT_MS`, `PUBMED_RETRIES`, `PUBMED_MAX_PER_RESEARCHER`, `PUBMED_CACHE_MAX_AGE_MS`
- Scheduling: Vercel cron calls `/api/pubmed/refresh` (see `vercel.json`); for self-hosted setups, run `npm run refresh:pubmed` daily via cron/PM2

## API Endpoints

| Endpoint | Purpose | Methods/Notes |
|----------|---------|---------------|
| `/api/pubmed/refresh` | PubMed cache refresh | `GET` for cron (CRON_SECRET), `POST` for manual (Authorization: Bearer) |
| `/api/pubmed/cancel` | Cancel a running refresh and clear lock | `POST` (Authorization: Bearer) |
| `/api/pubmed/download` | Download cached publications JSON | `GET` (Authorization: Bearer) |
| `/api/pubmed/upload` | Upload local `runtime/pubmed-cache.json` to Sanity | `POST` (Authorization: Bearer, body: `{ "force": true }` optional) |
| `/api/pubmed/summarize` | Generate missing publication summaries | `GET` for cron (CRON_SECRET), `POST` for manual (Authorization: Bearer, body: `{ "maxSummaries": number }` optional) |
| `/api/pubmed/publication` | Update or delete a single publication in cache | `POST` with `{ "pmid": "..." }` to regenerate summary; `DELETE ?pmid=...` to remove |
| `/api/pubmed/classify-preview` | Preview classification + summaries for recent publications | `POST` (Authorization: Bearer, body: `{ count, prompt, provider, model, apiKey }` optional) |
| `/api/pubmed/reclassify` | Classify publications and store results in Sanity | `POST` (Authorization: Bearer, body: `{ count|all|pmids, clear, batchSize, delayMs }` and prompt/provider/model overrides) |
| `/api/updates/study-email/dispatch` | Study updates email dispatch | `GET` for cron (CRON_SECRET), `POST` for manual (Authorization: Bearer) |

## Tips

### Caching Strategy
- API routes cache in memory (resets on cold start)
- For persistent cache, add Vercel KV or a database
- ISR (revalidate) handles page-level caching

### Rate Limits
- PubMed: 3 requests/second without API key, 10 with
- ClinicalTrials.gov: No published limits, be reasonable
