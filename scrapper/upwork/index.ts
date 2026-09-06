import { type ElementHandle, type Page } from 'playwright';
import type { RawLead, Scraper, ScrapeContext } from '../../server/src/scrapers/types';
import { cdpUrl, deleteProfile, hasProfile, openProfile, waitForSignIn } from '../lib/profile';
import {
  loadUpworkConfig,
  loadUpworkRuntimeConfig,
  type UpworkConfig,
  type UpworkRuntimeConfig,
} from './config';

const PLATFORM = 'upwork' as const;

/**
 * Upwork scraper.
 *
 * Opens the persistent Chromium profile you signed in with (see
 * ../lib/profile.ts) — no Chrome to start by hand, no remote-debugging port,
 * and no cookies to inject. It pages through the configured feed until jobs
 * exceed the age cutoff, optionally enriches each one from its detail page,
 * and maps everything to `RawLead`s.
 *
 * Side-effect free by design: no files written, no webhooks called. Storing,
 * de-duplicating and announcing leads is the server's job, which is what makes
 * re-seeing the same job on the next cycle a no-op.
 *
 * Upwork sits behind Cloudflare, which serves headless Chromium a 403 "Just a
 * moment..." wall. That is what the challenge handling below is for: the run
 * reopens in a visible window, you clear it once, and the clearance cookie is
 * saved into the profile like any other.
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

/**
 * Wait for navigation to actually finish.
 *
 * Upwork answers a lot of requests with an interstitial that immediately
 * redirects, so the document that fires `domcontentloaded` is frequently not
 * the page you end up on. Anything that reads the URL or title to decide what
 * kind of page this is has to wait for this first.
 */
async function settle(page: Page): Promise<void> {
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);
  await sleep(1500);
}

/**
 * Wording a bot wall uses. Cloudflare's is the one that matters here — Upwork
 * sits behind it, and its interstitial says "Just a moment...", which matched
 * none of the obvious words like "captcha" or "challenge". Missing it meant the
 * run fell through to waitForFeed and spent two minutes nudging a 403.
 */
const CHALLENGE_PHRASES = [
  'just a moment',
  'checking your browser',
  'attention required',
  'access denied',
  'captcha',
  'challenge',
  'verify',
  'robot',
  'blocked',
];

/** Cloudflare's markup, under whichever name it is using this month. */
const CHALLENGE_SELECTOR = '#challenge-form, #cf-challenge-running, [class*="cf-turnstile"]';

/**
 * Does the page look like a bot wall rather than the feed?
 *
 * @param status HTTP status of the navigation, when this is called right after
 *   one. Cloudflare serves its interstitial as 403/503 and only then runs the
 *   JS that rewrites the page, so the status is the earliest and most reliable
 *   signal available — the title still says "Just a moment..." either way.
 */
async function looksLikeChallenge(page: Page, status?: number): Promise<boolean> {
  try {
    if (status === 403 || status === 503) return true;

    const url = page.url().toLowerCase();
    const title = (await page.title()).toLowerCase();
    if (CHALLENGE_PHRASES.some((kw) => url.includes(kw) || title.includes(kw))) return true;

    return (await page.locator(CHALLENGE_SELECTOR).count()) > 0;
  } catch {
    return false;
  }
}

const CAPTCHA_POLL_MS = 3_000;

/**
 * Wait for a person to solve the challenge in the visible window.
 *
 * Polls the page rather than watching for navigation: some challenges resolve
 * in place without one, and the check is the same keyword test that detected it.
 */
async function waitForCaptchaSolved(
  page: Page,
  log: (m: string) => void,
  timeoutMs: number,
): Promise<boolean> {
  const minutes = Math.round(timeoutMs / 60_000);
  log(`solve the challenge in the browser window — waiting up to ${minutes} minute(s)…`);

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await sleep(CAPTCHA_POLL_MS);
    if (!(await looksLikeChallenge(page))) {
      log('challenge solved — resuming');
      // Let the page settle before the caller starts reading tiles off it.
      await sleep(2000);
      return true;
    }
  }
  log('nobody solved the challenge in time — giving up on this run');
  return false;
}

/**
 * Returns true when the run is blocked and should stop.
 *
 * A headless pass can never solve a challenge, so it reports being blocked and
 * lets `scrape()` decide whether to reopen the whole thing in a window someone
 * can actually use.
 */
