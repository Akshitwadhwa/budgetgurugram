# BudgetGurugram

BudgetGurugram is a local-first, editorial guide to affordable places, workspaces, public spaces, events, and useful services in Gurugram.

## Run locally

From this folder, run:

```bash
python3 -m http.server 4173
```

Then open `http://localhost:4173` in a browser.

## Included in this prototype

- Three-step onboarding for motive, role, and location
- Interactive MapLibre map with OpenFreeMap tiles
- Gurugram place pins, popups, filters, search, and map/list views
- Approximate user-location marker when permission is granted
- Weather-aware visit guidance
- Saved places stored locally in the browser
- Public Luma event section with direct registration links
- Live Vercel endpoint and Vercel Cron refresh for the next 31 days
- GitHub Actions sync that refreshes approved public event pages every three hours
- Editorial sample data across food, workspaces, public spaces, events, and services

The current listings are prototype editorial samples. Before launch, replace them with source-backed records and verified coordinates.

## Public event sync

This project intentionally does not require a Luma API key. Add approved public Luma calendar or event pages to `data/event-sources.json`. The scraper reads public structured event metadata, keeps future tech events for Gurugram/Delhi NCR, removes duplicates and writes `data/events.json`.

The frontend first calls `/api/luma-events`, which scrapes the public sources live on Vercel and returns upcoming events for the next 31 days. `vercel.json` schedules that endpoint every three hours in production. The GitHub workflow at `.github/workflows/sync-events.yml` is a durable static fallback and can also be started manually from the Actions tab; it refreshes `data/events.json` and Vercel redeploys the updated fallback when connected to this repository.

Only use public sources you are allowed to index. Do not bypass sign-in, CAPTCHA, robots rules or rate limits. Add attribution and keep the original Luma link on every event card.
