# How scraping works

## When

- **Cron** — every 2 min (`SCRAPE_CRON`), [scheduler/index.ts:22](server/src/scheduler/index.ts:22)
- **Server startup** — one immediate run
- **"Scrape now"** — `POST /api/scrape/run`, one user, returns 202

A `running` flag skips overlapping ticks. Runs take minutes, so most ticks are skipped.
Off switch: `SCHEDULER_ENABLED=false`, or `user_config.scrape_enabled = false` per user.

## Why it auto-starts

Config is written at **sign-up**, not scrape time. New accounts default to
`scrape_enabled = true` + 5 keywords ([0001_init.sql:61](supabase/migrations/0001_init.sql:61)).
That's why the log searches phrases you never typed.

## How

```
runScrapeCycle()
  ├─ per scraper (parallel): every user with saved cookies
  │    └─ per user (serial): load their config → scrape → insert → AI review
  └─ notifyNewLeads()
```

- **Eligibility = a `credentials` row.** No cookies, no scrape.
- **Keywords aren't passed in.** The scraper fetches its own config over HTTP
  (`GET /api/internal/users/:id/config`), so it can run out-of-process.
- **Per-user** (DB): keywords, thresholds, limits. **Per-machine** (`.env`): headless, UA, proxies, cron.
- **After:** dedupe on `sha1(platform + url||title)` into a *global* pool → AI review with the
  user's own Gemini key → notifications.

## Gotchas

1. **Upwork ignores `user_config`** — feed URL hardcoded ([upwork/index.ts:299](scrapper/upwork/index.ts:299)); `upwork_jobs_url`, `upwork_max_age_hours`, `upwork_fetch_details` do nothing.
2. **Keywords 3–5 never run** — total capped at `leadsPerRun` (25), 15 per keyword → 15+10 and done.
3. **Upwork leads rarely notify** — notifications need a keyword match; Upwork jobs come from a feed, not a search.
4. **`ctx.since` never set** — every cycle re-scrapes the same window, dedup catches it.
5. **AI summary log swallowed** — `reviewForUser` passes `() => {}` ([runner.ts:110](server/src/scrapers/runner.ts:110)).
6. **"Scrape now" can be dropped** if a background cycle is mid-run.
7. **CAPTCHA sessions are in-memory** — die on restart, break with >1 instance.
8. **Lead pool is global** — users see leads their own cookies never fetched.

## Log

`found` = scraped, `inserted` = new to the pool. High found / zero inserted is dedup working, not breakage.

Upwork `feed not visible yet — nudging` = stale cookies or a challenge page. Burns ~35s per
attempt, 3 attempts, holding the cycle open.
