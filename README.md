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

Then, in the app: **Connections** → *Sign in*, **Config** → set your keywords.

## Signing in

Click **Sign in** and a real browser window opens on your machine. Log in the way you normally would — password, 2FA, "trust this device", all of it. Close the window when you land on the site and you are done.

That session lives in a persistent Chromium profile under `data/browser/<platform>/`, exactly the way your everyday browser keeps one. Every later scrape reuses it, and because a real browser refreshes its own session as it goes, **you do not have to sign in again** — no cookies to copy, nothing to re-paste when a token expires.

If a session does eventually lapse, the Connections page shows *Session expired* and one click signs you back in. **Check** re-tests a saved session against the live site.

This is also the more honest fingerprint. A pasted `auth_token` replayed from a blank browser context is a session with no history, no localStorage and no prior device — visibly not the browser that logged in. A persistent profile *is* that browser.

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
| `browser/` | Chromium profiles — where the signed-in sessions actually live |
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

**Bot challenges** — scrapers run headless, which cannot solve a CAPTCHA. When one appears, the scraper reopens the run in a **visible browser window** so you can click through it yourself; solve it and the run continues. If nobody does within 5 minutes it gives up and the next cycle starts clean. That means a scheduled run while you are away will lose a cycle to a challenge — the deliberate trade for not maintaining a screenshot-relay solver. `CAPTCHA_OPEN_WINDOW=false` skips them instead. See [`scrapper/README.md`](scrapper/README.md).

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
