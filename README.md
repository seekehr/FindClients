# FindClients

Self-hosted lead discovery for freelancers. Scrapes Upwork and Twitter/X, optionally qualifies leads with Google Gemini (each user brings their own API key), and surfaces them in a dashboard.

| Folder | What it is |
| --- | --- |
| [`website/`](website) | Next.js 16 frontend (React 19, Tailwind 4, shadcn/ui) |
| [`server/`](server) | Express API — auth, config, leads, scheduler, notifications, AI |
| [`scrapper/`](scrapper) | Playwright scrapers + CAPTCHA session manager ([details](scrapper/README.md)) |
| [`supabase/`](supabase) | Postgres schema — 4 SQL migrations |

No root `package.json`; each workspace is independent. All read the root `.env`.

## Setup

**1. Env** — copy `.env.example` → `.env`:

| Variable | Required | Notes |
| --- | --- | --- |
| `SUPABASE_URL` | Yes | |
| `SUPABASE_SERVICE_KEY` | Yes | **Must be the legacy `eyJ…` service_role JWT** — see gotcha below |
| `ENCRYPTION_KEY` | Recommended | AES-256-GCM key for cookie storage (insecure default) |
| `INTERNAL_API_KEY` | No | Scraper↔server shared secret; empty disables `/api/internal` |

**2. Migrations** — Supabase dashboard → SQL Editor, run **in order**. All idempotent.

```
0001_init.sql            core tables, RLS, provisioning triggers
0002_ai_and_metadata.sql AI columns + lead metadata
0003_dismissed_leads.sql 'dismissed' status + list_leads excludes it
0004_clear_leads_rpc.sql clear_leads_for_user() RPC
0005_user_gemini_api_key.sql  per-user encrypted Gemini key; Claude → Gemini models
```

**3. Run**

```bash
cd server   && npm install && npm run dev    # :4000 — API + scheduler + scrapers
cd scrapper && npm install && npx playwright install chromium
cd website  && npm install && npm run dev    # :3000
```

Sign up → **Config** (keywords, platforms) → **Connections** (paste session cookies). A scrape fires immediately on server start, then every 2 min (`SCRAPE_CRON`).

## Gotchas

- **Supabase key format.** The new `sb_secret_*` keys do **not** bypass RLS with `@supabase/supabase-js` 2.112.2 — you get `new row violates row-level security policy`. Use the legacy `service_role` JWT (`eyJ…`). [`db/supabase.ts`](server/src/db/supabase.ts) also pins `Authorization: Bearer <key>` explicitly, because the client otherwise drops it when `persistSession: false`.
- **`user_leads.status` check constraint** must include `'dismissed'` (migration 0003). Missing it makes "Clear leads" fail.
- **Clear leads is a soft delete.** It dismisses rather than deletes so leads don't reappear on the next scrape, and it must *insert* dismissed rows for pool leads with no `user_leads` row — hence the RPC. Bookmarked leads are never cleared.
- **Upwork ignores user config entirely** — hardcoded feed URL, no age cutoff, only `.env` runtime settings. Twitter still reads `user_config`.

## How it works

**Scrape cycle** — scheduler → `runScrapeCycle()` → loads scrapers from `scrapper/index.ts` → **all scrapers run in parallel** (`Promise.all`), users sequential within each scraper (avoids too many browsers). Leads de-duped by `source_hash` (SHA-1 of `platform::url`) into the shared `leads` pool; per-user state lands in `user_leads`. Audit trail in `scrape_runs`. Overlapping cycles are skipped with a warning.

**AI qualification** — opt-in per user, on the user's **own Google Gemini API key**, entered on the Config page and stored AES-256-GCM encrypted in `user_config.ai_api_key`. There is no server-wide key: every review is billed to the user who asked for it, and a user with no key saved gets qualification skipped (logged), never leads silently passed. The key is never returned by any route — `GET /api/config` hands back `aiApiKeySet` and a masked hint, and `getAiApiKey()` is the only reader, called by the runner. Gemini only; models `gemini-2.5-pro | gemini-2.5-flash | gemini-2.5-flash-lite`, default `gemini-2.5-flash`, called over plain REST (no SDK). 0–100 score + qualified/rejected + reason, stored per-user. 4 concurrent. `ai_auto_archive` archives rejected leads the user hasn't touched. Already-reviewed and dismissed leads are skipped (`leadsAlreadyReviewed`).