async function handleChallenge(
  page: Page,
  ctx: ScrapeContext,
  headless: boolean,
  status?: number,
): Promise<boolean> {
  if (!(await looksLikeChallenge(page, status))) return false;
  if (headless) {
    ctx.log('bot challenge detected — headless cannot clear it');
    return true;
  }
  return !(await waitForCaptchaSolved(page, ctx.log, ctx.captchaTimeoutMs));
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
    try {
      await page.evaluate('window.scrollTo(0, 400)');
      await sleep(3000);
      await page.evaluate('window.scrollTo(0, 0)');
      await sleep(2000);
    } catch {
      // The page went away mid-nudge (closed window, navigation). That is a
      // feed we will never see, not a crash worth reporting as one — it used to
      // surface as "Target page, context or browser has been closed".
      log('the page closed while waiting for the feed');
      return false;
    }
  }
  return false;
}

const LOAD_MORE_SEL = "[data-test='load-more-button']";

/** What one pass over the feed produced, and whether a challenge stopped it. */
interface PassResult {
  leads: RawLead[];
  /** True when a bot challenge ended the pass early. */
  blocked: boolean;
}

/**
 * One full pass over the feed with a browser of the given visibility.
 *
 * Split out from `scrape()` so it can be run twice: once headless, and — if
 * that hits a challenge — again in a window someone can solve it in. Playwright
 * cannot make a running headless browser visible, so a second launch is the
 * only way to put the challenge in front of a person.
 */
