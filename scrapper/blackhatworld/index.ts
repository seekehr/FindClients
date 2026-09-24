import type { Page } from 'playwright';
import type { RawLead, Scraper, ScrapeContext } from '../../server/src/scrapers/types';
import { deleteProfile, openProfile, type BrowserSession } from '../lib/profile';
import { loadBhwConfig, loadBhwRuntimeConfig, type BhwConfig } from './config';

const PLATFORM = 'blackhatworld' as const;
const ORIGIN = 'https://www.blackhatworld.com';
const HOME_URL = `${ORIGIN}/forums/`;

/**
 * BlackHatWorld scraper — new threads in the sub forums you list.
 *
 * No account: the forums are public, so there is no sign-in, nothing on the
 * Connections page, and `requiresSignIn: false` lets the cycle run it anyway.
 * Each run opens every listed sub forum sorted by start date, reads the one
 * page it lands on, and returns the threads on it. De-duplication is the
 * server's, by URL, exactly as for X — so a thread becomes a lead (and an
 * alert) the first cycle it shows up in, and never again.
 *
 * The obstacle is Cloudflare, not the forum. The first visit from a browser it
 * does not know gets a "Just a moment..." Turnstile page. How that is handled:
 *
 *  - Wait a little first. Cloudflare often clears a real browser by itself.
 *  - Still there, and a person may be around (`ctx.interactive`)? Show the
 *    window and wait for them to click through it. Attached to your own Chrome
 *    that is a tab brought to the front; with a headless launched browser the
 *    run reopens visibly first, because a headless one cannot be clicked.
 *  - Once cleared, the `cf_clearance` cookie lives in the profile, so the
 *    following cycles go straight through until Cloudflare expires it.
 *
 * It never tries to solve the check itself.
 */

