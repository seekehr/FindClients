# FindClients

Self-hosted lead discovery for freelancers. It watches Upwork and X/Twitter for people who are hiring, optionally screens each find with Google Gemini, and puts what survives in a dashboard.

It runs **entirely on your own machine**. There is no account, no server to deploy and no database to install — one command starts it, and everything it knows lives in a folder you can delete.

## Why local

Scraping these platforms from a central server means one IP making requests on behalf of many accounts, which is the pattern that gets IPs blocked and accounts flagged. It also means asking people to hand over live session cookies — full account access — to somebody else's machine.

Running locally solves both. Your traffic comes from your own IP with your own logged-in session, which is what ordinary browsing looks like, and your cookies never leave your computer.

It does **not** make you invisible. See [Not getting your account flagged](#not-getting-your-account-flagged).

## Setup

Requires Node 22.5+.

```bash
npm run setup
```

That installs each workspace's dependencies, downloads the Chromium the scrapers drive, and creates `.env` from `.env.example`. Then:

```bash
npm start
```

Open **http://localhost:4000**. The first start builds the website (about a minute); every one after that is instant.

## Signing in

Start Chrome with debugging on, in its own persistent profile:

```bash
npm run chrome
```

Sign in to Upwork and X in that window, then **leave it open**. That is the whole setup. Every scrape attaches to this browser over CDP and reuses the session, so you sign in once and never again — the profile lives in `data/chrome-profile/` and survives restarts.

Then set your keywords in the app under **Config**.

Why attach rather than launch our own browser? Because this *is* your browser. No automation flags, your own profile and history, real Chrome rather than Playwright's bundled Chromium. Upwork sits behind Cloudflare, which answers a launched browser with `403 Just a moment...` and this one with `200`.

**If FindClients ever needs you** — a CAPTCHA, a login prompt, a "verify it's you" — it pauses and waits for you to click through it in that same Chrome window. Nothing is automated around a challenge; you just solve it like a person, and the scrape carries on.

### Without the CDP setup

Leave `CHROME_CDP_URL` empty and FindClients launches its own persistent profile per platform in `data/browser/<platform>/`, using installed Chrome where it can. **Connections → Sign in** opens a window for you. This works fine for X; expect Cloudflare to block Upwork.

Either way, **Check** on the Connections page re-tests a saved session against the live site.

## Layout

| Folder | What it is |
| --- | --- |
| [`website/`](website) | Next.js 16 frontend (React 19, Tailwind 4) |
| [`server/`](server) | Express API + scheduler; also serves the built website |
| [`scrapper/`](scrapper) | Playwright scrapers ([details](scrapper/README.md)) |
| [`scripts/`](scripts) | `setup` / `start` / `dev` |
| `data/` | Your leads, config and browser profiles. Gitignored. Created on first run. |

The three workspaces are independent — no root `node_modules`, no npm workspaces — so the website's build tooling never ends up in the server's runtime. All three read the root `.env`.

## Commands

| Command | What it does |
| --- | --- |
| `npm run setup` | Install everything, once |
| `npm run chrome` | Start the Chrome that scrapes run in — sign in here, leave it open |
| `npm start` | Build if needed, then run the whole app on one port |
| `npm run dev` | API on :4000 and website on :3000, both reloading on save |
| `npm run build` | Rebuild the website after changing it |
| `npm run typecheck` | Typecheck the server and scrapers |

From `scrapper/`, `npm run cli` runs the scrapers with no app at all, and `npm run cli -- --sign-in upwork` signs in from the terminal.

## Your data

Everything is JSON files in `data/`:

| File | What is in it |
| --- | --- |
| `config.json` | Your settings, and your Gemini API key |
| `leads.json` | Every lead, with its status, bookmark and AI verdict |
| `dismissed.json` | Source hashes of leads you cleared, so they stay cleared |
| `connections.json` | Which platforms are signed in, and how the last run went |
| `chrome-profile/` | The Chrome profile `npm run chrome` uses — your live sessions |
| `browser/` | Per-platform profiles, used only when not attaching over CDP |
| `runs.json` | Scrape history (last 200) |
| `notifications.json` | In-app feed (last 200) |

Backing up FindClients means copying that folder. Starting over means deleting it.

**Treat `data/` as sensitive.** `data/browser/` holds live logged-in sessions and `config.json` holds your Gemini key in plain text. That is the same posture as your everyday browser profile and `~/.aws` — and deliberate: encrypting them with a key stored in the `.env` file beside them would protect against nothing while adding a way to permanently lose access to your own data. Anything that can read the folder could already read your real browser's cookie jar.

Copying `data/` to another machine carries your logged-in sessions with it.

## Security model

There is no login, because there is no one to log in as. What replaces it is the bind address: the server listens on `127.0.0.1`, so only this machine can reach it.

If you change `HOST` to `0.0.0.0`, you are handing everyone on your network your leads, your saved sessions and a button that starts a scrape. Put something in front of it first.

## Not getting your account flagged

Going local removes the shared-IP problem. It does not remove the *behavioural* one — a real account that hits the same feed every two minutes forever, at exactly the same offset, is still obviously automated. The defaults are set accordingly:

- `SCRAPE_CRON` is every **30 minutes**, not every 2.
- `SCRAPE_JITTER_MS` adds up to 2 minutes of random delay so runs don't land on a clean clock tick.
- `SCRAPE_ON_START` is **off**, so restarting the app doesn't hit the platforms again.

Turning these up is the fastest way to get the account you are scraping with restricted. The jobs are not going anywhere.

## How it works

**Scraping** — every 30 minutes (jittered), the scheduler runs each enabled scraper you have connected an account for. Scrapers run one after another, not in parallel: each drives its own Chromium, and two at once on a laptop you are working on is the difference between a background task and a stall. Leads are de-duplicated by `sha1(platform + url||title)`, so re-seeing a post is a no-op. Full detail: [how_scrapping_works.md](how_scrapping_works.md).

**AI qualification** — opt-in, on your own Google Gemini key ([get one](https://aistudio.google.com/apikey)), entered on the Config page. Keyword scrapers are indiscriminate: searching "looking for a developer" finds the client who wants to hire *and* the developer announcing availability. The qualifier reads each lead against criteria you write in plain English and returns a 0–100 score plus a one-line reason. Gemini only (`gemini-2.5-pro | gemini-2.5-flash | gemini-2.5-flash-lite`, default flash), called over plain REST, 4 leads at a time. Failures record `error`, never `rejected` — a timeout is not evidence that a lead is bad. Already-reviewed leads are skipped, so turning qualification on later reviews the backlog.

**Bot challenges** — solved by you, by hand. There is no evasion here and no solver. When a CAPTCHA or bot wall appears, the scrape pauses and waits: in the attached Chrome the window is already in front of you, and otherwise the run reopens in a visible one. Click through it and the scrape continues. Nobody there within 5 minutes and it gives up, costing that cycle; the next starts clean. `CAPTCHA_OPEN_WINDOW=false` skips them instead of waiting.

**Notifications** — new leads matching your keyword/platform/budget filters appear in the in-app feed, and are posted to a Discord webhook if you set one.

## API

Everything lives under `/api`, unauthenticated, on localhost.

| Group | Routes |
| --- | --- |
| Health | `GET /health` |
| Leads | `GET /leads` (platform, q, status, bookmarked, ai, page, limit) · `GET/PATCH /leads/:id` · `PUT/DELETE /leads/:id/bookmark` · `DELETE /leads` (clear all, keeps bookmarks) |
| Bookmarks | `GET /bookmarks` |
| Config | `GET/PUT /config` · `POST /config/reset` |
| Credentials | `GET /credentials` · `PUT/DELETE /credentials/:platform` |
| Scrape | `POST /scrape/run` · `GET /scrape/{status,runs}` |
| Analytics | `GET /analytics/{overview,platforms,trend,scrape-runs}` |
| Notifications | `GET /notifications` · `POST /notifications/read-all` · `POST /notifications/:id/read` |

## Not implemented

Discord / Reddit / LinkedIn scrapers (the platforms are listed in the UI and marked "no scraper yet").

## Disclaimer

Automating access to Upwork and X may violate their Terms of Service and can get the account you connect restricted or banned. Use accounts you own, at your own risk.

## License

MIT.
