# How scraping works

> **Upwork is not scraped.** It is watched — one tab, reloaded every few
> minutes, new jobs announced after a random pause. That is a different system
> with a different file; see [The Upwork watcher](#the-upwork-watcher) at the
> bottom. Everything above it describes the scrape cycle, which today means
> X/Twitter.

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
  ├─ per scraper, one at a time (watch-mode platforms are not in this list):
  │    ├─ skip if the platform isn't enabled in your config
  │    ├─ skip if you haven't connected an account for it
  │    ├─ scrape()  → raw leads
  │    ├─ insertLeads()  → de-dupe into leads.json
  │    └─ AI review of anything without a verdict yet
  └─ notifyNewLeads()  → in-app feed + Discord webhook
```

**Serial, not parallel.** Each scraper launches its own Chromium. Two of those competing for a machine you are actively working on is the difference between a background task and a laptop that stops responding.

**Config is passed in, not fetched.** `ScrapeContext.config` carries your settings straight into `scrape()`. This used to be an authenticated HTTP call to the server's own `/api/internal` route — a boundary that existed so a scraper could run on a different machine. Nothing does, so the scraper was making a network round trip to the process it was already inside.

**Eligibility is a connected account.** A platform you have not signed in to on the Connections page is skipped. The session lives in the Chrome you started with `npm run chrome` (attached over CDP) or, without that, in a real Chromium user-data directory in `data/browser/<platform>/` — either way the scraper starts already logged in rather than replaying injected cookies.

**No sign-in during a scrape.** A launched profile's directory is locked by Chromium while a scrape has it open, so signing in is refused until the scrape finishes.

## De-duplication

Every lead gets `sha1(platform + (url || title))`. Already in `leads.json` → skipped. Listed in `dismissed.json` → skipped, which is what makes "Clear leads" stick instead of being undone by the next cycle. A dismissal lasts 30 days; `POST /api/leads/restore-cleared` forgets them all early. Bookmarked leads are never cleared.

`inserted` (genuinely new) drives notifications. `all` (new *and* already-known) is what the AI pass runs over, so switching qualification on later reviews the backlog rather than only new arrivals. Leads skipped because Gemini was rate-limited are left without a verdict for the same reason: the next pass that sees them reviews them.

## Where each setting comes from

| Kind | Lives in | Examples |
| --- | --- | --- |
| What to look for | `data/config.json`, edited on the Config page | keywords, thresholds, limits, Upwork feed URL, AI criteria and key |
| How this machine runs a browser | root `.env` | headless, user agent, proxies, timeouts, cron |
| Who you are | `data/chrome-profile/` (CDP) or `data/browser/<platform>/` | the signed-in browser profile itself |

Adding a `KEYWORDS` variable to `.env` would do nothing. That split is why.

## Reading the log

```
[Twitter/X] scrape started
[Twitter/X] scrape finished — found 28, inserted 3
```

`found` = returned by the scraper. `inserted` = new to `leads.json`. **High found, zero inserted is de-duplication working, not breakage** — it means the feed had nothing new since last time, which is the normal steady state.

## The Upwork watcher

Upwork used to be a scraper in the cycle above: open the feed, click "Load More" up to twenty times, open every job. That is the behaviour Upwork's terms forbid and its systems are built to catch, and it is what gets accounts suspended. It was removed rather than tuned down, and `upworkScraper` no longer has a `scrape()` method at all — `Scraper.scrape` is optional precisely so a watched platform can decline to have one.

What runs instead lives in [server/src/watcher/](server/src/watcher) and [scrapper/upwork/watch.ts](scrapper/upwork/watch.ts):

```
startWatcher()                        server/src/watcher/index.ts
  └─ every 5-10 minutes (redrawn each time, sometimes much longer):
       ├─ find the Upwork tab           scrapper/upwork/watch.ts
       │    ├─ already on the feed?     → reload it
       │    ├─ on Upwork, wrong page?   → send it to the feed
       │    └─ no Upwork tab at all?    → open one
       ├─ read the tiles on screen
       └─ for each job not already in leads.json or dismissed.json:
            └─ hold it 2-3 minutes (drawn per job, staggered), then:
                 ├─ optionally click through to that one job for client
                 │  details and the proposal count
                 ├─ insertLeads()  → the same de-duplication as everything else
                 └─ recordOpportunity()  → New Opportunities + Discord
```

**Every new job is announced.** There is no AI review and no keyword or budget filter on this path: the feed being watched is already your own Upwork search, so a second screen would only lose jobs and spend Gemini quota.

**The delays are the feature.** [`watcher/random.ts`](server/src/watcher/random.ts) is deliberately not uniform: intervals average two draws so they cluster toward the middle, roughly one in seven is a long break, and every value carries a few seconds of untidiness so no two gaps are the same round number. A perfectly even histogram is its own signature.

**The first read of a tab is a baseline.** Everything currently on the feed is recorded as known and not alerted on, except jobs young enough to have appeared while the tab was connecting. Without that, every restart would announce a day of old listings as brand new.

**It works in the tab you already have open.** Every poll re-scans all the browser's tabs rather than trusting the one it used last time — you may have closed it, or opened your own. Preference goes to a tab already on the feed, then any other `/nx/find-work` page, then anything else on Upwork, because the tab it picks is the tab it is about to reload and an arbitrary Upwork tab might be a proposal you are halfway through writing. A tab it opened itself is closed on Pause; a tab of yours that it adopted never is.

**A tab that wandered is navigated, not reloaded.** Upwork will bounce `/nx/find-work/most-recent` to `/nx/project-dashboard/?ref=fwh`, and reloading *that* forever is a watcher that never sees another job while reporting only `feed not visible yet — nudging`. The poll compares paths (not whole URLs — Upwork rewrites its own query string) and navigates back to your feed when they differ. If it still lands somewhere else, it says where, instead of nudging an unrelated page three times.

**Pausing drops the queue.** Held jobs were never stored, so the next run simply finds them on the feed again. Flushing them on Pause would defeat the pacing.

**One profile, one holder.** The watcher sits on the Upwork tab indefinitely, so an Upwork sign-in, session check or disconnect first suspends it and resumes it afterwards ([connections.routes.ts](server/src/routes/connections.routes.ts)). Only a watcher that was actually running is resumed. Other platforms use their own profile or tab, so signing in to X leaves it running.

**Where it surfaces.** `GET /api/watch` carries the state, the countdown to the next reload and the queue with its per-job countdown; the Opportunities page renders all three, so the pacing is visible instead of being something you have to trust.

## Known rough edges

1. **Keywords past the first two rarely run.** Twitter collects up to `twitterLimitPerKeyword` (15) per keyword but stops at `leadsPerRun` (25) overall — so keyword 1 gets 15, keyword 2 gets 10, and keywords 3+ never execute. Raise `leadsPerRun` or cut your keyword list.
2. **`ctx.since` is never set.** Every cycle re-scrapes the same window and relies on de-duplication to absorb it. Harmless, but it is why `found` stays high.
3. **Twitter has no challenge detection.** A challenge there looks like a run that found nothing. The Upwork watcher does detect them and reports `blocked`.
4. **A quiet Opportunities panel is the normal state.** The watcher looks at one screen of the feed every few minutes. Expect a handful of alerts a day, not a list of hundreds — that is the trade being made, on purpose.
5. **The watcher needs a browser that stays up.** Attached over CDP, closing the Chrome window closes the tab; the watcher notices, reports `Chrome down`, and reopens when it comes back.
6. **It will reload an Upwork tab of yours.** If the only Upwork tab open is one you were using, the watcher adopts it and reloads it on its own schedule. Keeping your feed open in its own tab is enough to avoid that — the feed is what it prefers.