export interface ForumThread {
  threadId: string;
  title: string;
  /** Canonical thread URL — also what the server de-duplicates on. */
  url: string;
  author: string;
  /** Thread prefix label, e.g. "WTB". '' when there is none. */
  prefix: string;
  /** Sub forum name as the page titles it. */
  forum: string;
  /** When the thread was started (ISO). '' when the page did not say. */
  postedAt: string;
  replies: string;
  views: string;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const humanDelay = (low: number, high: number) => sleep((low + Math.random() * (high - low)) * 1000);

/**
 * The sub forum sorted newest thread first. XenForo lists by *last reply* by
 * default, which would bury a new thread under every old one someone bumped.
 * A link that already chooses an order is left as you wrote it.
 */
export function listingUrl(forumUrl: string): string {
  const url = new URL(forumUrl);
  if (!url.searchParams.has('order')) {
    url.searchParams.set('order', 'post_date');
    url.searchParams.set('direction', 'desc');
  }
  return url.toString();
}

/**
 * `/seo/some-title.1783001/` from any link into a thread — its unread, page-2
 * or post anchors included — so the same thread always hashes the same.
 */
export function canonicalThreadUrl(href: string): { url: string; threadId: string } | null {
  try {
    const url = new URL(href, ORIGIN);
    const match = /^(\/[^/]+\/[^/]*?\.(\d+))(?:\/|$)/.exec(url.pathname);
    if (!match) return null;
    return { url: `${ORIGIN}${match[1]}/`, threadId: match[2] };
  } catch {
    return null;
  }
}

/* ── Cloudflare ─────────────────────────────────────────────────────────── */

/** Only a real forum page has these. */
const SITE_MARKERS = '.p-pageWrapper, .structItemContainer';

/** Cloudflare's interstitial, in its several wordings. */
const CHALLENGE_TITLES = [
  'just a moment',
  'security verification',
  'checking your browser',
  'attention required',
  'access denied',
];

/**
 * Turnstile's own markup. Not `/cdn-cgi/challenge-platform/` on its own:
 * Cloudflare injects a script from there into ordinary pages too, and matching
 * it would call every forum page a challenge.
 */
const CHALLENGE_SELECTOR = [
  '#challenge-form',
  '#challenge-stage',
  '[id^="cf-chl-widget"]',
  'input[name="cf-turnstile-response"]',
  'script[src*="chl_page"]',
  'iframe[src*="challenges.cloudflare.com"]',
].join(', ');

type PageState = 'site' | 'challenge' | 'other';

/**
 * What is on screen. 'other' covers the moments in between — mid-navigation,
 * or a page that has not drawn yet — so nobody mistakes a page that is still
 * loading for one that cleared.
 */
export async function pageState(page: Page): Promise<PageState> {
  try {
    if ((await page.locator(SITE_MARKERS).count()) > 0) return 'site';
    const title = (await page.title()).toLowerCase();
    if (CHALLENGE_TITLES.some((t) => title.includes(t))) return 'challenge';
    if ((await page.locator(CHALLENGE_SELECTOR).count()) > 0) return 'challenge';
    return 'other';
  } catch {
    return 'other';
  }
}

/** Poll until the forum itself is showing, or give up and say what is. */
async function waitForSite(page: Page, timeoutMs: number): Promise<PageState> {
  const deadline = Date.now() + timeoutMs;
  let state = await pageState(page);
  while (state !== 'site' && Date.now() < deadline) {
    await sleep(1500);
    state = await pageState(page);
  }
  return state;
}

/** Long enough for Cloudflare to wave a real browser through unprompted. */
const AUTO_PASS_MS = 20_000;

/* ── Reading a sub forum ────────────────────────────────────────────────── */

export interface RawRow {
  href: string;
  title: string;
  author: string;
  prefix: string;
  timestamp: number;
  datetime: string;
  sticky: boolean;
  replies: string;
  views: string;
}

/** Every thread row on the page, as plain data. Runs in the page. */
export async function readRows(page: Page): Promise<{ forum: string; rows: RawRow[] }> {
  const forum = await page
    .locator('h1.p-title-value')
    .first()
    .innerText({ timeout: 2_000 })
    .catch(() => '');

  // `any` rather than DOM types: this workspace compiles without the DOM lib,
  // and the callback only ever runs inside the browser.
  const rows = await page.$$eval('.structItem--thread', (els: any[]) =>
    els.map((row: any) => {
      const titleLinks = Array.from(row.querySelectorAll('.structItem-title a')) as any[];
      const link = row.querySelector('.structItem-title a[data-tp-primary]') ?? titleLinks.pop();
      const time = row.querySelector('.structItem-startDate time') ?? row.querySelector('time');
      const stats = row.querySelectorAll('.structItem-cell--meta dd');
      return {
        href: link?.getAttribute('href') ?? '',
        title: (link?.textContent ?? '').trim(),
        author: row.getAttribute('data-author') ?? '',
        prefix: (row.querySelector('.structItem-title .label')?.textContent ?? '').trim(),
        timestamp: Number(time?.getAttribute('data-timestamp') ?? 0),
        datetime: time?.getAttribute('datetime') ?? '',
        sticky:
          Boolean(row.querySelector('.structItem-status--sticky')) ||
          Boolean(row.closest('.structItemContainer-group--sticky, .stickyThreadContainer')),
        replies: (stats[0]?.textContent ?? '').trim(),
        views: (stats[1]?.textContent ?? '').trim(),
      };
    }),
  );

  return { forum: forum.trim(), rows };
}

export function toThread(row: RawRow, forum: string): ForumThread | null {
  const canonical = canonicalThreadUrl(row.href);
  if (!canonical || !row.title) return null;

  let postedAt = '';
  if (row.timestamp > 0) postedAt = new Date(row.timestamp * 1000).toISOString();
  else if (row.datetime && !Number.isNaN(Date.parse(row.datetime))) {
    postedAt = new Date(row.datetime).toISOString();
  }

  return {
    threadId: canonical.threadId,
    title: row.title.replace(/\s+/g, ' '),
    url: canonical.url,
    author: row.author,
    prefix: row.prefix,
    forum,
    postedAt,
    replies: row.replies,
    views: row.views,
  };
}

/** Thrown when Cloudflare would not let a run through. */
class ChallengeError extends Error {}

class BhwScraper {
  private session: BrowserSession | null = null;
  private page: Page | null = null;
  /** Launched headless and hit a challenge: reopen visibly for a person. */
  private headless: boolean;

