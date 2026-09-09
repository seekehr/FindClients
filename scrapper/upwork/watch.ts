import type { Page } from 'playwright';
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
 * small enough to describe in a sentence: open the feed once, reload that page
 * every few minutes, read what is on the screen.
 *
 * What it will not do matters more than what it does:
 *
 *  - It never clicks "Load More". One screen of jobs is what a person sees when
 *    they glance at the feed, and paging through the backlog is the single most
 *    recognisable scraping behaviour there is.
 *  - It never navigates anywhere it was not sent. `poll()` reloads the URL it
 *    already has; the only other page it will ever open is a job you are about
 *    to be alerted about, once, in the same tab.
 *  - It never opens a second tab, so it cannot fan out.
 *
 * The pacing — when to reload, how long to hold a job before telling you — is
 * not decided here. That lives in ../../server/src/watcher/, because it is a
 * property of the whole system rather than of one page.
 */

/** How long to let the feed settle after a reload before reading it. */
const AFTER_RELOAD_MS = 2_000;

class UpworkWatchTab implements WatchTab {
  private closed = false;

  constructor(
    private readonly session: BrowserSession,
    private readonly page: Page,
    private readonly opts: WatchTabOptions,
  ) {}

  isOpen(): boolean {
    return !this.closed && !this.page.isClosed();
  }

  /**
   * Reload the feed and read it.
   *
   * Uses `page.reload()` rather than a fresh `goto`, because that is genuinely
   * what it is: the same tab, the same URL, refreshed. It also keeps the
   * referrer and history looking like a tab someone has had open for an hour,
   * which is exactly what this is.
   */
  async poll(): Promise<WatchResult> {
    if (!this.isOpen()) return { leads: [], problem: 'closed' };

    let status: number | undefined;
    try {
      const response = await this.page.reload({
        waitUntil: 'domcontentloaded',
        timeout: 45_000,
      });
      status = response?.status();
    } catch (err) {
      if (!this.isOpen()) return { leads: [], problem: 'closed' };
      return { leads: [], problem: 'no-feed', detail: (err as Error).message };
    }

    // Upwork redirects a lot; the document that fired domcontentloaded is
    // frequently not the page we ended up on.
    await settle(this.page);

    // Signed out is checked first, and is not a challenge. Nobody can "solve" a
    // login page, and waitForFeed would spend a minute and a half nudging one.
    if (looksSignedOut(this.page)) return { leads: [], problem: 'signed-out' };

    if (await looksLikeChallenge(this.page, status)) {
      if (!this.opts.interactive) {
        this.opts.log('Upwork is showing a bot check and nobody is set to clear it');
        return { leads: [], problem: 'challenge' };
      }
      // Attached to the user's own Chrome the tab is already on screen, so this
      // is simply waiting for them to click through it.
      const solved = await waitForCaptchaSolved(
        this.page,
        this.opts.log,
        this.opts.captchaTimeoutMs,
      );
      if (!solved) return { leads: [], problem: 'challenge' };
      if (looksSignedOut(this.page)) return { leads: [], problem: 'signed-out' };
    }

    if (!(await waitForFeed(this.page, this.opts.log))) {
      return { leads: [], problem: 'no-feed', detail: 'The jobs feed did not render.' };
    }
    await sleep(AFTER_RELOAD_MS);

    const jobs = await readFeed(this.page);
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
    try {
      const detail = await readJobDetail(this.page, url, runtime, this.opts.log);
      const meta: LeadMetadata = {};
      if (detail.clientRating) meta.clientRating = detail.clientRating;
      if (detail.clientHireRate) meta.clientHireRate = detail.clientHireRate;
      return Object.keys(meta).length ? meta : null;
    } catch (err) {
      this.opts.log(`could not read that job's page: ${(err as Error).message}`);
      return null;
    } finally {
      // Back to the feed, so the next reload has the right page under it.
      await this.page
        .goto(this.opts.feedUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 })
        .catch(() => undefined);
    }
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    // Closes our tab and drops the CDP connection. When the browser is one the
    // user started, their Chrome stays exactly where it was.
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

    let page: Page;
    try {
      page = await session.page();
      await page.goto(opts.feedUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 });
      await settle(page);
    } catch (err) {
      await session.release().catch(() => undefined);
      throw err;
    }

    opts.log(`tab open on ${opts.feedUrl}`);
    return new UpworkWatchTab(session, page, opts);
  },
};

export default upworkWatcher;
