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
  /** Upwork's job id ("~02…"), when known. What the feed readers merge on. */
  id?: string;
  /** Exact publish time from the page's own data, when it had one. */
  postedAt?: string;
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

/**
 * "Proposals: Less than 5" → "Less than 5". The tile and the job page both
 * label it, sometimes across a line break; the app wants just the tier.
 */
export function proposalsTier(text: string): string {
  return text.replace(/\s+/g, ' ').replace(/^proposals:\s*/i, '').trim();
}

/** Every fact about the client, in the shape the app stores and renders. */
export function clientMetadata(job: UpworkJob): LeadMetadata {
  const meta: LeadMetadata = {};
  if (job.clientRating) meta.clientRating = job.clientRating;
  if (job.clientHireRate) meta.clientHireRate = job.clientHireRate;
  if (job.clientMoneySpent) meta.clientSpent = job.clientMoneySpent;
  if (job.paymentVerified) meta.paymentVerified = job.paymentVerified;
  if (job.clientCountry) meta.clientCountry = job.clientCountry;
  if (proposalsTier(job.proposals)) meta.proposals = proposalsTier(job.proposals);
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

  // "Posted 55 minutes ago" is only accurate to the unit; the store's publish
  // time is exact, so it wins whenever the feed reader found one.
  const exact = job.postedAt ? new Date(job.postedAt) : null;
  const posted = exact && Number.isFinite(exact.getTime()) ? exact : postedDate(job.posted);

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

/** Visit a job's detail page to enrich client rating, hire rate and proposal count. */
export async function readJobDetail(
  page: Page,
  url: string,
  cfg: UpworkRuntimeConfig,
  log: (m: string) => void,
): Promise<{ clientRating: string; clientHireRate: string; proposals: string }> {
  const result = { clientRating: '', clientHireRate: '', proposals: '' };
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

  // "Activity on this job" — the label and the tier sit on separate lines.
  const proposals = body.match(/Proposals:\s*([^\n]+)/i);
  if (proposals) result.proposals = proposalsTier(proposals[1]);

  return result;
}

/** Wait for the feed to hydrate, nudging the SPA a few times if needed. */
export async function waitForFeed(page: Page, log: (m: string) => void): Promise<boolean> {
  const selectors = [
    'section[data-ev-opening_uid]',
    '[data-test="job-tile-list"] section',
    'section.air3-card-section',
    '[data-test="job-tile"]',
    '.job-tile-title',
  ];
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

// ── Reading the feed ──────────────────────────────────────────
//
// The feed is read three independent ways and the results merged by job id,
// so a markup change or a half-rendered list costs at most one of them:
//
//  1. Page data. Upwork's Nuxt store holds the feed as structured JSON — every
//     job the page loaded, with an exact publish time, whether or not its tile
//     has been drawn yet.
//  2. Tiles. The rendered cards, found by several selectors.
//  3. Title links. Any `/jobs/…~0…` link on the page, for when neither of the
//     above recognises the page any more.
//
// All three read what the page already has. None of them loads more.
//
// The in-page code is plain JavaScript strings rather than functions: tsx
// compiles functions with a `__name` helper that does not exist in the page,
// and Playwright would ship that reference across verbatim.

/**
 * A job's id: the "~02…" token in its URL, which the store calls `ciphertext`.
 * Not interchangeable with the store's numeric `uid` — "~022102…" is uid
 * 2102…, with a prefix that is not just "~0" — so everything merges on this.
 */
export function upworkJobId(value: string | null | undefined): string {
  const m = value?.match(/~0[0-9a-z]{6,}/i);
  return m ? m[0].toLowerCase() : '';
}

interface StoreJob {
  id: string;
  ciphertext: string;
  title: string;
  description: string;
  type: number | null;
  amount: number | null;
  hourlyMin: number | null;
  hourlyMax: number | null;
  publishedOn: string;
  proposalsTier: string;
  skills: string[];
  clientSpent: number | null;
  paymentVerified: number | null;
  clientCountry: string;
  clientFeedback: number | null;
  clientReviews: number | null;
}

interface TileJob extends Omit<UpworkJob, 'id' | 'postedAt'> {
  id: string;
}

/**
 * Strategy 1: the store. Picks the feed that matches the page being watched,
 * then any store module holding job-shaped rows, so a saved search or a feed
 * Upwork renames still reads.
 */
const READ_STORE_JS = `(() => {
  const roots = [];
  try { if (window.$nuxt && window.$nuxt.$store) roots.push(window.$nuxt.$store.state); } catch (e) {}
  try { if (window.__NUXT__ && window.__NUXT__.state) roots.push(window.__NUXT__.state); } catch (e) {}
  const path = location.pathname.toLowerCase();
  const preferred =
    path.includes('most-recent') ? 'feedMostRecent' :
    path.includes('best-matches') ? 'feedBestMatch' :
    path.includes('domestic') ? 'feedDomestic' :
    path.includes('/search/') ? 'jobSearch' :
    path.includes('/find-work') ? 'feedBestMatch' : '';
  const isJobs = (v) => Array.isArray(v) && v.length > 0 && v[0] && typeof v[0] === 'object' &&
    typeof v[0].title === 'string' && (v[0].ciphertext || v[0].uid || v[0].id);
  const pick = (state) => {
    if (!state) return null;
    if (preferred && state[preferred] && isJobs(state[preferred].jobs)) return state[preferred].jobs;
    let best = null;
    for (const key of Object.keys(state)) {
      const mod = state[key];
      if (mod && typeof mod === 'object' && isJobs(mod.jobs) && (!best || mod.jobs.length > best.length)) best = mod.jobs;
    }
    return best;
  };
  let jobs = null, source = '';
  for (const [i, root] of roots.entries()) { jobs = pick(root); if (jobs) { source = i === 0 && window.$nuxt ? 'store' : 'ssr'; break; } }
  if (!jobs) return { source: '', jobs: [] };
  const num = (v) => (typeof v === 'number' && isFinite(v) ? v : null);
  return {
    source,
    jobs: jobs.map((j) => {
      const c = j.client || {};
      const hb = j.hourlyBudget || {};
      return {
        id: String(j.uid || j.id || ''),
        ciphertext: String(j.ciphertext || ''),
        title: String(j.title || ''),
        description: String(j.description || ''),
        type: num(j.type),
        amount: num(j.amount && j.amount.amount),
        hourlyMin: num(hb.min),
        hourlyMax: num(hb.max),
        publishedOn: String(j.publishedOn || j.createdOn || ''),
        proposalsTier: String(j.proposalsTier || ''),
        skills: (j.attrs || []).map((a) => String(a.prettyName || a.prefLabel || '')).filter(Boolean),
        clientSpent: num(c.totalSpent),
        paymentVerified: num(c.paymentVerificationStatus),
        clientCountry: String((c.location && c.location.country) || ''),
        clientFeedback: num(c.totalFeedback),
        clientReviews: num(c.totalReviews),
      };
    }),
  };
})()`;

/** Where job tiles might be, most specific first. */
const TILE_SELECTORS = [
  'section[data-ev-opening_uid]',
  '[data-test="job-tile-list"] > section',
  '[data-test="job-tile"]',
  'article[data-test*="JobTile" i]',
  'section.air3-card-section',
];

/** The title link inside a tile, or anywhere on the page. */
const TITLE_LINK_SELECTORS = [
  'a[data-ev-label="link"]',
  '.job-tile-title a',
  'h3 a[href*="/jobs/"]',
  'h2 a[href*="/jobs/"]',
  'a[href*="/jobs/"][href*="~0"]',
];

/** Strategy 2 (tiles) and 3 (bare links), in one pass over the page. */
const READ_DOM_JS = `(() => {
  const TILES = ${JSON.stringify(TILE_SELECTORS)};
  const LINKS = ${JSON.stringify(TITLE_LINK_SELECTORS)};
  const text = (root, sel) => { const el = root.querySelector(sel); return el ? el.innerText.trim() : ''; };
  const isJobHref = (href) => !!href && href.includes('/jobs/') && /~0[0-9a-z]{6,}/i.test(href);
  const titleLink = (root) => {
    for (const sel of LINKS) for (const a of root.querySelectorAll(sel)) if (isJobHref(a.getAttribute('href'))) return a;
    return null;
  };
  const abs = (href) => (href.startsWith('http') ? href : 'https://www.upwork.com' + href);
  const idOf = (href) => {
    const m = href.match(/~0[0-9a-z]{6,}/i);
    return m ? m[0].toLowerCase() : '';
  };
  const rating = (tile) => {
    for (const sr of tile.querySelectorAll('span.sr-only')) {
      const m = sr.innerText.match(/Rating is\\s*([\\d.]+)/i);
      if (m) return m[1];
    }
    const fg = tile.querySelector('div.air3-rating-foreground');
    const w = fg && (fg.getAttribute('style') || '').match(/width:\\s*([\\d.]+)px/);
    return w ? String(Math.round((parseFloat(w[1]) / 78) * 50) / 10) : '';
  };

  const tiles = new Set();
  for (const sel of TILES) {
    for (const el of document.querySelectorAll(sel)) {
      // Only cards that are actually about a job; the sidebar reuses the class.
      if (titleLink(el)) tiles.add(el);
    }
  }
  // A tile matched by a loose selector can contain one matched by a tight one.
  const roots = [...tiles].filter((t) => ![...tiles].some((o) => o !== t && o.contains(t)));

  const fromTiles = roots.map((tile) => {
    const a = titleLink(tile);
    const href = a.getAttribute('href');
    const skills = [...tile.querySelectorAll('[data-test="token"], [data-test="attr-item"]')]
      .map((el) => el.innerText.trim()).filter(Boolean);
    return {
      id: idOf(href),
      title: a.innerText.trim(),
      url: abs(href),
      description: text(tile, '[data-test="job-description-text"]'),
      rate: text(tile, '[data-test="job-type"]'),
      estimatedBudget: text(tile, '[data-test="budget"]'),
      proposals: text(tile, '[data-test="proposals-tier"]'),
      posted: text(tile, '[data-test="posted-on"]'),
      clientMoneySpent: text(tile, '[data-test="formatted-amount"]'),
      paymentVerified: text(tile, '[data-test="payment-verification-status"]'),
      clientCountry: text(tile, '[data-test="client-country"]').replace(/\\s+/g, ' '),
      clientRating: rating(tile),
      clientHireRate: '',
      skills: [...new Set(skills)].slice(0, 8),
    };
  });

  const inTile = new Set(fromTiles.map((j) => j.id));
  const fromLinks = [];
  for (const a of document.querySelectorAll('a[href*="/jobs/"]')) {
    const href = a.getAttribute('href');
    const title = a.innerText.trim();
    if (!isJobHref(href) || !title) continue;
    const id = idOf(href);
    if (!id || inTile.has(id)) continue;
    inTile.add(id);
    // Nearest "Posted …" above the link, if the page still labels it.
    const box = a.closest('section, article, li') || a.parentElement;
    fromLinks.push({ id, title, url: abs(href), posted: box ? text(box, '[data-test="posted-on"]') : '' });
  }
  return { tiles: fromTiles, links: fromLinks };
})()`;

/** How many tiles are drawn, and how many jobs the page's data says it has. */
const COUNT_JS = `(() => {
  let tiles = 0;
  for (const sel of ${JSON.stringify(TILE_SELECTORS.slice(0, 2))}) tiles = Math.max(tiles, document.querySelectorAll(sel).length);
  let data = 0;
  try {
    const s = window.$nuxt && window.$nuxt.$store && window.$nuxt.$store.state;
    for (const k of Object.keys(s || {})) if (s[k] && Array.isArray(s[k].jobs)) data = Math.max(data, s[k].jobs.length);
  } catch (e) {}
  return { tiles, data };
})()`;

/** "$14.97" → "$15", "$640" → "$600+", "$20,480" → "$20K+" — the tile's own wording. */
function formatSpent(amount: number): string {
  if (amount >= 1_000_000) return `$${Math.floor(amount / 1_000_000)}M+`;
  if (amount >= 1_000) return `$${Math.floor(amount / 1_000)}K+`;
  if (amount >= 100) return `$${Math.floor(amount / 100) * 100}+`;
  return `$${Math.round(amount)}`;
}

/** A store row in the same shape, and the same wording, a tile would give. */
function storeJobToUpworkJob(s: StoreJob): UpworkJob {
  const id = upworkJobId(s.ciphertext);
  // Upwork: type 1 is fixed-price, 2 is hourly.
  const hourly = s.type === 2;
  const range =
    s.hourlyMin || s.hourlyMax
      ? `: $${s.hourlyMin ?? 0}${s.hourlyMax && s.hourlyMax !== s.hourlyMin ? `-$${s.hourlyMax}` : ''}`
      : '';
  return {
    id,
    title: s.title,
    url: s.ciphertext ? `https://www.upwork.com/jobs/${s.ciphertext}` : '',
    description: s.description,
    rate: hourly ? `Hourly${range}` : s.type === 1 ? 'Fixed-price' : '',
    estimatedBudget: !hourly && s.amount ? `$${s.amount}` : '',
    proposals: s.proposalsTier,
    posted: '',
    postedAt: s.publishedOn || undefined,
    clientMoneySpent: s.clientSpent !== null ? formatSpent(s.clientSpent) : '',
    paymentVerified:
      s.paymentVerified === null ? '' : s.paymentVerified === 1 ? 'Payment verified' : 'Payment unverified',
    clientCountry: s.clientCountry,
    clientRating: s.clientReviews && s.clientFeedback !== null ? s.clientFeedback.toFixed(1) : '',
    clientHireRate: '',
    skills: s.skills.slice(0, 8),
  };
}

/** Prefer `a` where it has something to say, `b` otherwise. */
function mergeJob(a: Partial<UpworkJob>, b: UpworkJob): UpworkJob {
  const out = { ...b };
  for (const [key, value] of Object.entries(a) as [keyof UpworkJob, unknown][]) {
    const has = Array.isArray(value) ? value.length > 0 : typeof value === 'string' ? value !== '' : value != null;
    if (has) (out as Record<string, unknown>)[key] = value;
  }
  return out;
}

const STABLE_POLL_MS = 500;
const STABLE_MAX_MS = 12_000;

/**
 * Give the tiles a moment to draw.
 *
 * Upwork draws tiles lazily, roughly as they come into view, so in a short
 * window only the first two or three ever exist. Reading tiles alone once cost
 * a job this way: the watcher saw two of ten and reported "2 jobs on the feed"
 * for hours. The page data is what covers that now; this only waits for the
 * tile count to catch up with it, or to stop changing for a few seconds.
 */
async function waitForTilesToSettle(page: Page): Promise<void> {
  const deadline = Date.now() + STABLE_MAX_MS;
  let last = -1;
  let steady = 0;
  while (Date.now() < deadline) {
    const { tiles, data } = (await page.evaluate(COUNT_JS).catch(() => ({ tiles: 0, data: 0 }))) as {
      tiles: number;
      data: number;
    };
    if (data > 0 && tiles >= data) return;
    steady = tiles === last && tiles > 0 ? steady + 1 : 0;
    last = tiles;
    if (steady >= 6) return;
    await sleep(STABLE_POLL_MS);
  }
}

/**
 * Read every job the feed has loaded. Never loads more.
 *
 * Merged by job id: the tile's URL and wording win (the app has always stored
 * those, and the dedupe hash is built from the URL), the page data fills the
 * gaps and supplies the exact publish time. A job only the page data knows
 * about still comes through, with a plain `/jobs/~0…` URL.
 */
export async function readFeed(page: Page, log?: (m: string) => void): Promise<UpworkJob[]> {
  await waitForTilesToSettle(page);

  const store = (await page.evaluate(READ_STORE_JS).catch(() => null)) as
    | { source: string; jobs: StoreJob[] }
    | null;
  const dom = (await page.evaluate(READ_DOM_JS).catch(() => null)) as
    | { tiles: TileJob[]; links: { id: string; title: string; url: string; posted: string }[] }
    | null;

  const storeJobs = (store?.jobs ?? []).map(storeJobToUpworkJob).filter((j) => j.id && j.title);
  const tileJobs = dom?.tiles ?? [];
  const linkJobs = dom?.links ?? [];

  // Page order, newest first: the store's when it has one, else the tiles'.
  const order: string[] = [];
  const byId = new Map<string, UpworkJob>();
  const add = (id: string, job: Partial<UpworkJob>, base?: UpworkJob) => {
    if (!id) return;
    const current = byId.get(id);
    if (!current) order.push(id);
    const empty: UpworkJob = {
      title: '', url: '', description: '', rate: '', estimatedBudget: '', proposals: '', posted: '',
      clientMoneySpent: '', paymentVerified: '', clientCountry: '', clientRating: '', clientHireRate: '',
      skills: [],
    };
    byId.set(id, mergeJob(job, current ?? base ?? empty));
  };

  for (const job of storeJobs) add(job.id as string, job);
  for (const job of tileJobs) add(job.id, job);
  for (const job of linkJobs) add(job.id, job);

  const jobs = order
    .map((id) => ({ ...byId.get(id)!, id }))
    .filter((j) => j.title && j.url);

  if (log) {
    const counts =
      `page data ${storeJobs.length}${store?.source ? ` (${store.source})` : ''}, ` +
      `tiles ${tileJobs.length}, links ${linkJobs.length}`;
    // Disagreement is the early warning that one reader has gone stale.
    if (storeJobs.length !== tileJobs.length || linkJobs.length || !storeJobs.length) {
      log(`feed read ${jobs.length} job(s) — ${counts}`);
    }
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
        page,
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
