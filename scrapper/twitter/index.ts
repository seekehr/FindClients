import {
  chromium,
  type Browser,
  type BrowserContext,
  type ElementHandle,
  type Page,
} from 'playwright';
import type { RawLead, Scraper, ScrapeContext, SessionCookie } from '../../server/src/scrapers/types';
import { loadTwitterConfig, type TwitterConfig } from './config';

/**
 * X/Twitter scraper — a TypeScript translation of a Playwright-based reference
 * scraper. It drives a real Chromium instance through X's live search, scrolls,
 * and extracts tweets that look like hiring intent, mapping each to a `RawLead`.
 *
 * Design notes vs. the reference:
 *  - Side-effect free: cross-run de-duplication and persistence are the server's
 *    job (it hashes by URL). We only de-dupe within a single run.
 *  - Honors the `ScrapeContext` the server passes in (overall `limit`, `since`,
 *    and `log`) on top of the scraper's own env-driven config.
 *
 * Requires: `playwright` + a browser (`npx playwright install chromium`) and an
 * `X_AUTH_TOKEN` cookie value. Without a token, X search renders nothing, so the
 * scraper short-circuits and returns [].
 */

export interface Tweet {
  tweetId: string;
  postText: string;
  authorUsername: string;
  authorDisplayName: string;
  postUrl: string;
  timestamp: string;
  likes: number;
  reposts: number;
  replies: number;
  views: number;
}

const emptyTweet = (): Tweet => ({
  tweetId: '',
  postText: '',
  authorUsername: '',
  authorDisplayName: '',
  postUrl: '',
  timestamp: '',
  likes: 0,
  reposts: 0,
  replies: 0,
  views: 0,
});

