# scrapper/

Platform scrapers for FindClients. The server loads [`index.ts`](./index.ts) at runtime and runs every scraper in the exported `scrapers` array; de-duplication, storage and notifications are the server's job.

| Path | What |
| --- | --- |
| `twitter/` | X live-search scraper. **Reads `user_config`** (keywords, thresholds) |
| `upwork/` | Upwork feed scraper. **Ignores user config** — `.env` runtime settings only |
| `lib/captcha.ts` | CAPTCHA session manager — remote solving for headless runs |
| `lib/api.ts` | HTTP client for the server's `/api/internal` |
| `cli.ts` | Standalone runner, no server needed |
| `test-captcha.ts` | Headless CAPTCHA test against the 2captcha demo |

```bash
npm install && npx playwright install chromium   # one-time
```

## Sessions

Both scrapers run on the **connecting user's cookies**, pasted on the app's Connections page, stored encrypted, and handed over as `ScrapeContext.cookies`. No env auth tokens, no local Chrome/CDP. No connection → the scraper returns `[]`.

## The contract

```ts
import type { Scraper, RawLead, ScrapeContext } from '../server/src/scrapers/types';

export const myScraper: Scraper = {
  platform: 'upwork',          // 'upwork' | 'twitter' | 'discord' | 'reddit' | 'linkedin'
  name: 'Upwork',
  async scrape(ctx: ScrapeContext): Promise<RawLead[]> { return []; },
};
```

`ScrapeContext` carries `userId`, `cookies`, `limit`, `log`, and two CAPTCHA fields:

| Field | Meaning |
| --- | --- |
| `interactive?` | Browser is visible (CLI). Pause and let the user solve it in the window. |
| `onCaptcha?` | Headless. Hand the page off for remote solving; resolves `true` when solved. |

`RawLead`: `{ title, platform, description, budget?, timeline?, url?, author?, tags?, postedAt? }` — `url` drives de-duplication, so prefer a stable permalink.

Keep scrapers side-effect free (fetch → parse → return, never touch the DB). Throwing is safe: the server records it in `scrape_runs` and other scrapers keep running.

## CAPTCHA handling

**Wired into the Upwork scraper only** — Twitter has no challenge detection yet. Never skipped when a handler is available; `handleChallenge()` picks a strategy:

1. **`ctx.interactive`** (CLI, `headless: false`) — polls every 3s for up to 5 min while you solve it in the visible window.
2. **`ctx.onCaptcha`** (server, headless) — registers the live page with [`lib/captcha.ts`](./lib/captcha.ts) and blocks. The dashboard polls `GET /api/scrape/captcha`, shows the screenshot in a modal, and relays your clicks to the real browser via `POST /api/scrape/captcha/click`. Solved → the promise resolves and the scrape resumes. 5-minute timeout.
3. Neither → log and skip.

`lib/captcha.ts` owns all of this; the server only exposes the HTTP routes. It types pages as a minimal structural `CaptchaPage` interface (screenshot / mouse / url / title / viewportSize) so the server needs no Playwright dependency — Playwright's `Page` satisfies it.

Detection is keyword-based on URL + title (`captcha`, `challenge`, `verify`, `robot`, `blocked`); solved = those keywords are gone. Override per-site with `registerCaptcha(page, { platform, userId, isSolved })`. After each relayed click it waits for `networkidle` (5s cap) plus 2.5s so new tiles finish loading before the next screenshot.

```bash
npm run test-captcha           # → open http://localhost:3333 and click to solve
TEST_CAPTCHA_PORT=3334 npm run test-captcha
```

Boots headless Chromium against `2captcha.com/demo/recaptcha-v2` and serves a self-contained solver page — exercises the whole relay without the server or frontend.

## CLI

```bash
npm run cli
```

Reads [`cli_config.json`](./cli_config.example.json) (copy from the example). Paste a raw Cookie header into `upwork.cookie` / `twitter.cookie` in this folder. `headless: false` makes the browser visible and sets `interactive`, so CAPTCHAs pause for you.

## Getting user config

Scrapers never touch the DB — they ask the server over HTTP through [`lib/api.ts`](./lib/api.ts):

```ts
const config = await getUserConfig(ctx.userId);   // GET /api/internal/users/:userId/config
```

Authenticated with `INTERNAL_API_KEY`; `INTERNAL_API_URL` says where the server is. Cached 30s, so a Config-page change lands on the next run. `lib/env.ts` reads the root `.env` directly, so this works loaded in-process **or** standalone.

**Twitter uses this. Upwork deliberately does not** — it scrapes `find-work/most-recent` with no age filter, so a config with a narrow `maxAgeHours` can't silently zero out the run.

## Env

Runtime (machine-level) settings only; search settings live in `user_config`.

| Var | Default |
| --- | --- |
| `UPWORK_HEADLESS` / `X_HEADLESS` | `true` |
| `UPWORK_USER_AGENT` / `X_USER_AGENT` | Chrome 125 UA |
| `UPWORK_REQUEST_DELAY_MS` | `1500` |
| `UPWORK_DETAIL_TIMEOUT_MS` | `10000` |
| `UPWORK_LOAD_MORE_WAIT_MS` | `15000` |
| `UPWORK_MAX_LOAD_MORE` | `20` |
| `X_PROXY_LIST` | — (comma-separated, rotating) |

## Adding a scraper

1. Implement `scrape()` in a new folder.
2. Add it to the `scrapers` array in [`index.ts`](./index.ts).
3. If the platform is new, add it to the `platform` enum in `server/src/types.ts` so users can pick it on the Config page.

> Both scrapers depend on the sites' current markup and Terms of Service. Expect to maintain selectors, and use them responsibly.
