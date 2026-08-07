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
import { getUserConfig } from '../lib/api';

export const myScraper: Scraper = {
  platform: 'upwork',           // 'upwork' | 'twitter' | 'discord' | 'reddit' | 'linkedin'
  name: 'Upwork',
  async scrape(ctx: ScrapeContext): Promise<RawLead[]> {
    const config = await getUserConfig(ctx.userId);   // ← over HTTP, see below
    // fetch → parse → return. Returning [] is fine.
    return [];
  },
};
```

`ctx` carries only what the caller can't be expected to fetch: the running
user's id, their decrypted platform cookies, a soft `limit`, and `log`.

## Getting the user's config

Scrapers never touch the database. They ask the **server** for the running
user's configuration over HTTP, through the client in
[`lib/api.ts`](./lib/api.ts):

```ts
import { getUserConfig, getPlatformConnections } from '../lib/api';

const config = await getUserConfig(ctx.userId);
config.keywords              // from the app's Config page
config.twitterMinLikes       // …not from an env var
```

Under the hood that is `GET /api/internal/users/:userId/config`, authenticated
with the `INTERNAL_API_KEY` shared secret from the root `.env`. Responses are
cached for 30s so a scrape cycle doesn't re-fetch per platform, and a change on
the Config page still lands on the next run.

Two variables in the root `.env` drive it:

| Var                | Purpose                                                  |
| ------------------ | -------------------------------------------------------- |
| `INTERNAL_API_URL` | Where the server is, e.g. `http://localhost:4000/api`    |
| `INTERNAL_API_KEY` | Shared secret; the server rejects the call without it     |

`lib/env.ts` reads the root `.env` itself, so this works whether the scrapers
are loaded in-process by the server or run standalone.

### Running standalone

Because config and sessions both come over HTTP, a scraper needs nothing from
the server process to run:

```ts
import { getPlatformConnections } from './lib/api';
import { twitterScraper } from './twitter';

for (const conn of await getPlatformConnections('twitter')) {
  const leads = await twitterScraper.scrape({
    userId: conn.userId,
    cookies: conn.cookies,
    limit: conn.config.leadsPerRun,
    log: console.log,
  });
}
```

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
