# FindClients — API Server

The backend for FindClients: authentication, lead management, analytics,
notifications, billing, and the scraping scheduler. Built to run as a **zero-config
demo** — no external services required.

## Stack

- **Node 22.5+ / TypeScript** (run with [`tsx`](https://github.com/privatenumber/tsx))
- **Express** — REST API
- **node:sqlite** — Node's built-in SQLite (no native build step, no DB server)
- **JWT + bcrypt** — auth
- **node-cron** — scheduler
- **zod** — request validation

## Quick start

```bash
cd server
npm install
cp .env.example .env      # optional — sane defaults work out of the box
npm run dev               # http://localhost:4000
```

On first boot the server seeds a demo account and starter leads, then starts the
scheduler. With `USE_DEMO_SCRAPERS=true` (default) synthetic leads trickle in
every couple of minutes so the pipeline is visibly alive.

**Demo login:** `demo@findclients.dev` / `demo12345`

### Scripts

| Command           | What it does                                  |
| ----------------- | --------------------------------------------- |
| `npm run dev`     | Start with hot reload (tsx watch)             |
| `npm start`       | Start once (tsx)                              |
| `npm run seed`    | Seed demo user + starter leads                |
| `npm run typecheck` | Type-check the whole project (server + scrapper) |

## Architecture

```
Scrapers (../scrapper)          ← you implement these
      ↓  loaded at runtime
 Scheduler (node-cron)          src/scheduler
      ↓
 Runner  → dedupe → insert      src/scrapers/runner.ts
      ↓
 Database (SQLite)              src/db
      ↓
 Services                       src/services  (auth, leads, analytics, billing…)
      ↓
 REST API (Express)            src/routes  → /api/*
      ↓
 Notifications                 src/services/notification.service.ts
```

The `scrapper/` folder holds the real platform scrapers (placeholders for now).
The server ships **demo scrapers** that generate synthetic leads so everything
works before the real ones exist. See [`../scrapper/README.md`](../scrapper/README.md).

## API

All responses are JSON. Protected routes need `Authorization: Bearer <token>`.

### Auth
| Method | Path                        | Body                                   |
| ------ | --------------------------- | -------------------------------------- |
| POST   | `/api/auth/register`        | `{ email, password, fullName? }`       |
| POST   | `/api/auth/login`           | `{ email, password }`                  |
| GET    | `/api/auth/me`              | —                                      |
| PATCH  | `/api/auth/me`              | `{ fullName?, email? }`                |
| POST   | `/api/auth/change-password` | `{ currentPassword, newPassword }`     |
| POST   | `/api/auth/logout`          | — (client discards token)              |

### Leads
| Method | Path                           | Notes                                                        |
| ------ | ------------------------------ | ------------------------------------------------------------ |
| GET    | `/api/leads`                   | `?platform&q&status&bookmarked&page&limit` → `{ data, pagination }` |
| GET    | `/api/leads/:id`               | single lead                                                  |
| PATCH  | `/api/leads/:id`               | `{ status }` — new/viewed/contacted/won/archived             |
| PUT    | `/api/leads/:id/bookmark`      | bookmark                                                     |
| DELETE | `/api/leads/:id/bookmark`      | un-bookmark                                                  |
| GET    | `/api/bookmarks`               | bookmarked leads                                             |

### Analytics
`GET /api/analytics/overview` · `/platforms` · `/trend` · `/scrape-runs`

### Settings · Notifications · Billing · Scrape
- `GET|PUT /api/settings`
- `GET /api/notifications` · `POST /api/notifications/:id/read` · `POST /api/notifications/read-all`
- `GET /api/billing/plans` · `GET /api/billing/subscription` · `POST /api/billing/subscribe`
- `POST /api/scrape/run` (manual trigger) · `GET /api/scrape/runs`

### Health
`GET /api/health` → `{ status, env, uptime, leads, time }`

## Configuration

See [`.env.example`](./.env.example). Highlights:

| Var                 | Default                     | Purpose                              |
| ------------------- | --------------------------- | ------------------------------------ |
| `PORT`              | `4000`                      | HTTP port                            |
| `CORS_ORIGIN`       | `http://localhost:3000`     | Allowed frontend origin(s)           |
| `JWT_SECRET`        | dev secret                  | **Change in production**             |
| `DATABASE_FILE`     | `./data/findclients.db`     | SQLite file                          |
| `SCHEDULER_ENABLED` | `true`                      | Background scraping on/off           |
| `SCRAPE_CRON`       | `*/2 * * * *`               | Scrape cadence                       |
| `USE_DEMO_SCRAPERS` | `true`                      | Generate synthetic leads             |
| `DISCORD_WEBHOOK_URL` | —                         | Optional Discord notifications       |

## Notes for production

This is a demo. Before shipping: swap SQLite for Postgres, the in-memory cache
for Redis, integrate a real payment provider in `billing.service.ts`, wire real
email/push in `notification.service.ts`, and set a strong `JWT_SECRET`.
