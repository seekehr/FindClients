import { chromium, type ElementHandle, type Page } from 'playwright';
import type { RawLead, Scraper, ScrapeContext } from '../../server/src/scrapers/types';
import { loadUpworkConfig, type UpworkRuntimeConfig } from './config';

/**
 * Upwork scraper.
 *
 * Launches its own Chromium and injects the Upwork session cookies you saved
 * on the Connections page — there is no Chrome to start by hand and no
 * remote-debugging port to open. It pages through the configured feed until
 * jobs exceed the age cutoff, optionally enriches each one from its detail
 * page, and maps everything to `RawLead`s.
 *
 * Side-effect free by design: no files written, no webhooks called. Storing,
 * de-duplicating and announcing leads is the server's job, which is what makes
 * re-seeing the same job on the next cycle a no-op.
 *
 * Without cookies the scraper returns [] and says so in the log, rather than
 * throwing and taking the cycle down with it.
 */

export interface UpworkJob {
  title: string;
  url: string;
  description: string;
  rate: string;
  estimatedBudget: string;
  proposals: string;
  posted: string;
  clientMoneySpent: string;
  paymentVerified: string;
  clientCountry: string;
  clientRating: string;
  clientHireRate: string;
  skills: string[];
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// ── "Posted N ago" → milliseconds ─────────────────────────────
const UNIT_SECONDS: Record<string, number> = {
  second: 1, seconds: 1,
  minute: 60, minutes: 60,
  hour: 3600, hours: 3600,
  day: 86_400, days: 86_400,
  week: 604_800, weeks: 604_800,
  month: 2_592_000, months: 2_592_000,
  year: 31_536_000, years: 31_536_000,
};

/** Parse "posted 2 hours ago" / "just now" / "yesterday" into an age in ms. */
export function parsePostedAgeMs(text: string): number | null {
  const t = text.trim().toLowerCase();
  if (t === 'just now' || t === 'moments ago') return 0;
  if (t === 'yesterday') return 86_400 * 1000;
  const m = t.match(/(\d+)\s+(\w+)\s+ago/);
  if (m) {
    const n = Number.parseInt(m[1], 10);
    const secs = UNIT_SECONDS[m[2]];
    if (secs) return n * secs * 1000;
  }
  return null;
}

/** The moment a job was posted (approx), or null if unparseable. */
export function postedDate(text: string): Date | null {
  const age = parsePostedAgeMs(text);
  return age === null ? null : new Date(Date.now() - age);
}

/**
 * Derive a rating from the "foreground" rating bar. If a screen-reader label
 * with a number is available use that; otherwise convert the bar width (a full
 * 5-star bar is 78px wide) into a 0–5 value.
 */
export function ratingFromForeground(style: string, srText?: string): string {
  if (srText) {
    const m = srText.match(/[\d.]+/);
    if (m) return m[0];
  }
  const m = style.match(/width:\s*([\d.]+)px/);
  if (m) {
    const v = Number.parseFloat(m[1]);
    if (Number.isFinite(v)) return String(Math.round((v / 78) * 5 * 10) / 10);
  }
  return '';
}

const safeText = async (el: ElementHandle | null): Promise<string> =>
  el ? (await el.innerText()).trim() : '';

async function ratingFromTile(section: ElementHandle): Promise<string> {
  // Prefer an explicit "Rating is X out of 5" screen-reader label.
  const srs = await section.$$('span.sr-only');
  for (const sr of srs) {
    const text = await sr.innerText();
    if (/Rating is/i.test(text)) {
      const m = text.match(/([\d.]+)\s+out of/);
      return m ? m[1] : '';
    }
  }
  // Fall back to the rating bar width.
  const fg = await section.$('div.air3-rating-foreground');
  if (fg) return ratingFromForeground((await fg.getAttribute('style')) ?? '');
  return '';
}

/** Parse one feed tile (<section class="air3-card-section">) into a job. */
export async function parseJobTile(section: ElementHandle): Promise<UpworkJob> {
  const titleA = await section.$('a[data-ev-label="link"]');
  const href = titleA ? await titleA.getAttribute('href') : '';

  const skillEls = await section.$$('[data-test="token"], [data-test="attr-item"]');
  const skills: string[] = [];
  for (const el of skillEls) {
    const s = (await el.innerText()).trim();
    if (s) skills.push(s);
  }

  return {
    title: await safeText(titleA),
    url: href ? `https://www.upwork.com${href}` : '',
    description: await safeText(await section.$('[data-test="job-description-text"]')),
    rate: await safeText(await section.$('strong[data-test="job-type"]')),
    estimatedBudget: await safeText(await section.$('[data-test="budget"]')),
    proposals: await safeText(await section.$('[data-test="proposals-tier"]')),
    posted: await safeText(await section.$('[data-test="posted-on"]')),
    clientMoneySpent: await safeText(await section.$('[data-test="formatted-amount"]')),
    paymentVerified: await safeText(await section.$('strong[data-test="payment-verification-status"]')),
    clientCountry: (await safeText(await section.$('small[data-test="client-country"]'))).replace(/\s+/g, ' '),
    clientRating: await ratingFromTile(section),
    clientHireRate: '',
    skills: [...new Set(skills)].slice(0, 8),
  };
}

/** Does the page look like a CAPTCHA / bot challenge? */
async function looksLikeChallenge(page: Page): Promise<boolean> {
  try {
    const url = page.url().toLowerCase();
    const title = (await page.title()).toLowerCase();
    return ['captcha', 'challenge', 'verify', 'robot', 'blocked'].some(
      (kw) => url.includes(kw) || title.includes(kw),
    );
  } catch {
    return false;
  }
}

const CAPTCHA_POLL_MS = 3_000;
const CAPTCHA_TIMEOUT_MS = 5 * 60 * 1000;

async function waitForCaptchaSolved(
  page: Page,
  log: (m: string) => void,
): Promise<boolean> {
  log('CAPTCHA detected — solve it in the browser window. Waiting up to 5 minutes…');
  const deadline = Date.now() + CAPTCHA_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await sleep(CAPTCHA_POLL_MS);
    if (!(await looksLikeChallenge(page))) {
      log('CAPTCHA solved — resuming');
      await sleep(2000);
      return true;
    }
  }
  log('CAPTCHA timeout — giving up');
  return false;
}

