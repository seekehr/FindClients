# scrapper/

Platform scrapers for FindClients.

The server (`../server`) loads `index.ts` at runtime, runs every scraper you list
in the exported `scrapers` array on a schedule, then handles de-duplication,
storage, and notifications for you.

| Platform      | Status                                                          |
| ------------- | -------------------------------------------------------------- |
| **twitter/**  | ✅ Implemented — headless Playwright scraper of X live search.  |
| **upwork/**   | ✅ Implemented — headless Playwright scraper of the Upwork feed. |
| discord/      | Placeholder for you to implement.                              |

## Setup

This folder is its own npm package (so it owns its scraping dependencies):

```bash
cd scrapper
npm install
npx playwright install chromium   # one-time browser download
```

## Sessions come from the app (per-user cookies)

Both scrapers are driven by the **connecting user's session cookies**, provided
through the web app's **Connections** page (Settings → Connect account → paste
the Cookie header). The server stores those cookies encrypted and hands them to
the scraper for each run via `ScrapeContext.cookies`. No env auth tokens, no
local Chrome / remote-debugging setup.

If a user hasn't connected a platform, that platform's scraper simply returns
`[]` for them.

## X / Twitter scraper

Launches headless Chromium, injects the user's X cookies (must include
`auth_token`), runs live search for the user's keywords (falling back to
the user's keywords), and extracts hiring-intent tweets. Search settings —
keywords, like/view thresholds, per-keyword limit, post age — come from the
user's `user_config` row (Config page). Only `X_HEADLESS`, `X_PROXY_LIST` and
`X_USER_AGENT` are read from the global `.env`.

## Upwork scraper

Launches headless Chromium, injects the user's Upwork cookies, and pages through
the "most recent" feed until jobs exceed the age cutoff, then (by default) opens
each job's detail page for the client's rating + hire rate.

The reference had two scripts (deep scrape + polling monitor) that connected to a
local Chrome over CDP. Here they collapse into one idempotent `scrape()` driven
by per-user cookies: the server's scheduler does the polling and de-duplicates by
URL, so only genuinely new jobs surface. The feed URL, age window and whether to
enrich come from the user's `user_config` row (Config page); `UPWORK_HEADLESS`,
the timeouts and the politeness delay come from the global `.env` (see
[`../.env.example`](../.env.example)).

> Note: CAPTCHAs can't be solved from the server process — the scraper detects a
> challenge, logs it, and returns what it has (the user may need to re-connect a
> fresh session). Both scrapers depend on the sites' current markup and Terms of
> Service; expect to maintain selectors and use them responsibly.

## The contract

Every scraper implements the `Scraper` interface from the server:

```ts
import type { Scraper, RawLead, ScrapeContext } from '../server/src/scrapers/types';

export const myScraper: Scraper = {
  platform: 'upwork',           // 'upwork' | 'twitter' | 'discord' | 'reddit' | 'linkedin'
  name: 'Upwork',
  async scrape(ctx: ScrapeContext): Promise<RawLead[]> {
    // fetch → parse → return. Returning [] is fine.
    return [];
  },
};
```

`ctx` carries the running user's identity, their decrypted platform cookies, and
`ctx.config` — their saved configuration from the app's **Config** page. Env vars
are only *defaults*: pass `ctx.config` values into your `loadXConfig({ … })` call
so a change in the UI takes effect on the next cycle, the way `twitter/index.ts`
and `upwork/index.ts` already do.

A `RawLead` looks like:

```ts
{
  title: string;
  platform: Platform;
  description: string;
  budget?: string | null;
  timeline?: string | null;
  url?: string | null;      // used for de-duplication — prefer a stable permalink
  author?: string | null;
  tags?: string[];
  postedAt?: string | Date; // when it was posted on the source
}
```

## Wiring it up

1. Implement the `scrape()` method in `upwork/`, `twitter/`, or a new folder.
2. Add the scraper to the `scrapers` array in [`index.ts`](./index.ts).
3. Add the platform to the `platform` enum in `server/src/types.ts` if it is new,
   so users can select it on the Config page.

## Notes

- Keep scrapers side-effect free: fetch + parse + return. Don't touch the DB.
- Respect each platform's Terms of Service and rate limits.
- Throwing is safe — the server records the failure in `scrape_runs` and keeps
  the other scrapers running.
