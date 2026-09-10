import type { BrowserContext, Page } from 'playwright';
import type {
  LeadMetadata,
  PlatformWatcher,
  WatchResult,
  WatchTab,
  WatchTabOptions,
} from '../../server/src/scrapers/types';
import { openProfile, type BrowserSession } from '../lib/profile';
import { loadUpworkRuntimeConfig } from './config';
import {
  jobToLead,
  looksLikeChallenge,
  looksSignedOut,
  readFeed,
  readJobDetail,
  settle,
  sleep,
  waitForCaptchaSolved,
  waitForFeed,
} from './index';

/**
 * The Upwork tab you leave open.
 *
 * This is the whole of FindClients' contact with Upwork, and it is deliberately
 * small enough to describe in a sentence: sit on the jobs feed, reload that one
 * page every few minutes, read what is on the screen.
 *
 * What it will not do matters more than what it does:
 *
 *  - It never clicks "Load More". One screen of jobs is what a person sees when
 *    they glance at the feed, and paging through the backlog is the single most
 *    recognisable scraping behaviour there is.
 *  - It never opens a second tab when one will do, and never opens a job it was
 *    not already shown — the only click-through is `inspect`, once, for a job
 *    you are about to be alerted about.
 *
 * The pacing — when to reload, how long to hold a job before telling you — is
 * not decided here. That lives in ../../server/src/watcher/, because it is a
 * property of the whole system rather than of one page.
 */

/** How long to let the feed settle after a reload before reading it. */
const AFTER_RELOAD_MS = 2_000;

export const isUpworkUrl = (url: string): boolean => {
  try {
    return /(^|\.)upwork\.com$/i.test(new URL(url).hostname);
  } catch {
    return false;
  }
};

const path = (url: string): string => {
  try {
    return new URL(url).pathname.replace(/\/+$/, '').toLowerCase();
  } catch {
    return '';
  }
};

/**
 * Is this tab showing the feed we were asked to watch?
 *
 * Compared by path, not by whole URL. Upwork rewrites its own query string as
 * you use the page — sort order, pagination cursors, a `?ref=` it adds on
 * redirect — so an exact match would send us navigating on every single poll
 * instead of reloading the page we already have.
 */
export function onFeedPage(current: string, feedUrl: string): boolean {
  return isUpworkUrl(current) && path(current) === path(feedUrl);
}

/**
 * Pick the Upwork tab to work in, out of everything open in the browser.
 *
 * Attached to your own Chrome, `context.pages()` is every tab you have open.
 * Preferring the one already on the feed is not just tidiness: an arbitrary
 * Upwork tab might be a proposal you are halfway through writing, and this
 * class is about to reload whatever it picks. Feed first, other find-work pages
 * second, anything else on Upwork last.
 */
export function findUpworkPage(context: BrowserContext, feedUrl: string): Page | null {
  const open = context.pages().filter((p) => !p.isClosed() && isUpworkUrl(p.url()));
  if (!open.length) return null;

  return (
    open.find((p) => onFeedPage(p.url(), feedUrl)) ??
    open.find((p) => path(p.url()).startsWith('/nx/find-work')) ??
    open[0]
  );
}

class UpworkWatchTab implements WatchTab {
  private closed = false;

  /** The tab we are working in, once we have settled on one. */
  private page: Page | null = null;

  /** Tabs this class opened, and may therefore close again. */
  private readonly created = new Set<Page>();

  constructor(
    private readonly session: BrowserSession,
    private readonly opts: WatchTabOptions,
  ) {}

  isOpen(): boolean {
    if (this.closed) return false;
    // A CDP connection that dropped, or a launched browser that exited. There
    // is no browser object behind a persistent context, hence the optional.
    const browser = this.session.context.browser();
    return browser ? browser.isConnected() : true;
  }

  /**
   * The Upwork tab, resolved fresh every time.
   *
   * Re-resolved rather than remembered because the browser is *yours*: the tab
   * we used last time may have been closed, or you may have opened your own
   * Upwork tab since, and either way the right answer is the tab that exists
   * now. Only when there is no Upwork tab at all do we open one.
   */
  private async resolveTab(): Promise<Page> {
    const { context } = this.session;
    const { feedUrl, log } = this.opts;

    if (this.page && !this.page.isClosed() && isUpworkUrl(this.page.url())) return this.page;

    const existing = findUpworkPage(context, feedUrl);
    if (existing) {
      if (existing !== this.page) log('using the Upwork tab already open in this browser');
      this.page = existing;
      return existing;
    }

    log('no Upwork tab open — opening one');
    const page = await context.newPage();
    this.created.add(page);
    this.page = page;
    return page;
  }

