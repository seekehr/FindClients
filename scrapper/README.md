# scrapper/

Platform collectors for FindClients. The server loads [`index.ts`](./index.ts) at runtime; de-duplication, storage and notifications are the server's job.

There are **two exported lists**, and which one a platform is in is a decision about that platform's terms of service:

- `scrapers` — everything the server can sign in to. Those with `mode: 'scrape'` are also run by the scheduled cycle.
- `watchers` — long-lived tabs, for platforms that must not be scraped. Upwork is the only one: bulk collection breaks its terms and gets accounts banned, so it gets one tab left open on the feed instead. `upworkScraper` is still in `scrapers` for sign-in and session checks, but with `mode: 'watch'` and **no `scrape()` method at all**, so the cycle cannot collect from it even by accident.

| Path | What |
| --- | --- |
| `twitter/` | X live-search scraper — keywords, like/view thresholds, age window |
| `upwork/` | Upwork connector — sign-in, session checks, feed parsing |
| `upwork/watch.ts` | The Upwork tab: reload, read, occasionally click through to one job |
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
scrape()      → same profile, headless, already signed in   (scrape mode)
watcher.open()→ same profile, visible, tab held open        (watch mode)
checkSession()→ same profile, headless, "does this still work?"
signOut()     → delete the directory
```

There are no cookies anywhere in this design. `ScrapeContext` carries no credential, the server stores none, and nothing has to be re-pasted when a token rotates — a real browser refreshes its own session as it is used.

**One process may hold a profile at a time.** Chromium locks the directory; `openProfile` turns that lock into a readable error, the server refuses to sign in during a scrape, and the Upwork watcher is suspended for the duration of a sign-in or session check and resumed afterwards.

No profile → the scraper logs it and returns `[]`.

## The contract

```ts
import type { Scraper, RawLead, ScrapeContext } from '../server/src/scrapers/types';

export const myScraper: Scraper = {
  platform: 'twitter',         // 'upwork' | 'twitter' | 'discord' | 'reddit' | 'linkedin'
  name: 'Twitter/X',
  mode: 'scrape',              // 'watch' platforms omit scrape() entirely
  async scrape(ctx: ScrapeContext): Promise<RawLead[]> { return []; },
};
```

Beyond `scrape()`, a `Scraper` implements `checkSession()`, `signIn()` and `signOut()` — each platform knows where its own login page is and how to tell signed-in from signed-out, so the server never learns anything platform-specific.

A watched platform implements `PlatformWatcher` instead of `scrape()`:

```ts
export const myWatcher: PlatformWatcher = {
  platform: 'upwork',
  name: 'Upwork job alerts',
  async open(opts: WatchTabOptions): Promise<WatchTab> { /* ... */ },
};
```

`WatchTab` is one open page with `poll()` (find the tab, put it on the feed, read it — never paginate), an optional `inspect(url)` for the single click-through before an alert, `isOpen()` and `close()`. Timing is not its business: when to reload and how long to hold a job live in [server/src/watcher/](../server/src/watcher), because they are properties of the whole system rather than of one page.

Every `poll()` re-resolves which tab to use out of `context.pages()`, preferring one already on the feed, then any other `/nx/find-work` page, then anything else on Upwork. It reloads that tab when it is already on the feed and navigates it there when it is not — Upwork redirects `find-work` to the project dashboard often enough that reloading whatever the tab happens to show is how a watcher goes quiet for hours. Tabs it opened itself are closed on `close()`; tabs of yours that it adopted are not.

`ScrapeContext` carries `config` (your saved settings), `limit`, `log`, and two challenge fields:

| Field | Meaning |
| --- | --- |
| `interactive` | A person is at the machine — you may open a visible window and wait. |
| `captchaTimeoutMs` | How long to leave that window open before giving up. |

`RawLead`: `{ title, platform, description, budget?, timeline?, url?, author?, tags?, postedAt? }` — `url` drives de-duplication, so prefer a stable permalink.

Keep scrapers side-effect free (fetch → parse → return, never write anything). Throwing is safe: the server records the failure in `data/runs.json` and the remaining scrapers still run.

## Bot challenges

The Upwork watcher is never headless — it lives in a browser window you already have open — so a challenge is simply on screen in front of you. `poll()` detects it, waits up to `captchaTimeoutMs` (5 min default) for you to click through, and carries on. Nobody there in time and the poll reports `blocked`; the next look, a few minutes later, tries again.

```
poll() → challenge on screen → you solve it → jobs
                             → nobody there  → problem: 'blocked', retry later
```

**This assumes you are at the machine.** A challenge at 3am waits in a window nobody sees and times out, costing that one look. That is the deliberate trade for deleting the screenshot-relay solver: ~500 lines, four HTTP routes, an in-memory session store that died on restart, and a dashboard modal — replaced by a browser window you were already looking at.

Set `CAPTCHA_OPEN_WINDOW=false` to skip challenges outright instead of waiting.

Detection is keyword-based on URL + title (`captcha`, `challenge`, `verify`, `robot`, `blocked`), plus a 403/503 on the navigation itself, which is how Cloudflare's "Just a moment..." arrives. Solved means those signals are gone. **Wired into Upwork only** — Twitter has no challenge detection yet.

## CLI

```bash
npm run cli
```

Reads [`cli_config.json`](./cli_config.example.json) (copy from the example) for search settings, and the shared browser profiles for sessions. `headless: false` makes the browser visible from the start. Either way the CLI is always `interactive`, so a challenge opens a window for you.

**It skips Upwork**, and deliberately: Upwork is watched, not scraped, and a terminal escape hatch would put back exactly what was removed. Run the app and open **New Opportunities** for job alerts. `upwork/__smoke.ts` performs one reload of the feed as a diagnostic.

Sign in from the terminal with `npm run cli -- --sign-in upwork` (or `twitter`). It writes the same profile the app uses, so signing in either place works for both.

## Getting your config

It arrives on the context — `ctx.config` — already read from `data/config.json` by the server; Twitter uses it for keywords and thresholds. A watcher gets its settings the same way, through `WatchTabOptions`: the feed URL and whether to click through for client details. The reload and hold windows never reach the scrapper workspace at all — the server keeps those, because they govern the whole system's footprint rather than one page's behaviour.

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
| `X_PROXY_LIST` | — (comma-separated, rotating) |

`UPWORK_HEADLESS` only affects the one-off session check. The watcher is always visible. How often it reloads and how long it holds a job are decisions about your account, so they live in `data/config.json` and are edited on the Config page.

## Adding a scraper

1. Implement `scrape()` in a new folder, with `mode: 'scrape'`.
2. Add it to the `scrapers` array in [`index.ts`](./index.ts).
3. If the platform is new, add it to the `platform` enum in `server/src/types.ts` so users can pick it on the Config page.

If the platform's terms forbid automated collection, do not add a `scrape()` — implement a `PlatformWatcher`, export it in `watchers`, and give the `Scraper` `mode: 'watch'`.

> Both depend on the sites' current markup and Terms of Service. Expect to maintain selectors, and use them responsibly. Upwork's terms are the stricter of the two, which is why it is watched rather than scraped — please do not add a `scrape()` back to it.