async function handleChallenge(
  page: Page,
  ctx: ScrapeContext,
): Promise<boolean> {
  if (!(await looksLikeChallenge(page))) return false;
  if (ctx.interactive) return !(await waitForCaptchaSolved(page, ctx.log));
  if (ctx.onCaptcha) {
    ctx.log('CAPTCHA detected — waiting for you to solve it in the dashboard');
    const solved = await ctx.onCaptcha(page, 'upwork');
    if (solved) {
      ctx.log('CAPTCHA solved via dashboard — resuming');
      return false;
    }
    ctx.log('CAPTCHA not solved — skipping');
    return true;
  }
  ctx.log('CAPTCHA/challenge detected (headless — cannot solve, skipping)');
  return true;
}

/** Visit a job's detail page to enrich client rating + hire rate. */
async function scrapeDetail(
  page: Page,
  url: string,
  cfg: UpworkRuntimeConfig,
  log: (m: string) => void,
): Promise<{ clientRating: string; clientHireRate: string }> {
  const result = { clientRating: '', clientHireRate: '' };
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForSelector('text=/hire rate/i', { timeout: cfg.detailTimeoutMs });
  } catch {
    log(`detail timeout: ${url}`);
    return result;
  }

  // Rating: prefer the "Rating is X out of 5" label, then the value text, then
  // the rating-bar width (same precedence as the reference).
  for (const sr of await page.$$('span.sr-only')) {
    const t = await sr.innerText();
    if (/Rating is/i.test(t)) {
      const m = t.match(/([\d.]+)\s+out of/);
      result.clientRating = m ? m[1] : '';
      break;
    }
  }
  if (!result.clientRating) {
    result.clientRating = await safeText(await page.$('div.air3-rating-value-text'));
  }
  if (!result.clientRating) {
    const fg = await page.$('div.air3-rating-foreground');
    if (fg) result.clientRating = ratingFromForeground((await fg.getAttribute('style')) ?? '');
  }

  const body = await page.innerText('body').catch(() => '');
  const hire = body.match(/\d+%\s+hire rate/i);
  if (hire) result.clientHireRate = hire[0].trim();

  return result;
}

/** Map a scraped Upwork job into the server's platform-agnostic RawLead shape. */
export function jobToLead(job: UpworkJob): RawLead {
  const clientBits: string[] = [];
  if (job.clientRating) clientBits.push(`⭐ ${job.clientRating}`);
  if (job.clientHireRate) clientBits.push(job.clientHireRate);
  if (job.clientMoneySpent) clientBits.push(`${job.clientMoneySpent} spent`);
  if (job.paymentVerified) clientBits.push(job.paymentVerified);
  if (job.clientCountry) clientBits.push(job.clientCountry);

  const description =
    job.description + (clientBits.length ? `\n\nClient: ${clientBits.join(' · ')}` : '');

  const posted = postedDate(job.posted);

  return {
    title: job.title,
    platform: 'upwork',
    description,
    budget: job.estimatedBudget || job.rate || null,
    timeline: null,
    url: job.url,
    author: null,
    tags: job.skills,
    postedAt: posted ? posted.toISOString() : undefined,
  };
}

/** Wait for the feed to hydrate, nudging the SPA a few times if needed. */
async function waitForFeed(page: Page, log: (m: string) => void): Promise<boolean> {
  const selectors = ['section.air3-card-section', '[data-test="job-tile"]', '.job-tile-title'];
  for (let attempt = 0; attempt < 3; attempt += 1) {
    for (const sel of selectors) {
      try {
        await page.waitForSelector(sel, { timeout: 10_000 });
        return true;
      } catch {
        /* try next selector */
      }
    }
    log(`feed not visible yet (attempt ${attempt + 1}) — nudging`);
    await page.evaluate('window.scrollTo(0, 400)');
    await sleep(3000);
    await page.evaluate('window.scrollTo(0, 0)');
    await sleep(2000);
  }
  return false;
}