  /**
   * Put the tab on the feed and return whether we had to navigate to do it.
   *
   * The navigate-or-reload split is the fix for a tab that has wandered.
   * Upwork will happily bounce `/nx/find-work/most-recent` to
   * `/nx/project-dashboard/?ref=fwh`, and reloading *that* forever is a watcher
   * that never sees a job again while reporting only "feed not visible yet".
   */
  private async goToFeed(page: Page): Promise<number | undefined> {
    const { feedUrl, log } = this.opts;
    const current = page.url();

    if (onFeedPage(current, feedUrl)) {
      // Genuinely a reload of the page in front of us — same tab, same URL,
      // same history. That is what this is meant to look like.
      const response = await page.reload({ waitUntil: 'domcontentloaded', timeout: 45_000 });
      return response?.status();
    }

    if (isUpworkUrl(current) && current !== 'about:blank') {
      log(`that tab is on ${path(current) || current} — sending it to your feed`);
    }
    const response = await page.goto(feedUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 45_000,
    });
    return response?.status();
  }

  /** Reload the feed and read it. */
  async poll(): Promise<WatchResult> {
    if (!this.isOpen()) return { leads: [], problem: 'closed' };

    let page: Page;
    let status: number | undefined;
    try {
      page = await this.resolveTab();
      status = await this.goToFeed(page);
    } catch (err) {
      if (!this.isOpen()) return { leads: [], problem: 'closed' };
      return { leads: [], problem: 'no-feed', detail: (err as Error).message };
    }

    // Upwork redirects a lot; the document that fired domcontentloaded is
    // frequently not the page we ended up on.
    await settle(page);

    // Signed out is checked first, and is not a challenge. Nobody can "solve" a
    // login page, and waitForFeed would spend a minute and a half nudging one.
    if (looksSignedOut(page)) return { leads: [], problem: 'signed-out' };

    if (await looksLikeChallenge(page, status)) {
      if (!this.opts.interactive) {
        this.opts.log('Upwork is showing a bot check and nobody is set to clear it');
        return { leads: [], problem: 'challenge' };
      }
      // Attached to the user's own Chrome the tab is already on screen, so this
      // is simply waiting for them to click through it.
      const solved = await waitForCaptchaSolved(page, this.opts.log, this.opts.captchaTimeoutMs);
      if (!solved) return { leads: [], problem: 'challenge' };
      if (looksSignedOut(page)) return { leads: [], problem: 'signed-out' };
    }

    // Landed somewhere else entirely. Say so, with the URL — three rounds of
    // "feed not visible yet — nudging" is a true statement that explains
    // nothing, and this is the one message that would have.
    if (!onFeedPage(page.url(), this.opts.feedUrl)) {
      return {
        leads: [],
        problem: 'no-feed',
        detail:
          `Upwork sent that tab to ${path(page.url()) || page.url()} instead of your feed. ` +
          'Open the feed you want to watch in that tab, or set its URL on the Config page.',
      };
    }

    if (!(await waitForFeed(page, this.opts.log))) {
      return {
        leads: [],
        problem: 'no-feed',
        detail: `The jobs feed did not render at ${path(page.url()) || page.url()}.`,
      };
    }
    await sleep(AFTER_RELOAD_MS);

    const jobs = await readFeed(page);
    return { leads: jobs.map(jobToLead) };
  }

  /**
   * Click through to one job, read the client details the tile cannot show,
   * and come back to the feed.
   *
   * Called at most once per job you are alerted about, minutes after it was
   * spotted. Deliberately in the same tab and followed by a return to the feed,
   * because that is a click and a Back button, not a second crawler.
   */
  async inspect(url: string): Promise<LeadMetadata | null> {
    if (!this.isOpen() || !this.opts.fetchDetails) return null;

    const runtime = loadUpworkRuntimeConfig();
    let page: Page;
    try {
      page = await this.resolveTab();
    } catch {
      return null;
    }

    try {
      const detail = await readJobDetail(page, url, runtime, this.opts.log);
      const meta: LeadMetadata = {};
      if (detail.clientRating) meta.clientRating = detail.clientRating;
      if (detail.clientHireRate) meta.clientHireRate = detail.clientHireRate;
      // Fresher than the tile's, which was read minutes ago when it was spotted.
      if (detail.proposals) meta.proposals = detail.proposals;
      return Object.keys(meta).length ? meta : null;
    } catch (err) {
      this.opts.log(`could not read that job's page: ${(err as Error).message}`);
      return null;
    } finally {
      // Back to the feed, so the next poll is a reload rather than a navigation.
      await page
        .goto(this.opts.feedUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 })
        .catch(() => undefined);
    }
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;

    // Only tabs we opened. Adopting a tab you already had open must never mean
    // closing it when the watcher pauses.
    for (const page of this.created) {
      if (!page.isClosed()) await page.close().catch(() => undefined);
    }
    this.created.clear();
    this.page = null;

    // Drops the CDP connection. When the browser is one you started, your
    // Chrome stays exactly where it was.
    await this.session.release().catch(() => undefined);
  }
}

export const upworkWatcher: PlatformWatcher = {
  platform: 'upwork',
  name: 'Upwork job alerts',

  async open(opts: WatchTabOptions): Promise<WatchTab> {
    const runtime = loadUpworkRuntimeConfig();

    // Never headless. A watcher lives in the browser you already have open —
    // that is the point of it, and it is also what keeps Cloudflare quiet.
    const session = await openProfile('upwork', {
      headless: false,
      userAgent: runtime.userAgent,
    });

    const tab = new UpworkWatchTab(session, opts);
    opts.log(`watching ${opts.feedUrl}`);
    return tab;
  },
};

export default upworkWatcher;