async function runPass(
  ctx: ScrapeContext,
  cfg: UpworkConfig,
  headless: boolean,
): Promise<PassResult> {
  // Already signed in — there is nothing to inject. When CHROME_CDP_URL is set
  // this attaches to the Chrome you started rather than launching anything, so
  // `headless` is simply not ours to decide.
  const session = await openProfile(PLATFORM, { headless, userAgent: cfg.userAgent });

  const feedUrl = cfg.jobsUrl;

  const seen = new Set<string>();
  const jobs: UpworkJob[] = [];
  let detailPage: Page | null = null;

  try {
    const page = await session.page();

    ctx.log(`navigating to feed: ${feedUrl}`);
    const response = await page.goto(feedUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });

    // Let the redirects finish before deciding what this page is.
    //
    // `domcontentloaded` fires on the *first* document, which for Upwork is
    // often an interstitial on its way to somewhere else. Classifying that
    // early read "bot challenge detected" 250ms after navigating, on what was
    // really a sign-in redirect — and then opened a browser window asking
    // someone to solve a login page.
    await settle(page);

    // Signed out is checked first, and is not a challenge. Nobody can "solve"
    // a login page, and waitForFeed would spend 105 seconds nudging one.
    if (looksSignedOut(page)) {
      throw new Error('Signed out of Upwork — sign in again on the Connections page.');
    }

    if (await handleChallenge(page, ctx, headless, response?.status())) {
      return { leads: [], blocked: true };
    }

    if (!(await waitForFeed(page, ctx.log))) {
      ctx.log('job feed did not load — skipping this run');
      return { leads: [], blocked: false };
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
    let blocked = false;

    while (!done && clicks < cfg.maxLoadMoreClicks && jobs.length < ctx.limit) {
      if (await handleChallenge(page, ctx, headless)) {
        blocked = true;
        break;
      }
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
      detailPage = await session.context.newPage();
      for (const job of jobs) {
        if (await handleChallenge(detailPage, ctx, headless)) {
          blocked = true;
          break;
        }
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
    if (cfg.maxAgeHours <= 0) return { leads, blocked };

    const cutoff = Date.now() - cfg.maxAgeHours * 60 * 60 * 1000;
    const fresh = leads.filter(
      (lead) => !lead.postedAt || new Date(lead.postedAt).getTime() >= cutoff,
    );
    if (fresh.length < leads.length) {
      ctx.log(`dropped ${leads.length - fresh.length} job(s) older than ${cfg.maxAgeHours}h`);
    }
    return { leads: fresh, blocked };
  } finally {
    if (detailPage) await detailPage.close().catch(() => undefined);
    // Closes our own browser, or just drops the CDP connection when the browser
    // is one the user started.
    await session.release();
  }
}

/**
 * Where a signed-in session ends up. Upwork's whole logged-in app lives under
 * `/nx/`; a signed-out visitor is bounced to `/ab/account-security/login` or to
 * marketing.
 *
 * Deliberately a *positive* match on where we landed, not "we are not on a
 * login page". The negative form calls a blank tab or a failed navigation
 * signed in, which is exactly the false pass that would save an empty profile
 * and then quietly scrape nothing.
 */
const SIGNED_IN_URL = /^https:\/\/www\.upwork\.com\/nx\//;

/** Upwork bounces a signed-out session here, whatever page you asked for. */
const SIGNED_OUT_URL = /\/(ab\/account-security|login|signup)/;

async function isSignedIn(page: Page): Promise<boolean> {
  return SIGNED_IN_URL.test(page.url().toLowerCase());
}

function looksSignedOut(page: Page): boolean {
  return SIGNED_OUT_URL.test(page.url().toLowerCase());
}

/** The page a signed-in session can reach and a signed-out one cannot. */
const FEED_URL = 'https://www.upwork.com/nx/find-work/most-recent';

/**
 * Load the feed and report whether we were allowed to stay on it.
 *
 * This is the only check that actually proves a session works — the URL alone
 * cannot, because Upwork's login flow passes through `/nx/` on its way.
 */
async function confirmSignedIn(page: Page): Promise<boolean> {
  await page.goto(FEED_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await sleep(1500);
  return !looksSignedOut(page) && (await isSignedIn(page));
}

const SIGN_IN_URL = 'https://www.upwork.com/ab/account-security/login';

export const upworkScraper: Scraper = {
  platform: PLATFORM,
  name: 'Upwork',

  async checkSession(log) {
    if (!hasProfile(PLATFORM)) return { hasProfile: false, signedIn: false };

    const cfg = loadUpworkRuntimeConfig();
    const session = await openProfile(PLATFORM, { headless: true, userAgent: cfg.userAgent });
    try {
      const page = await session.page();
      const signedIn = await confirmSignedIn(page);
      if (!signedIn) log('the saved Upwork session has expired — sign in again');
      return {
        hasProfile: true,
        signedIn,
        detail: signedIn ? undefined : 'Session expired — sign in again.',
      };
    } catch (err) {
      return { hasProfile: true, signedIn: false, detail: (err as Error).message };
    } finally {
      await session.release();
    }
  },

  async signIn({ timeoutMs, log }) {
    const cfg = loadUpworkRuntimeConfig();
    // Always visible: the entire point is that a person signs in by hand.
    const session = await openProfile(PLATFORM, { headless: false, userAgent: cfg.userAgent });
    if (session.attached) {
      log('signing in inside the Chrome you started — look for the new tab');
    }
    try {
      const page = await session.page();
      await page.goto(SIGN_IN_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      return await waitForSignIn(
        session,
        () => isSignedIn(page),
        () => confirmSignedIn(page),
        timeoutMs,
        log,
      );
    } finally {
      await session.release();
    }
  },

  async signOut() {
    deleteProfile(PLATFORM);
  },

  async scrape(ctx: ScrapeContext): Promise<RawLead[]> {
    if (!hasProfile(PLATFORM)) {
      ctx.log('not signed in to Upwork — connect it on the Connections page first');
      return [];
    }

    // Search settings come from your saved config; only the browser runtime
    // (headless, user agent, timeouts) comes from the environment.
    const cfg = loadUpworkConfig({
      jobsUrl: ctx.config.upworkJobsUrl,
      maxAgeHours: ctx.config.upworkMaxAgeHours,
      fetchDetails: ctx.config.upworkFetchDetails,
    });

    // Attached to your own Chrome: it is already a real, visible browser, so
    // there is no headless pass to retry and no second window to open.
    const headless = cdpUrl() ? false : cfg.headless;

    const first = await runPass(ctx, cfg, headless);
    if (!first.blocked) return first.leads;

    // Blocked. If the window was already visible, the person had their chance
    // and either did not solve it or was not there.
    if (!headless) return first.leads;

    if (!ctx.interactive) {
      ctx.log('challenge hit and CAPTCHA_OPEN_WINDOW is off — skipping this run');
      return first.leads;
    }

    ctx.log('reopening Upwork in a visible window so you can solve the challenge');
    // The headless pass only just let go of this profile, and Chromium releases
    // the directory a beat after close() resolves.
    await sleep(3000);
    const second = await runPass(ctx, cfg, false);

    // The second pass restarts from the top of the feed, so it normally
    // supersedes the first. If nobody solved the challenge it comes back empty,
    // and whatever the headless pass managed to collect is better than nothing.
    return second.leads.length ? second.leads : first.leads;
  },
};

export default upworkScraper;