/** Parse engagement metrics like "1.2K", "3M", "450". */
export function parseMetric(text: string): number {
  if (!text) return 0;
  const cleaned = text.trim().replace(/,/g, '');
  const multipliers: Record<string, number> = { K: 1_000, M: 1_000_000, B: 1_000_000_000 };
  const suffix = cleaned.slice(-1).toUpperCase();
  if (suffix in multipliers) {
    const value = Number.parseFloat(cleaned.slice(0, -1));
    return Number.isFinite(value) ? Math.round(value * multipliers[suffix]) : 0;
  }
  const n = Number.parseInt(cleaned, 10);
  return Number.isFinite(n) ? n : 0;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const humanDelay = (low = 1.0, high = 3.0) => sleep((low + Math.random() * (high - low)) * 1000);

/**
 * Extract a single tweet from an <article data-testid="tweet"> element handle.
 * Standalone (not a method) so it can be exercised against fixture HTML in tests.
 */
export async function extractTweetFromArticle(article: ElementHandle): Promise<Tweet | null> {
  try {
    const tweet = emptyTweet();

    // Tweet permalink → author username + tweet id.
    const links = await article.$$('a[href*="/status/"]');
    for (const link of links) {
      const href = await link.getAttribute('href');
      if (href && href.includes('/status/')) {
        const match = href.match(/\/([^/]+)\/status\/(\d+)/);
        if (match) {
          tweet.authorUsername = match[1];
          tweet.tweetId = match[2];
          tweet.postUrl = `https://x.com${href}`;
          break;
        }
      }
    }
    if (!tweet.tweetId) return null;

    const displayEl = await article.$('div[data-testid="User-Name"] a span');
    if (displayEl) tweet.authorDisplayName = (await displayEl.innerText()).trim();

    const textEl = await article.$('div[data-testid="tweetText"]');
    if (textEl) tweet.postText = (await textEl.innerText()).trim();

    const timeEl = await article.$('time');
    if (timeEl) tweet.timestamp = (await timeEl.getAttribute('datetime')) ?? '';

    // Engagement metrics come from the action bar's aria-labels.
    const buttons = await article.$$('div[role="group"] button');
    const metrics: number[] = [];
    for (const btn of buttons) {
      const aria = (await btn.getAttribute('aria-label')) ?? '';
      const nums = aria.match(/[\d,.]+[KMB]?/i);
      metrics.push(nums ? parseMetric(nums[0]) : 0);
    }
    [tweet.replies, tweet.reposts, tweet.likes, tweet.views] = [
      metrics[0] ?? 0,
      metrics[1] ?? 0,
      metrics[2] ?? 0,
      metrics[3] ?? 0,
    ];

    return tweet;
  } catch {
    return null;
  }
}

class TwitterScraper {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private proxyIndex = 0;

  constructor(
    private readonly config: TwitterConfig,
    private readonly cookies: SessionCookie[],
    private readonly log: (msg: string) => void,
  ) {}

  private nextProxy(): { server: string } | undefined {
    if (!this.config.proxyList.length) return undefined;
    const url = this.config.proxyList[this.proxyIndex % this.config.proxyList.length];
    this.proxyIndex += 1;
    return { server: url };
  }

  async start(): Promise<void> {
    this.browser = await chromium.launch({
      headless: this.config.headless,
      proxy: this.nextProxy(),
    });
    this.context = await this.browser.newContext({
      viewport: { width: 1280, height: 900 },
      userAgent: this.config.userAgent,
    });
    if (this.cookies.length) {
      // Inject the user's pasted session cookies so X sees a logged-in session.
      await this.context.addCookies(
        this.cookies.map((c) => ({
          name: c.name,
          value: c.value,
          domain: c.domain || '.x.com',
          path: c.path || '/',
          secure: true,
          sameSite: 'None' as const,
        })),
      );
    }
    this.log(`browser started (headless=${this.config.headless}, ${this.cookies.length} cookie(s))`);
  }

  async stop(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.context = null;
    }
    this.log('browser stopped');
  }

  /** Scrape a single keyword's live-search results. */
  async scrapeKeyword(keyword: string, limit: number, cutoff: Date | null): Promise<Tweet[]> {
    if (!this.context) throw new Error('scraper not started');
    const page = await this.context.newPage();
    const tweets: Tweet[] = [];

    try {
      const url = `https://x.com/search?q=${encodeURIComponent(keyword)}&src=typed_query&f=live`;
      this.log(`scraping keyword: "${keyword}"`);

      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      await humanDelay(2.0, 4.0);

      try {
        await page.waitForSelector('article[data-testid="tweet"]', { timeout: 15_000 });
      } catch {
        this.log(`no tweets for "${keyword}" — page may require login`);
        return tweets;
      }

      const seenIds = new Set<string>();
      let scrollAttempts = 0;
      const maxScrolls = Math.floor(limit / 3) + 5;

      while (tweets.length < limit && scrollAttempts < maxScrolls) {
        const articles = await page.$$('article[data-testid="tweet"]');

        for (const article of articles) {
          if (tweets.length >= limit) break;

          const tweet = await this.extractTweet(article);
          if (!tweet || !tweet.tweetId) continue;
          if (seenIds.has(tweet.tweetId)) continue;
          if (tweet.likes < this.config.minimumPostLikes) continue;
          if (tweet.views < this.config.minimumPostViews) continue;
          if (cutoff && tweet.timestamp) {
            const postTime = new Date(tweet.timestamp);
            if (!Number.isNaN(postTime.getTime()) && postTime < cutoff) continue;
          }

          seenIds.add(tweet.tweetId);
          tweets.push(tweet);
        }

        // String form avoids needing the DOM lib in tsconfig.
        await page.evaluate('window.scrollBy(0, window.innerHeight * 2)');
        await humanDelay(1.5, 3.5);
        scrollAttempts += 1;
      }

      this.log(`scraped ${tweets.length} tweets for "${keyword}"`);
    } catch (err) {
      this.log(`error scraping "${keyword}": ${(err as Error).message}`);
    } finally {
      await page.close();
    }

    return tweets;
  }

  /** Extract a single tweet from an <article> element handle. */
  private extractTweet(article: ElementHandle): Promise<Tweet | null> {
    return extractTweetFromArticle(article);
  }

  /** Scrape every given keyword, capped at `overallLimit` total tweets. */
  async scrapeAllKeywords(
    keywords: string[],
    overallLimit: number,
    cutoff: Date | null,
  ): Promise<Tweet[]> {
    const all: Tweet[] = [];
    const seen = new Set<string>();

    for (const keyword of keywords) {
      if (all.length >= overallLimit) break;
      const remaining = overallLimit - all.length;
      const perKeyword = Math.min(this.config.scrapeLimitPerKeyword, remaining);

      const tweets = await this.scrapeKeyword(keyword, perKeyword, cutoff);
      for (const t of tweets) {
        if (seen.has(t.tweetId)) continue;
        seen.add(t.tweetId);
        all.push(t);
      }
      await humanDelay(3.0, 7.0);
    }

    this.log(`total tweets across all keywords: ${all.length}`);
    return all;
  }
}

