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
- Live nearby place layer from OpenStreetMap/Overpass with source links and fetch timestamps
- Gurugram place pins, popups, filters, search, and map/list views
- Approximate user-location marker when permission is granted
- Weather-aware visit guidance
- Saved places stored locally in the browser
- Public Luma event section with direct registration links
- Live Vercel endpoint and Vercel Cron refresh for the next 31 days
- GitHub Actions sync that refreshes approved public event pages every three hours
- Editorial sample data across food, workspaces, public spaces, events, and services

The current listings are prototype editorial samples. Before launch, replace them with source-backed records and verified coordinates.

## Map data and trust model

The map separates two kinds of records:

- Live nearby pins are fetched through api/nearby-places.js from the read-only Overpass API and link back to their OpenStreetMap record. They are refreshed on page load or with “Refresh data” and cached by Vercel for up to 5 minutes.
- Curated guide pins are the original editorial prototype records. They are hidden when live nearby data is available and can be revealed with “Show guide pins”. Their cards and drawers explicitly say to confirm hours, price and availability before travelling.

OpenStreetMap is a current public map database, not a guarantee that a business is open or that its prices and hours are correct. The product should always show the source and freshness instead of claiming “absolute latest” or “open now”. For production-grade business status, add a licensed place-data provider or direct verification workflow and keep the original source link.

The public OpenStreetMap services have usage limits and attribution requirements. The server endpoint uses a small radius, a bounded result set, a short cache and a descriptive user agent. See the [OpenStreetMap API usage policy](https://operations.osmfoundation.org/policies/api/) before increasing traffic.

## Public event sync

This project intentionally does not require a Luma API key. Add approved public Luma calendar or event pages to `data/event-sources.json`. The scraper reads public structured event metadata, keeps future tech events for Gurugram/Delhi NCR, removes duplicates and writes `data/events.json`.

The frontend first calls `/api/luma-events`, which scrapes the public sources live on Vercel and returns upcoming events for the next 31 days. `vercel.json` schedules that endpoint every three hours in production. The GitHub workflow at `.github/workflows/sync-events.yml` is a durable static fallback and can also be started manually from the Actions tab; it refreshes `data/events.json` and Vercel redeploys the updated fallback when connected to this repository.

Only use public sources you are allowed to index. Do not bypass sign-in, CAPTCHA, robots rules or rate limits. Add attribution and keep the original Luma link on every event card.
