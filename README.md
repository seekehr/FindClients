# FindClients

A self-hosted lead-discovery platform for freelancers. It scrapes Upwork and Twitter/X for opportunities matching your keywords, optionally qualifies them with Claude AI, and surfaces them in a dashboard with notifications.

## Repository layout

| Folder | What it is |
| --- | --- |
| [`website/`](website) | Next.js 16 frontend (React 19, Tailwind CSS 4, shadcn/ui). |
| [`server/`](server) | Express API server — auth, config, leads, scheduling, notifications, AI qualification. |
| [`scrapper/`](scrapper) | Playwright-based scrapers for Twitter/X and Upwork. |
| [`supabase/`](supabase) | Postgres schema (two SQL migrations). |

There is no root `package.json`; each workspace is independent.

## Quick start

### 1. Configure

Copy [`.env.example`](.env.example) to `.env` and fill in at minimum:

| Variable | Required | Purpose |
| --- | --- | --- |
| `SUPABASE_URL` | Yes | Supabase project URL |
| `SUPABASE_SERVICE_KEY` | Yes | Service-role key (bypasses RLS) |
| `ENCRYPTION_KEY` | Recommended | AES-256-GCM key for cookie encryption (has an insecure default) |
| `ANTHROPIC_API_KEY` | No | Enables AI lead qualification via Claude |
| `INTERNAL_API_KEY` | No | Shared secret for scraper-to-server auth (empty = disabled) |

See `.env.example` for the full list of optional variables (scheduler cron, CORS origins, proxy lists, scraper tuning, etc.).

### 2. Create the database schema

In the Supabase dashboard, open **SQL Editor**, paste and run both migrations in order:

1. [`supabase/migrations/0001_init.sql`](supabase/migrations/0001_init.sql) — core tables, RLS policies, provisioning triggers
2. [`supabase/migrations/0002_ai_and_metadata.sql`](supabase/migrations/0002_ai_and_metadata.sql) — AI columns and lead metadata

Both are idempotent.

### 3. Run it

```bash
# Backend (starts API server + scheduler + scrapers)
cd server && npm install && npm run dev            # http://localhost:4000

# Scrapers need a browser engine
cd scrapper && npm install && npx playwright install chromium

# Frontend (new terminal)
cd website && npm install && npm run dev           # http://localhost:3000
```

Open http://localhost:3000, sign up, configure keywords and platforms on the **Config** page, then go to **Connections** to paste your platform session cookies. The scheduler scrapes automatically every 2 minutes (configurable via `SCRAPE_CRON`), and new leads appear on the Leads page.

## How it works

### Scraping pipeline

1. **Scheduler** (`node-cron`, default every 2 minutes) triggers `runScrapeCycle()`.
2. **Loader** dynamically imports scrapers from `scrapper/index.ts`.
3. For each scraper × each user with a connection for that platform:
   - User's encrypted cookies are decrypted and injected into a headless Chromium browser.
   - The scraper navigates the platform, extracts leads, and returns `RawLead[]`.
4. Leads are de-duplicated by `source_hash` (SHA-1 of `platform::url`) and inserted into the shared `leads` pool.
5. Per-user state is created in `user_leads` (status, bookmarks, AI verdict).
6. If AI is enabled, leads are qualified via the Anthropic API (see below).
7. Notifications are fanned out to all users whose filters match the new leads.

An audit trail is kept in the `scrape_runs` table.

### Twitter/X scraper

- Injects the user's `auth_token` cookie and navigates to Twitter's live search.
- Searches each configured keyword, scrolls to collect tweets, and extracts: text, author, timestamp, likes, reposts, replies, views, hashtags.
- Filters by minimum likes, minimum views, and post age.
- Supports rotating proxies (`X_PROXY_LIST` env var) and configurable user agent.
- Adds random human-like delays (1–7 seconds) between actions.

### Upwork scraper

- Injects session cookies and navigates to the user's configured jobs feed URL.
- Parses job tiles and paginates via the "Load More Jobs" button (up to 20 clicks by default).
- Extracts: title, URL, description, rate/budget, proposals count, posted time, client spend, payment verification, country, rating, skills.
- Optionally visits each job's detail page for richer client info (hire rate, rating).
- Detects CAPTCHA challenges and stops gracefully, returning what was collected.

### AI lead qualification

When `ANTHROPIC_API_KEY` is set and a user enables AI in their config:

- Uses the Anthropic SDK with structured JSON output.
- Default model: `claude-opus-5` (users can choose `claude-sonnet-5` or `claude-haiku-4-5`).
- Each lead is scored 0–100 with a qualified/rejected verdict and a reason.
- The user's custom AI prompt (set on the Config page) is included as screening criteria.
- Results are stored per-user in `user_leads` (`ai_verdict`, `ai_score`, `ai_reason`).
- If `ai_auto_archive` is on, rejected leads the user hasn't touched are archived automatically.
- Leads can be filtered by AI verdict in the dashboard.
- Batch size: 4 concurrent reviews.

### Authentication

- **Supabase Auth** manages identity. The browser never holds the service key.
- Registration auto-confirms emails in dev (`SUPABASE_AUTO_CONFIRM_EMAILS=true`).
- The `requireAuth` middleware validates tokens by calling `supabase.auth.getUser()` with 60-second in-memory caching.
- A Postgres trigger on `auth.users` INSERT auto-creates rows in `profiles`, `user_config`, and `subscriptions`.