**Auth** — Supabase Auth brokered by the API. Login/register/refresh set HTTP-only cookies (`fc_token` 1h, `fc_refresh` 30d); logout clears them. `requireAuth` reads the `Authorization` header first, then falls back to the cookie. The frontend sends `credentials: 'include'` and mirrors tokens in localStorage for backwards compatibility, so a returning visitor is logged in automatically. `getUser()` results cached 60s.

**Credentials** — session cookies encrypted AES-256-GCM (random IV per record, key = SHA-256 of `ENCRYPTION_KEY`). Never returned by the API, only masked status. `/api/internal` decrypts them for scrapers behind the shared secret.

**CAPTCHA** — headless runs hand the live Playwright page to the dashboard: screenshot → you click → clicks relayed to the real browser → scraper resumes. See [`scrapper/README.md`](scrapper/README.md).

**Logging** — no morgan, no debug level. `logger` has only `info`/`warn`/`error`. Scrape lifecycle lines (`[Upwork] scrape started/finished`) plus scraper `ctx.log` output are surfaced; everything else is errors only.

**Caching / rate limits** — in-memory TTL cache (Redis stand-in): leads 15s, auth 60s. Fixed-window limiter by IP: auth 20/60s, manual scrape 3/30s.

## API

Under `/api`. User routes take a Supabase token via `Authorization: Bearer` **or** the `fc_token` cookie.

| Group | Routes |
| --- | --- |
| Health | `GET /health` (no auth) |
| Auth | `POST /auth/{register,login,refresh,logout,change-password}`, `GET/PATCH/DELETE /auth/me` |
| Leads | `GET /leads` (platform, q, status, bookmarked, ai, page, limit) · `GET/PATCH /leads/:id` · `PUT/DELETE /leads/:id/bookmark` · **`DELETE /leads`** (clear all, keeps bookmarks) |
| Bookmarks | `GET /bookmarks` |
| Config | `GET/PUT /config` |
| Credentials | `GET /credentials` · `PUT/DELETE /credentials/:platform` |
| Scrape | `POST /scrape/run` · `GET /scrape/{status,runs}` |
| CAPTCHA | `GET /scrape/captcha` · `POST /scrape/captcha/{click,dismiss}` · `GET /scrape/captcha/screenshot` |
| Analytics | `GET /analytics/{overview,platforms,trend,scrape-runs}` |
| Notifications | `GET /notifications` · `POST /notifications/read-all` · `POST /notifications/:id/read` |
| Billing | `GET /billing/{plans,subscription}` · `POST /billing/subscribe` (demo, no payment) |
| Internal | `GET /internal/users/:userId/config` · `GET /internal/platforms[/:platform/connections]` |

## Schema

RLS on every table; the server bypasses it with the service key, so **every query must scope by `user_id` explicitly**.

| Table | Purpose |
| --- | --- |
| `profiles` | 1:1 mirror of `auth.users` (email, name, plan) |
| `user_config` | Per-user scraping / notification / AI settings |
| `subscriptions` | Plan, usage counters, period dates |
| `leads` | Shared pool, de-duped by `source_hash` |
| `user_leads` | Per-user state: status, bookmark, notes, AI verdict/score/reason |
| `credentials` | Encrypted cookies per user per platform |
| `notifications` | Per-user feed |
| `scrape_runs` | Audit log of every run |

A trigger on `auth.users` INSERT auto-creates `profiles`, `user_config`, `subscriptions`.

`list_leads(p_user_id, p_platform, p_status, p_q, p_bookmarked, p_ai, p_limit, p_offset)` is the read path — it LEFT JOINs `user_leads`, so **a pool lead with no `user_leads` row still shows as `new`**. It excludes `status = 'dismissed'`.

## Not implemented

Discord/Reddit/LinkedIn scrapers · email + push notifications (config flags exist, no delivery) · Stripe (plan switching is instant, no payment).

## Disclaimer

Scraping these platforms may violate their ToS and can put the connected account at risk. Personal use, at your own discretion.
