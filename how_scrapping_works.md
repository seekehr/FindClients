# How scraping works

## When

- **Scheduled** — every 30 minutes by default (`SCRAPE_CRON`), plus up to 2 minutes of random jitter (`SCRAPE_JITTER_MS`), [scheduler/index.ts](server/src/scheduler/index.ts)
- **"Scrape now"** — `POST /api/scrape/run`, returns 202 immediately and runs in the background
- **Startup** — only if you set `SCRAPE_ON_START=true`

A `running` flag skips a cycle if one is already in progress, and "Scrape now" returns 409 rather than queueing. Runs take minutes, so this matters.

Off switches: `SCHEDULER_ENABLED=false` in `.env`, or **Scraping enabled** on the Config page.

## The cycle

```
runScrapeCycle()                       server/src/scrapers/runner.ts
  ├─ read config.json
  ├─ per scraper, one at a time:
  │    ├─ skip if the platform isn't enabled in your config
  │    ├─ skip if you haven't connected an account for it
  │    ├─ scrape()  → raw leads
  │    ├─ insertLeads()  → de-dupe into leads.json
  │    └─ AI review of anything without a verdict yet
  └─ notifyNewLeads()  → in-app feed + Discord webhook
```

**Serial, not parallel.** Each scraper launches its own Chromium. Two of those competing for a machine you are actively working on is the difference between a background task and a laptop that stops responding.

**Config is passed in, not fetched.** `ScrapeContext.config` carries your settings straight into `scrape()`. This used to be an authenticated HTTP call to the server's own `/api/internal` route — a boundary that existed so a scraper could run on a different machine. Nothing does, so the scraper was making a network round trip to the process it was already inside.

**Eligibility is a saved session.** No cookies for a platform, no scrape of it.

## De-duplication

Every lead gets `sha1(platform + (url || title))`. Already in `leads.json` → skipped. Listed in `dismissed.json` → skipped, which is what makes "Clear leads" stick instead of being undone by the next cycle. Bookmarked leads are never cleared.

`inserted` (genuinely new) drives notifications. `all` (new *and* already-known) is what the AI pass runs over, so switching qualification on later reviews the backlog rather than only new arrivals.

## Where each setting comes from

| Kind | Lives in | Examples |
| --- | --- | --- |
| What to look for | `data/config.json`, edited on the Config page | keywords, thresholds, limits, Upwork feed URL, AI criteria and key |
| How this machine runs a browser | root `.env` | headless, user agent, proxies, timeouts, cron |

Adding a `KEYWORDS` variable to `.env` would do nothing. That split is why.

## Reading the log

```
[Upwork] scrape started
[Upwork] collected 40 job(s)
[Upwork] dropped 12 job(s) older than 5h
[Upwork] scrape finished — found 28, inserted 3
```

`found` = returned by the scraper. `inserted` = new to `leads.json`. **High found, zero inserted is de-duplication working, not breakage** — it means the feed had nothing new since last time, which is the normal steady state.

`feed not visible yet — nudging` means stale cookies or a challenge page. It burns ~35s per attempt, three attempts, holding the cycle open. Re-paste your cookies on the Connections page.

## Known rough edges

1. **Keywords past the first two rarely run.** Twitter collects up to `twitterLimitPerKeyword` (15) per keyword but stops at `leadsPerRun` (25) overall — so keyword 1 gets 15, keyword 2 gets 10, and keywords 3+ never execute. Raise `leadsPerRun` or cut your keyword list.
2. **Upwork leads rarely notify.** Notifications require a keyword match, but Upwork jobs come from a feed rather than a keyword search, so most of them match nothing in your list.
3. **`ctx.since` is never set.** Every cycle re-scrapes the same window and relies on de-duplication to absorb it. Harmless, but it is why `found` stays high.
4. **CAPTCHA sessions live in memory.** They do not survive a restart — if you restart mid-challenge, the run is lost and the next cycle starts over.