### Credential storage

- Platform session cookies are encrypted with **AES-256-GCM** (random 12-byte IV per record).
- The encryption key is derived from the `ENCRYPTION_KEY` env var via SHA-256.
- Cookies are never returned by the API — only masked status info (cookie count, connection status, timestamps).
- The internal API (`/api/internal`) decrypts cookies for scraper use, authenticated by a shared secret.

### Notifications

| Channel | Status |
| --- | --- |
| In-app (stored in `notifications` table) | Implemented |
| Discord webhooks (per-user webhook URL) | Implemented |
| Email | Not implemented (config flag exists, logs only) |
| Push | Not implemented (config flag exists, no code) |

Notifications are filtered per-user by platform, keywords, excluded keywords, and minimum budget.

### Caching and rate limiting

- **In-memory TTL cache** (stand-in for Redis). Default TTL 30 seconds.
- Used for: lead list caching (15s), auth token resolution (60s), rate limiting.
- **Fixed-window rate limiter** keyed by IP: auth routes (20 req/60s), manual scrape trigger (3 req/30s).

## API routes

All routes are under `/api`. User routes require a Supabase Bearer token.

| Route | Auth | Description |
| --- | --- | --- |
| `GET /health` | None | Server status, uptime, lead count |
| `POST /auth/register` | None | Create account |
| `POST /auth/login` | None | Get access + refresh tokens |
| `POST /auth/refresh` | None | Refresh access token |
| `GET /auth/me` | User | Current user profile |
| `PATCH /auth/me` | User | Update profile |
| `POST /auth/change-password` | User | Change password |
| `POST /auth/logout` | User | Invalidate session |
| `DELETE /auth/me` | User | Delete account |
| `GET /leads` | User | Paginated leads (filter by platform, search, status, bookmarked, AI verdict) |
| `GET /leads/:id` | User | Single lead with AI data |
| `PATCH /leads/:id` | User | Update lead status |
| `PUT /leads/:id/bookmark` | User | Bookmark a lead |
| `DELETE /leads/:id/bookmark` | User | Remove bookmark |
| `GET /bookmarks` | User | Paginated bookmarked leads |
| `GET /config` | User | User config + connected platforms + AI availability |
| `PUT /config` | User | Update config (partial) |
| `PUT /credentials/:platform` | User | Connect platform (paste cookie string) |
| `GET /credentials` | User | List connections (masked) |
| `DELETE /credentials/:platform` | User | Disconnect platform |
| `POST /scrape/run` | User | Trigger manual scrape (rate-limited) |
| `GET /scrape/status` | User | Is a scrape running? |
| `GET /scrape/runs` | User | Scrape history |
| `GET /analytics/overview` | User | Dashboard stats |
| `GET /analytics/platforms` | User | Leads by platform |
| `GET /analytics/trend` | User | Leads per day (configurable window) |
| `GET /analytics/scrape-runs` | User | Recent scrape runs |
| `GET /notifications` | User | Notification feed (filter by unread) |
| `POST /notifications/read-all` | User | Mark all read |
| `POST /notifications/:id/read` | User | Mark one read |
| `GET /billing/plans` | None | Available plans |
| `GET /billing/subscription` | User | Current subscription |
| `POST /billing/subscribe` | User | Switch plan (demo — no payment) |
| `GET /internal/users/:userId/config` | Internal | User config for scrapers |
| `GET /internal/platforms/:platform/connections` | Internal | Decrypted cookies for a platform |
| `GET /internal/platforms` | Internal | Available platforms |

## Database schema

Postgres on Supabase with Row Level Security on every table.

| Table | Purpose |
| --- | --- |
| `profiles` | 1:1 mirror of `auth.users` (email, name, plan) |
| `user_config` | Per-user scraping, notification, and AI settings |
| `subscriptions` | Plan, usage counters, period dates |
| `leads` | Shared pool of discovered leads (de-duped by `source_hash`) |
| `user_leads` | Per-user lead state: status, bookmarks, notes, AI verdict/score/reason |
| `credentials` | Encrypted session cookies per user per platform |
| `notifications` | Per-user notification feed |
| `scrape_runs` | Audit log of every scrape execution |

## Tech stack

| Layer | Technology |
| --- | --- |
| Frontend | Next.js 16, React 19, Tailwind CSS 4, shadcn/ui, Lucide icons |
| Backend | Node.js (>= 22.5), Express, TypeScript (via tsx) |
| Scrapers | Playwright (headless Chromium) |
| Database | Supabase Postgres |
| Auth | Supabase Auth |
| AI | Anthropic SDK (Claude) |
| Validation | Zod |
| Security | Helmet, AES-256-GCM encryption, CORS |

## What's not yet implemented

- **Discord scraper** — platform is defined in types but no scraper exists.
- **Email notifications** — config flag exists but sends nothing.
- **Push notifications** — config flag exists, no code.
- **Billing / Stripe** — plans exist but switching is instant with no payment processing.
- **Reddit, LinkedIn, Freelancer scrapers** — not started.

## Disclaimer

Scraping real platforms may violate their Terms of Service and can put the connected account at risk. This tool is for personal use at your own discretion.