  constructor(
    private readonly config: BhwConfig,
    private readonly ctx: ScrapeContext,
  ) {
    this.headless = config.headless;
  }

  private log(msg: string) {
    this.ctx.log(msg);
  }

  private async open(): Promise<Page> {
    if (this.page && !this.page.isClosed()) return this.page;
    this.session = await openProfile(PLATFORM, {
      headless: this.headless,
      userAgent: this.config.userAgent,
    });
    this.log(
      this.session.attached
        ? 'attached to your Chrome'
        : `browser started (headless=${this.headless})`,
    );
    // One tab for every forum: a person reading several sub forums does it
    // in one tab, and in your own Chrome that is one tab to notice, not five.
    this.page = await this.session.page();
    return this.page;
  }

  async stop(): Promise<void> {
    if (this.session) await this.session.release();
    this.session = null;
    this.page = null;
  }

  /**
   * Get past Cloudflare on the page in front of us, or throw ChallengeError.
   * Returns once the forum itself is showing.
   */
  private async clearChallenge(page: Page, target: string): Promise<Page> {
    if (!this.ctx.interactive) {
      throw new ChallengeError(
        'Cloudflare is showing a check and CAPTCHA_OPEN_WINDOW=false, so nobody is set to clear it.',
      );
    }

    // A headless window cannot be clicked. Reopen the same profile visibly —
    // whatever it earns there is kept in the profile for later runs.
    if (this.headless && !this.session?.attached) {
      this.log('Cloudflare check — reopening in a visible window so you can clear it');
      await this.stop();
      this.headless = false;
      page = await this.open();
      await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 45_000 });
      if ((await waitForSite(page, AUTO_PASS_MS)) === 'site') return page;
    }

    await page.bringToFront().catch(() => undefined);
    const minutes = Math.round(this.ctx.captchaTimeoutMs / 60_000);
    this.log(
      `Cloudflare check on BlackHatWorld — clear it in the browser window (waiting up to ${minutes} minute(s))`,
    );
    if ((await waitForSite(page, this.ctx.captchaTimeoutMs)) !== 'site') {
      throw new ChallengeError('The Cloudflare check was not cleared in time.');
    }
    this.log('Cloudflare check cleared — the next runs should go straight through');
    return page;
  }

  /** Open one sub forum and read the threads on its first page. */
  async readForum(forumUrl: string, limit: number, cutoff: Date | null): Promise<ForumThread[]> {
    const target = listingUrl(forumUrl);
    let page = await this.open();

    await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    const state = await waitForSite(page, AUTO_PASS_MS);
    if (state === 'challenge') page = await this.clearChallenge(page, target);
    else if (state !== 'site') {
      this.log(`${forumUrl} did not load — skipping it this run`);
      return [];
    }

    // Clearing the check lands on the page it interrupted; make sure that is
    // still the listing we asked for before reading it.
    if (!page.url().includes('/forums/')) {
      await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 45_000 });
      if ((await waitForSite(page, AUTO_PASS_MS)) !== 'site') {
        this.log(`${forumUrl} did not load after the check — skipping it this run`);
        return [];
      }
    }

    await page.waitForSelector('.structItem--thread', { timeout: 10_000 }).catch(() => undefined);
    const { forum, rows } = await readRows(page);
    if (!rows.length) {
      this.log(`no threads on ${forumUrl} — is that a sub forum link?`);
      return [];
    }

    const threads: ForumThread[] = [];
    for (const row of rows) {
      if (threads.length >= limit) break;
      // Pinned rules and announcements sit on top of every listing forever.
      if (row.sticky) continue;
      const thread = toThread(row, forum || forumUrl);
      if (!thread) continue;
      if (cutoff && thread.postedAt && new Date(thread.postedAt) < cutoff) continue;
      threads.push(thread);
    }

    this.log(`${forum || forumUrl}: ${threads.length} recent thread(s)`);
    return threads;
  }

  async readAll(forumUrls: string[], overallLimit: number, cutoff: Date | null): Promise<ForumThread[]> {
    const all: ForumThread[] = [];
    const seen = new Set<string>();

    for (const [i, forumUrl] of forumUrls.entries()) {
      if (all.length >= overallLimit) break;
      if (i > 0) await humanDelay(4, 9);

      const remaining = overallLimit - all.length;
      let threads: ForumThread[];
      try {
        threads = await this.readForum(forumUrl, Math.min(this.config.limitPerForum, remaining), cutoff);
      } catch (err) {
        // Nothing collected yet: fail the run, so the Connections/analytics
        // record says "Cloudflare", not "found 0". Otherwise keep what we have.
        if (!all.length) throw err;
        this.log(`stopping early — ${(err as Error).message}`);
        break;
      }

      for (const t of threads) {
        if (seen.has(t.threadId)) continue;
        seen.add(t.threadId);
        all.push(t);
      }
    }

    return all;
  }
}