const HASHTAG_RE = /#(\w+)/g;

/** Map a scraped tweet into the server's platform-agnostic RawLead shape. */
export function tweetToLead(tweet: Tweet): RawLead {
  const text = tweet.postText.replace(/\s+/g, ' ').trim();
  // Slice by code point, not UTF-16 unit: `text.slice(0, 100)` can cut an emoji
  // in half and leave a lone surrogate, which Postgres rejects outright.
  const points = Array.from(text);
  const title = text
    ? points.slice(0, 100).join('') + (points.length > 100 ? '…' : '')
    : `Tweet by @${tweet.authorUsername}`;
  const tags = [...new Set(Array.from(text.matchAll(HASHTAG_RE), (m) => m[1]))].slice(0, 6);

  return {
    title,
    platform: 'twitter',
    description: text,
    url: tweet.postUrl,
    author: tweet.authorDisplayName || `@${tweet.authorUsername}`,
    tags,
    postedAt: tweet.timestamp || undefined,
  };
}

/**
 * The Scraper the server runs on a schedule. Launches a browser, scrapes, maps
 * to leads, and always tears the browser down — even on error.
 */
export const twitterScraper: Scraper = {
  platform: 'twitter',
  name: 'Twitter/X',

  async scrape(ctx: ScrapeContext): Promise<RawLead[]> {
    const hasAuth = ctx.cookies.some((c) => c.name === 'auth_token');
    if (!hasAuth) {
      ctx.log('no X auth_token cookie — connect your X account first');
      return [];
    }

    // Search settings come from your saved config; only the browser runtime
    // (headless, proxies, user agent) comes from the environment.
    const config = loadTwitterConfig({
      keywords: ctx.config.keywords,
      scrapeLimitPerKeyword: ctx.config.twitterLimitPerKeyword,
      minimumPostLikes: ctx.config.twitterMinLikes,
      minimumPostViews: ctx.config.twitterMinViews,
      maxPostAgeHours: ctx.config.maxPostAgeHours,
    });

    const keywords = config.keywords;
    if (!keywords.length) {
      ctx.log('no keywords set — add some on the Config page');
      return [];
    }

    // Combine the scraper's max-age config with any `since` the server passes.
    const cutoffs = [
      config.maxPostAgeHours > 0
        ? new Date(Date.now() - config.maxPostAgeHours * 60 * 60 * 1000)
        : null,
      ctx.since ?? null,
    ].filter((d): d is Date => d !== null);
    const cutoff = cutoffs.length ? new Date(Math.max(...cutoffs.map((d) => d.getTime()))) : null;

    const scraper = new TwitterScraper(config, ctx.cookies, ctx.log);
    try {
      await scraper.start();
      const tweets = await scraper.scrapeAllKeywords(keywords, ctx.limit, cutoff);
      return tweets.map(tweetToLead);
    } finally {
      await scraper.stop();
    }
  },
};

export default twitterScraper;
