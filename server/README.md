# FindClients — API Server

The backend for FindClients: authentication, lead management, analytics,
notifications, billing, and the scraping scheduler.

## Stack

- **Node 22.5+ / TypeScript** (run with [`tsx`](https://github.com/privatenumber/tsx))
- **Express** — REST API
- **Supabase Postgres** — data, via `@supabase/supabase-js` and the service key
- **Supabase Auth** — identity, brokered by this server
- **node-cron** — scheduler
- **zod** — request validation

## Quick start

Configuration comes from the **global `.env` at the repository root** (see
[`../.env.example`](../.env.example)); a `server/.env` is optional and only
layers local overrides on top. Apply
[`../supabase/migrations/0001_init.sql`](../supabase/migrations/0001_init.sql)
in your Supabase SQL Editor first — the server refuses to start without it.

```bash
cd server
npm install
npm run dev               # http://localhost:4000
```

Register an account in the web app, then connect a platform under **Connections**
(paste your session cookie). The scheduler then scrapes on your behalf every
couple of minutes; new leads flow into the shared pool and are matched to each
user by their keyword preferences.

### Scripts

| Command           | What it does                                  |
| ----------------- | --------------------------------------------- |
| `npm run dev`     | Start with hot reload (tsx watch)             |
| `npm start`       | Start once (tsx)                              |
| `npm run typecheck` | Type-check the whole project (server + scrapper) |

## Architecture

```
Users connect accounts    src/services/credential.service.ts  (cookies, encrypted at rest)
      ↓
 Scheduler (node-cron)     src/scheduler
      ↓  for each connected user…
 Runner  → scraper(cookies) → dedupe → insert   src/scrapers/runner.ts
      ↓
 Database (Supabase)       src/db/supabase.ts
      ↓
 Services                  src/services  (auth, leads, analytics, billing…)
      ↓
 REST API (Express)        src/routes  → /api/*
      ↓
 Notifications             src/services/notification.service.ts
```

Each scrape run is driven by one connected user's session cookies (see
[`../scrapper/README.md`](../scrapper/README.md)). Cookies are encrypted with
`ENCRYPTION_KEY` (AES-256-GCM) and never returned by the API.

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
| POST   | `/api/auth/refresh`         | `{ refreshToken }` → new access token  |
| POST   | `/api/auth/logout`          | — revokes the refresh token            |
| DELETE | `/api/auth/me`              | — deletes the account and all its data |

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

### Connections (per-user platform sessions)
| Method | Path                        | Notes                                                    |
| ------ | --------------------------- | -------------------------------------------------------- |
| GET    | `/api/credentials`          | Masked connection status per platform (never the secret) |
| PUT    | `/api/credentials/:platform`| `{ cookies }` — store/replace the session (encrypted)    |
| DELETE | `/api/credentials/:platform`| Disconnect                                               |

### Config · Notifications · Billing · Scrape
- `GET|PUT /api/config` — the user's own configuration (`public.user_config`)
- `GET /api/notifications` · `POST /api/notifications/:id/read` · `POST /api/notifications/read-all`
- `GET /api/billing/plans` · `GET /api/billing/subscription` · `POST /api/billing/subscribe`
- `POST /api/scrape/run` (manual trigger) · `GET /api/scrape/runs`

### Health
`GET /api/health` → `{ status, env, uptime, leads, time }`

## Configuration

All variables live in the global [`../.env`](../.env.example). Highlights:

| Var                 | Default                     | Purpose                              |
| ------------------- | --------------------------- | ------------------------------------ |
| `PORT`              | `4000`                      | HTTP port                            |
| `CORS_ORIGIN`       | `http://localhost:3000`     | Allowed frontend origin(s)           |
| `SUPABASE_URL`      | — (required)                | Your project URL                     |
| `SUPABASE_SERVICE_KEY` | — (required)             | Service key. **Server only** — bypasses RLS |
| `SUPABASE_AUTO_CONFIRM_EMAILS` | `true`           | Skip the verification email on sign-up |
| `ENCRYPTION_KEY`    | dev key                     | Encrypts stored session cookies. **Change in production** |
| `SCHEDULER_ENABLED` | `true`                      | Background scraping on/off           |
| `SCRAPE_CRON`       | `*/2 * * * *`               | Scrape cadence                       |

Scraper keywords, thresholds, limits, feed URLs and Discord webhooks are **not**
environment variables — they are per-user and live in `public.user_config`,
edited on the app's Config page.

## Notes for production

Before shipping: swap the in-memory cache for Redis, integrate a real payment
provider in `billing.service.ts`, wire real email/push in
`notification.service.ts`, set `SUPABASE_AUTO_CONFIRM_EMAILS=false` and configure
SMTP so addresses are actually verified, set a strong `ENCRYPTION_KEY`, and move
cookie encryption to a KMS (envelope encryption) instead of an app-level key.

The service key bypasses Row Level Security, so every query in `src/services`
scopes itself by user id. Keep that invariant when adding new ones.

> Storing users' third-party session cookies makes this server a high-value
> target and automating those platforms may violate their Terms of Service.
> Treat the credentials table as crown-jewels and get the compliance call right.