const LOAD_MORE_SEL = "[data-test='load-more-button']";

export const upworkScraper: Scraper = {
  platform: 'upwork',
  name: 'Upwork',

  async scrape(ctx: ScrapeContext): Promise<RawLead[]> {
    if (!ctx.cookies.length) {
      ctx.log('no Upwork session cookies — connect your Upwork account first');
      return [];
    }

    // Search settings come from your saved config; only the browser runtime
    // (headless, user agent, timeouts) comes from the environment.
    const cfg = loadUpworkConfig({
      jobsUrl: ctx.config.upworkJobsUrl,
      maxAgeHours: ctx.config.upworkMaxAgeHours,
      fetchDetails: ctx.config.upworkFetchDetails,
    });

    const browser = await chromium.launch({ headless: cfg.headless });

    const feedUrl = cfg.jobsUrl;

    const seen = new Set<string>();
    const jobs: UpworkJob[] = [];
    let detailPage: Page | null = null;

    try {
      // Inject the user's pasted Upwork session so the feed loads as logged-in.
      const context = await browser.newContext({
        viewport: { width: 1280, height: 900 },
        userAgent: cfg.userAgent,
      });
      await context.addCookies(
        ctx.cookies.map((c) => ({
          name: c.name,
          value: c.value,
          domain: c.domain || '.upwork.com',
          path: c.path || '/',
          secure: true,
          sameSite: 'Lax' as const,
        })),
      );
      const page = await context.newPage();

      ctx.log(`navigating to feed: ${feedUrl}`);
      await page.goto(feedUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });

      if (await handleChallenge(page, ctx)) {
        return [];
      }
      if (!(await waitForFeed(page, ctx.log))) {
        ctx.log('job feed did not load — skipping this run');
        return [];
      }
      await sleep(1500);

      const collect = async (): Promise<boolean> => {
        const sections = await page.$$('section.air3-card-section');
        for (const section of sections) {
          if (jobs.length >= ctx.limit) return true;
          const job = await parseJobTile(section);
          if (!job.title || !job.url || seen.has(job.url)) continue;
          seen.add(job.url);
          jobs.push(job);
        }
        return false;
      };

      let done = await collect();
      let clicks = 0;
      while (!done && clicks < cfg.maxLoadMoreClicks && jobs.length < ctx.limit) {
        if (await handleChallenge(page, ctx)) break;
        const button = page.locator(LOAD_MORE_SEL);
        if ((await button.count()) === 0) {
          ctx.log('no "Load More Jobs" button — feed exhausted');
          break;
        }
        const before = await page.locator('section.air3-card-section').count();
        await button.scrollIntoViewIfNeeded();
        await sleep(500);
        await button.click();
        clicks += 1;

        try {
          await page.waitForFunction(
            `document.querySelectorAll('section.air3-card-section').length > ${before}`,
            undefined,
            { timeout: cfg.loadMoreWaitMs },
          );
        } catch {
          ctx.log('no new tiles after "Load More" — stopping');
          break;
        }
        await sleep(1500);
        done = await collect();
      }

      ctx.log(`collected ${jobs.length} job(s)`);

      if (cfg.fetchDetails && jobs.length) {
        detailPage = await context.newPage();
        for (const job of jobs) {
          if (await handleChallenge(detailPage, ctx)) break;
          const detail = await scrapeDetail(detailPage, job.url, cfg, ctx.log);
          if (detail.clientRating) job.clientRating = detail.clientRating;
          job.clientHireRate = detail.clientHireRate;
          await sleep(cfg.requestDelayMs);
        }
      }

      // The feed is ordered newest-first but keeps going back for as long as you
      // click "Load More", so the age window is applied here rather than by
      // asking Upwork for it. A job whose "posted" text we could not parse is
      // kept: dropping a real lead is worse than showing a stale one.
      const leads = jobs.map(jobToLead);
      if (cfg.maxAgeHours <= 0) return leads;

      const cutoff = Date.now() - cfg.maxAgeHours * 60 * 60 * 1000;
      const fresh = leads.filter(
        (lead) => !lead.postedAt || new Date(lead.postedAt).getTime() >= cutoff,
      );
      if (fresh.length < leads.length) {
        ctx.log(`dropped ${leads.length - fresh.length} job(s) older than ${cfg.maxAgeHours}h`);
      }
      return fresh;
    } finally {
      if (detailPage) await detailPage.close().catch(() => undefined);
      // Closing a CDP connection detaches Playwright without closing your Chrome.
      await browser.close().catch(() => undefined);
    }
  },
};

export default upworkScraper;
