# Research Unit Website Starter

## Project Structure

```
/research-unit-site
├── app/
│   ├── layout.js                # Root layout (header, footer)
│   ├── page.js                  # Homepage
│   ├── news/
│   │   ├── page.js              # News listing
│   │   └── [slug]/
│   │       └── page.js          # Individual news post
│   ├── team/
│   │   ├── page.js              # Team listing
│   │   └── [slug]/
│   │       └── page.js          # Individual researcher profile
│   ├── publications/
│   │   └── page.js              # Publications from PubMed + citations
│   ├── trials/
│   │   └── page.js              # Clinical trials from ClinicalTrials.gov
│   └── api/
│       ├── publications/
│       │   └── route.js         # PubMed fetch endpoint
│       ├── trials/
│       │   └── route.js         # ClinicalTrials.gov endpoint
│       └── metrics/
│           └── route.js         # OpenAlex citation metrics
├── components/
│   ├── Header.js
│   ├── Footer.js
│   ├── NewsCard.js
│   ├── TeamCard.js
│   ├── PublicationList.js
│   └── TrialCard.js
├── lib/
│   ├── sanity.js                # Sanity client config
│   ├── pubmed.js                # PubMed API helpers
│   ├── clinicaltrials.js        # ClinicalTrials.gov API
│   ├── openalex.js              # OpenAlex API (citations, metrics)
│   └── publications.js          # Combined PubMed + OpenAlex
├── sanity/
│   └── schemas/
│       ├── researcher.js
│       ├── newsPost.js
│       ├── siteSettings.js
│       └── index.js
├── vercel.json                  # Cron jobs
└── package.json
```

## Automated Data Sources

### 1. PubMed (Publications)
- Searches by affiliation or individual researcher queries
- Returns title, authors, journal, DOI, abstract
- Cached to `runtime/pubmed-cache.json` and refreshed daily

### 2. ClinicalTrials.gov (Active Trials)
- Searches by institution and PI names
- Returns trial status, phase, enrollment, sites
- Filters: recruiting, active, completed

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
      "path": "/api/publications?refresh=true",
      "schedule": "0 6 * * *"
    },
    {
      "path": "/api/trials?refresh=true",
      "schedule": "0 7 * * *"
    },
  ]
}
```

Refreshes all data sources daily (staggered to avoid rate limits).

## PubMed Cache (filesystem)
- Cache file: `runtime/pubmed-cache.json` (metadata + publications + provenance)
- Refresh manually: `npm run refresh:pubmed`
- Refresh via Sanity Studio: open `Site Settings` and click **Refresh PubMed cache** (configure `SANITY_STUDIO_PUBMED_REFRESH_URL` + `SANITY_STUDIO_PUBMED_REFRESH_TOKEN` to point at your deployed API)
- Refresh via API: `POST /api/pubmed/refresh` with `Authorization: Bearer $PUBMED_REFRESH_TOKEN`
- Cancel a running refresh: `POST /api/pubmed/cancel` (same bearer token). The running job checks for cancellation and exits early; lock clears automatically.
- Configure: `PUBMED_API_KEY` (higher PubMed limits), `PUBMED_TIMEOUT_MS`, `PUBMED_RETRIES`, `PUBMED_MAX_PER_RESEARCHER`, `PUBMED_CACHE_MAX_AGE_MS`
- Scheduling: run `npm run refresh:pubmed` daily via cron/PM2/host scheduler

## API Endpoints

| Endpoint | Purpose | Query Params |
|----------|---------|--------------|
| `/api/publications` | PubMed publications | `?refresh=true` |
| `/api/trials` | Clinical trials | `?refresh=true&status=active\|completed\|all` |

## Tips

### Caching Strategy
- API routes cache in memory (resets on cold start)
- For persistent cache, add Vercel KV or a database
- ISR (revalidate) handles page-level caching

### Rate Limits
- PubMed: 3 requests/second without API key, 10 with
- ClinicalTrials.gov: No published limits, be reasonable
