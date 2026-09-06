# server/

The backend: REST API, JSON storage, scrape scheduler, AI qualification — and, in production, the built website too, so the whole app is one process on one port.

## Stack

- **Node 22.5+ / TypeScript**, run with [`tsx`](https://github.com/privatenumber/tsx) (no build step)
- **Express** — REST API
- **JSON files** — storage, see [`src/store/`](src/store)
- **node-cron** — scheduler
- **zod** — request validation

No database, no ORM, no auth library.

## Running it

Normally you don't run this directly — `npm start` in the repository root builds the website and starts this. Directly:

```bash
npm run dev        # tsx watch, API only on :4000
npm start          # API + the built website on :4000
npm run typecheck  # also typechecks ../scrapper
```

Config comes from the root [`.env`](../.env.example). Set `SERVE_WEBSITE=false` to run API-only.

## Layout

| Path | What |
| --- | --- |
| `store/` | The database: `JsonFile` (atomic writes) + the six files it manages |
| `services/` | Business logic — leads, config, connections, AI, notifications, analytics |
| `routes/` | HTTP surface, one router per resource, all under `/api` |
| `scrapers/` | Loads `../scrapper`, runs the cycle, defines the `Scraper` contract |
| `scheduler/` | Cron + jitter |
| `utils/` | http errors, logging, text sanitizing, hashing, relative time |

## Storage

Note what the store does *not* hold: credentials. Platform sessions live in persistent Chromium profiles under `data/browser/`, so `connection.service.ts` records only when you signed in and how the last run went.

[`store/json-file.ts`](src/store/json-file.ts) is the whole engine. Each file is read once at boot and kept in memory; writes are debounced 250ms and flushed atomically (write `.tmp`, then rename). Reads are plain array/object access, so the services filter in TypeScript rather than in SQL.

Two properties are load-bearing:

- **Atomic writes.** A crash mid-save leaves the old file or the new one, never half of one.
- **A parse error never costs you data.** A corrupt file is renamed to `.corrupt-<timestamp>` rather than overwritten.

`flushAll()` runs on SIGINT/SIGTERM, so leads collected seconds before Ctrl-C still land.

This scales to tens of thousands of leads — one person's use, comfortably. If `leads.json` ever gets big enough to notice, `store/index.ts` is the one file to swap for SQLite; nothing above it knows what the storage is.

## No authentication

Deliberate. There is one user, on one machine, and the server binds to `127.0.0.1` — that bind address is the access control. Every route is open to anything that can reach the port, which is why what can reach the port matters. See the README's security note before changing `HOST`.

## Serving the website

[`src/index.ts`](src/index.ts) resolves `next` from `website/node_modules` with `createRequire`, calls `prepare()`, and mounts the handler after the API routes. That keeps the two workspaces' dependency trees separate while running them in one process.

One trap, commented at the call site: Express passes middleware `(req, res, next)`, and Next reads its own third argument as a pre-parsed URL. Passing Express's `next` straight through makes every page render `Invalid URL`.
