# scrapper/

Platform scrapers for FindClients. The server loads [`index.ts`](./index.ts) at runtime and runs every scraper in the exported `scrapers` array; de-duplication, storage and notifications are the server's job.

| Path | What |
| --- | --- |
| `twitter/` | X live-search scraper — keywords, like/view thresholds, age window |
| `upwork/` | Upwork feed scraper — feed URL, age window, optional detail enrichment |
| `lib/captcha.ts` | CAPTCHA session manager — remote solving for headless runs |
| `lib/local.ts` | Reads `data/config.json` and `data/credentials.json` for standalone tools |
| `cli.ts` | Standalone runner, no app needed |
| `test-captcha.ts` | Headless CAPTCHA test against the 2captcha demo |

```bash
npm run setup    # from the repository root — installs this and downloads Chromium
```

## Sessions

Both scrapers run on **your** cookies, pasted on the app's Connections page, saved to `data/credentials.json`, and handed over as `ScrapeContext.cookies`. Each launches its own Chromium — there is no local Chrome to start and no remote-debugging port to open. No saved session → the scraper logs it and returns `[]`.

## The contract

```ts
import type { Scraper, RawLead, ScrapeContext } from '../server/src/scrapers/types';

export const myScraper: Scraper = {
  platform: 'upwork',          // 'upwork' | 'twitter' | 'discord' | 'reddit' | 'linkedin'
  name: 'Upwork',
  async scrape(ctx: ScrapeContext): Promise<RawLead[]> { return []; },
};
```

`ScrapeContext` carries `config` (your saved settings), `cookies`, `limit`, `log`, and two CAPTCHA fields:

| Field | Meaning |
| --- | --- |
| `interactive?` | Browser is visible (CLI). Pause and let the user solve it in the window. |
| `onCaptcha?` | Headless. Hand the page off for remote solving; resolves `true` when solved. |

`RawLead`: `{ title, platform, description, budget?, timeline?, url?, author?, tags?, postedAt? }` — `url` drives de-duplication, so prefer a stable permalink.

Keep scrapers side-effect free (fetch → parse → return, never write anything). Throwing is safe: the server records the failure in `data/runs.json` and the remaining scrapers still run.

## CAPTCHA handling

**Wired into the Upwork scraper only** — Twitter has no challenge detection yet. Never skipped when a handler is available; `handleChallenge()` picks a strategy:

1. **`ctx.interactive`** (CLI, `headless: false`) — polls every 3s for up to 5 min while you solve it in the visible window.
2. **`ctx.onCaptcha`** (server, headless) — registers the live page with [`lib/captcha.ts`](./lib/captcha.ts) and blocks. The dashboard polls `GET /api/scrape/captcha`, shows the screenshot in a modal, and relays your clicks to the real browser via `POST /api/scrape/captcha/click`. Solved → the promise resolves and the scrape resumes. 5-minute timeout.
3. Neither → log and skip.

`lib/captcha.ts` owns all of this; the server only exposes the HTTP routes. It types pages as a minimal structural `CaptchaPage` interface (screenshot / mouse / url / title / viewportSize) so the server needs no Playwright dependency — Playwright's `Page` satisfies it.

Detection is keyword-based on URL + title (`captcha`, `challenge`, `verify`, `robot`, `blocked`); solved = those keywords are gone. Override per-site with `registerCaptcha(page, { platform, isSolved })`. After each relayed click it waits for `networkidle` (5s cap) plus 2.5s so new tiles finish loading before the next screenshot.

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

## Getting your config

It arrives on the context — `ctx.config` — already read from `data/config.json` by the server. Both scrapers use it: Twitter for keywords and thresholds, Upwork for the feed URL, age window and whether to enrich from detail pages.

That used to be an authenticated HTTP call to the server's `/api/internal`, so a scraper could run on a different machine from the API. Nothing does, so it was a network round trip into the same process.

For the standalone tools, [`lib/local.ts`](./lib/local.ts) reads `data/` off disk directly, which is why the smoke tests work with the app stopped.

## Env

Runtime (machine-level) settings only. What to search for lives in `data/config.json`.

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
