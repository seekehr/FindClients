# website/

The FindClients dashboard: Next.js 16, React 19, Tailwind 4. It is a client of the local API in [`../server`](../server) — no accounts, no database of its own. Everything it shows comes from `/api`.

## Running it

From the repository root:

```bash
npm run dev    # website on :3000, API on :4000, both reloading on save
npm start      # the server serves the built website and the API on :4000
```

`npm start` builds the website only if there is no build yet, so after changing it either use `npm run dev` or rebuild with `npm run build`.

Inside this folder: `npm run typecheck` and `npm run lint`.

The API base URL is `NEXT_PUBLIC_API_URL`, defaulting to `/api` (same origin, as under `npm start`). `npm run dev` points it at `http://127.0.0.1:4000/api`.

## Pages

| Route | What |
| --- | --- |
| `/` | Redirects to `/dashboard` |
| `/dashboard` | Overview — stats, latest job alerts, watcher state, latest leads |
| `/dashboard/opportunities` | New Opportunities — Upwork job alerts, the watcher's status and queue |
| `/dashboard/leads` | Leads — search, platform filters, and a red **Rejected** filter for leads the AI turned down |
| `/dashboard/leads/[id]` | One lead, its AI review and its pipeline status |
| `/dashboard/bookmarks` | Saved leads |
| `/dashboard/analytics` | Leads over time, by platform, and scrape history |
| `/dashboard/connections` | Sign in to X and Upwork |
| `/dashboard/config` | Keywords, scraping, Upwork watcher pacing, AI criteria and key, notifications |

## Layout

| Path | What |
| --- | --- |
| `app/` | The routes above |
| `components/` | `lead-card`, `opportunity-row`, `proposals-badge`, the dashboard shell |
| `components/ui/` | Badges, buttons, cards, fields and other primitives |
| `lib/api.ts` | Typed client for every API call, and the shapes it returns |
| `lib/use-scrape-status.ts`, `lib/use-watch-status.ts` | One shared poller each for scrape state and the Upwork watcher, so every component reads the same snapshot |
| `lib/platforms.ts` | Platform labels and marks |
