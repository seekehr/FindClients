# scrapper/

Platform scrapers for FindClients. The server loads [`index.ts`](./index.ts) at runtime and runs every scraper in the exported `scrapers` array; de-duplication, storage and notifications are the server's job.

| Path | What |
| --- | --- |
| `twitter/` | X live-search scraper — keywords, like/view thresholds, age window |
| `upwork/` | Upwork feed scraper — feed URL, age window, optional detail enrichment |
| `lib/profile.ts` | Persistent Chromium profiles — one per platform, where sessions live |
| `lib/local.ts` | Reads `data/config.json` for the standalone tools |
| `cli.ts` | Standalone runner and `--sign-in`, no app needed |

```bash
npm run setup    # from the repository root — installs this and downloads Chromium
```

## Sessions

Each platform owns a **persistent Chromium profile** in `data/browser/<platform>/` — a real Chrome user-data directory. You sign in once through a visible window (`scraper.signIn()`), and every run after that opens the same profile already logged in.

```
signIn()      → visible window at the login page → profile saved
scrape()      → same profile, headless, already signed in
checkSession()→ same profile, headless, "does this still work?"
signOut()     → delete the directory
```

There are no cookies anywhere in this design. `ScrapeContext` carries no credential, the server stores none, and nothing has to be re-pasted when a token rotates — a real browser refreshes its own session as it is used.

**One process may hold a profile at a time.** Chromium locks the directory; `openProfile` turns that lock into a readable error, and the server refuses to sign in during a scrape (and vice versa).

No profile → the scraper logs it and returns `[]`.

## The contract

```ts
import type { Scraper, RawLead, ScrapeContext } from '../server/src/scrapers/types';

export const myScraper: Scraper = {
  platform: 'upwork',          // 'upwork' | 'twitter' | 'discord' | 'reddit' | 'linkedin'
  name: 'Upwork',
  async scrape(ctx: ScrapeContext): Promise<RawLead[]> { return []; },
};
```

Beyond `scrape()`, a `Scraper` implements `checkSession()`, `signIn()` and `signOut()` — each platform knows where its own login page is and how to tell signed-in from signed-out, so the server never learns anything platform-specific.

`ScrapeContext` carries `config` (your saved settings), `limit`, `log`, and two challenge fields:

| Field | Meaning |
| --- | --- |
| `interactive` | A person is at the machine — you may open a visible window and wait. |
| `captchaTimeoutMs` | How long to leave that window open before giving up. |

`RawLead`: `{ title, platform, description, budget?, timeline?, url?, author?, tags?, postedAt? }` — `url` drives de-duplication, so prefer a stable permalink.

Keep scrapers side-effect free (fetch → parse → return, never write anything). Throwing is safe: the server records the failure in `data/runs.json` and the remaining scrapers still run.

## Bot challenges

Scrapers normally run headless. Headless cannot solve a CAPTCHA, and Playwright cannot make a running headless browser visible — so when a challenge is detected, the Upwork scraper **closes the browser and runs the whole pass again with `headless: false`**, putting the challenge in a window you can actually click. Solve it and the run continues; the second pass restarts from the top of the feed, which de-duplication absorbs.

```
runPass(headless: true)  → blocked
      ↓  ctx.interactive
runPass(headless: false) → you solve it → leads
```

If nobody solves it inside `captchaTimeoutMs` (5 min default), the run gives up and whatever the headless pass collected is returned rather than thrown away. The next cycle starts clean.

**This assumes you are at the machine.** A scheduled run at 3am that hits a challenge opens a window nobody sees and times out, costing that one cycle. That is the deliberate trade for deleting the screenshot-relay solver: ~500 lines, four HTTP routes, an in-memory session store that died on restart, and a dashboard modal — replaced by opening a browser window.

Set `CAPTCHA_OPEN_WINDOW=false` to skip challenges outright instead of opening anything.

Detection is keyword-based on URL + title (`captcha`, `challenge`, `verify`, `robot`, `blocked`); solved means those keywords are gone. **Wired into the Upwork scraper only** — Twitter has no challenge detection yet.

```bash
npm run cli
```

Reads [`cli_config.json`](./cli_config.example.json) (copy from the example) for search settings, and the shared browser profiles for sessions. `headless: false` makes the browser visible from the start. Either way the CLI is always `interactive`, so a challenge opens a window for you.

Sign in from the terminal with `npm run cli -- --sign-in upwork` (or `twitter`). It writes the same profile the app uses, so signing in either place works for both.

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
