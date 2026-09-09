import { type ElementHandle, type Page } from 'playwright';
import type { LeadMetadata, RawLead, Scraper } from '../../server/src/scrapers/types';
import { deleteProfile, hasProfile, openProfile, waitForSignIn } from '../lib/profile';
import { loadUpworkRuntimeConfig, type UpworkRuntimeConfig } from './config';

const PLATFORM = 'upwork' as const;

/**
 * Upwork — a connector, not a scraper.
 *
 * This file used to page through the jobs feed, click "Load More" twenty times
 * and open every listing it found. That is the behaviour Upwork's terms forbid,
 * and it is the behaviour its systems are built to catch: one session pulling
 * hundreds of jobs on a fixed schedule does not look like a freelancer, it looks
 * like what it is. The accounts that get banned are doing exactly that.
 *
 * So there is no `scrape` here any more, and its absence is deliberate rather
 * than incidental — `Scraper.scrape` is optional precisely so a watch-mode
 * platform can decline to have one, and the scrape cycle can never reach a
 * platform that does not implement it.
 *
 * What is left is the half that was always fine: signing in by hand, checking
 * whether that session still works, and the page-reading helpers. Collection
 * happens in ./watch.ts, one open tab at a time.
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

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

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

/** Every fact about the client, in the shape the app stores and renders. */
export function clientMetadata(job: UpworkJob): LeadMetadata {
  const meta: LeadMetadata = {};
  if (job.clientRating) meta.clientRating = job.clientRating;
  if (job.clientHireRate) meta.clientHireRate = job.clientHireRate;
  if (job.clientMoneySpent) meta.clientSpent = job.clientMoneySpent;
  if (job.paymentVerified) meta.paymentVerified = job.paymentVerified;
  if (job.clientCountry) meta.clientCountry = job.clientCountry;
  if (job.proposals) meta.proposals = job.proposals;
  if (job.rate) meta.jobType = job.rate;
  return meta;
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
    metadata: clientMetadata(job),
    postedAt: posted ? posted.toISOString() : undefined,
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
export async function settle(page: Page): Promise<void> {
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
export async function looksLikeChallenge(page: Page, status?: number): Promise<boolean> {
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
export async function waitForCaptchaSolved(
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
  log('nobody solved the challenge in time — giving up for now');
  return false;
}

/** Visit a job's detail page to enrich client rating + hire rate. */
export async function readJobDetail(
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
  // the rating-bar width (same precedence as the feed tile).
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

/** Wait for the feed to hydrate, nudging the SPA a few times if needed. */
export async function waitForFeed(page: Page, log: (m: string) => void): Promise<boolean> {
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

/** Read every job tile currently rendered on the feed. Never loads more. */
export async function readFeed(page: Page): Promise<UpworkJob[]> {
  const jobs: UpworkJob[] = [];
  const seen = new Set<string>();

  for (const section of await page.$$('section.air3-card-section')) {
    const job = await parseJobTile(section);
    if (!job.title || !job.url || seen.has(job.url)) continue;
    seen.add(job.url);
    jobs.push(job);
  }
  return jobs;
}

/**
 * Where a signed-in session ends up. Upwork's whole logged-in app lives under
 * `/nx/`; a signed-out visitor is bounced to `/ab/account-security/login` or to
 * marketing.
 *
 * Deliberately a *positive* match on where we landed, not "we are not on a
 * login page". The negative form calls a blank tab or a failed navigation
 * signed in, which is exactly the false pass that would save an empty profile
 * and then quietly watch nothing.
 */
const SIGNED_IN_URL = /^https:\/\/www\.upwork\.com\/nx\//;

/** Upwork bounces a signed-out session here, whatever page you asked for. */
const SIGNED_OUT_URL = /\/(ab\/account-security|login|signup)/;

async function isSignedIn(page: Page): Promise<boolean> {
  return SIGNED_IN_URL.test(page.url().toLowerCase());
}

export function looksSignedOut(page: Page): boolean {
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

  /**
   * Watched, never scraped. The scrape cycle skips this platform entirely and
   * there is no `scrape` below for it to call even if it did not — see
   * ../../server/src/watcher/ for what runs instead.
   */
  mode: 'watch',

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
};

export default upworkScraper;