/** Map a thread into the server's platform-agnostic RawLead shape. */
export function threadToLead(thread: ForumThread): RawLead {
  const where = thread.forum ? `New thread in ${thread.forum}` : 'New thread';
  return {
    title: thread.title,
    platform: PLATFORM,
    description: `${thread.title}\n\n${where}${thread.author ? ` by ${thread.author}` : ''}.`,
    url: thread.url,
    author: thread.author || null,
    tags: [thread.forum, thread.prefix].filter(Boolean),
    metadata: {
      forum: thread.forum,
      prefix: thread.prefix || null,
      replies: thread.replies || null,
      views: thread.views || null,
    },
    postedAt: thread.postedAt || undefined,
  };
}

export const blackhatworldScraper: Scraper = {
  platform: PLATFORM,
  name: 'BlackHatWorld',

  /** Collected by the scheduled cycle, like X. */
  mode: 'scrape',

  /** Public forums — nothing to sign in to. */
  requiresSignIn: false,

  async checkSession() {
    return { hasProfile: true, signedIn: true, detail: 'No account needed.' };
  },

  /**
   * There is no account, so "signing in" here means clearing Cloudflare once
   * in a visible window and keeping the cookie — handy before the first
   * scheduled run: `npm run cli -- --sign-in blackhatworld`.
   */
  async signIn({ timeoutMs, log }) {
    const runtime = loadBhwRuntimeConfig();
    const session = await openProfile(PLATFORM, { headless: false, userAgent: runtime.userAgent });
    try {
      const page = await session.page();
      await page.goto(HOME_URL, { waitUntil: 'domcontentloaded', timeout: 45_000 });
      log('clear the Cloudflare check in the window, if one appears');
      const ok = (await waitForSite(page, timeoutMs)) === 'site';
      log(ok ? 'BlackHatWorld is reachable — the clearance is saved' : 'the forum never loaded');
      if (ok) await sleep(2000); // let the cookie reach the profile on disk
      return ok;
    } finally {
      await session.release();
    }
  },

  /** Forget the saved Cloudflare clearance. */
  async signOut() {
    deleteProfile(PLATFORM);
  },

  async scrape(ctx: ScrapeContext): Promise<RawLead[]> {
    const config = loadBhwConfig({
      forumUrls: ctx.config.bhwForumUrls ?? [],
      limitPerForum: ctx.config.bhwLimitPerForum ?? 20,
      maxPostAgeHours: ctx.config.maxPostAgeHours,
    });

    if (!config.forumUrls.length) {
      ctx.log('no sub forums set — add some on the Config page');
      return [];
    }

    const cutoffs = [
      config.maxPostAgeHours > 0
        ? new Date(Date.now() - config.maxPostAgeHours * 60 * 60 * 1000)
        : null,
      ctx.since ?? null,
    ].filter((d): d is Date => d !== null);
    const cutoff = cutoffs.length ? new Date(Math.max(...cutoffs.map((d) => d.getTime()))) : null;

    const scraper = new BhwScraper(config, ctx);
    try {
      const threads = await scraper.readAll(config.forumUrls, ctx.limit, cutoff);
      return threads.map(threadToLead);
    } finally {
      await scraper.stop();
    }
  },
};

export default blackhatworldScraper;
