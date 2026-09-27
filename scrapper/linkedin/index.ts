import type { Locator, Page } from 'playwright';
import type { RawLead, Scraper, ScrapeContext } from '../../server/src/scrapers/types';
import { devNote, devTrace, noTrace, within, type Trace } from '../lib/debug';
import { allOf, attributeOf, innerTextOf, lines } from '../lib/dom';
import {
  deleteProfile,
  hasProfile,
  openProfile,
  waitForSignIn,
  type BrowserSession,
} from '../lib/profile';
import { loadLinkedInRuntimeConfig } from './config';

const PLATFORM = 'linkedin' as const;
const ORIGIN = 'https://www.linkedin.com';
const FEED_URL = `${ORIGIN}/feed/`;
const SIGN_IN_URL = `${ORIGIN}/login`;

/**
 * LinkedIn — two halves, collected two different ways.
 *
 *  - **Posts** are scraped, like X. Each cycle types every keyword into
 *    LinkedIn's search bar, the way a person would, and reads the post
 *    results latest first. That is this file's `scrape`.
 *  - **Jobs** are watched, like Upwork: one tab left on your saved job search,
 *    reloaded now and then, new postings announced after a random pause. That
 *    is ./watch.ts, and the scrape cycle never touches job search.
 *
 * Both need a signed-in session, and both read the page the way it is drawn.
 * LinkedIn's markup is hashed class names that change with every deploy, so
 * nothing here selects on a class: posts and job cards are found by the
 * `componentkey` and `data-testid` attributes the app itself relies on, and
 * read by structure.
 *
 * A post's permalink is not on the page as a link. It is in the key of the
 * post's comment box — a base64 protobuf holding the post's id — which is also
 * where the exact publish time comes from, because LinkedIn ids start with a
 * timestamp. See `decodePostKey`.
 */

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const humanDelay = (low: number, high: number) => sleep((low + Math.random() * (high - low)) * 1000);

// ── Pages and sessions ────────────────────────────────────────

export const isLinkedInUrl = (url: string): boolean => {
  try {
    return /(^|\.)linkedin\.com$/i.test(new URL(url).hostname);
  } catch {
    return false;
  }
};

/** Where LinkedIn sends a visitor who is not signed in. */
const SIGNED_OUT_URL = /linkedin\.com\/(login|authwall|uas\/login|signup|start\/join|checkpoint\/lg\/)/i;

/** Where it sends a session it wants to verify — a person has to clear it. */
const CHALLENGE_URL = /linkedin\.com\/checkpoint\/(challenge|challengesV2)/i;

export function looksSignedOut(page: Page): boolean {
  return SIGNED_OUT_URL.test(page.url());
}

export async function looksLikeChallenge(page: Page): Promise<boolean> {
  if (CHALLENGE_URL.test(page.url())) return true;
  const title = (await page.title().catch(() => '')).toLowerCase();
  return title.includes('security verification') || title.includes('security check');
}

/**
 * Wait for a person to clear a security check in the visible window. Polls the
 * URL: LinkedIn sends you back to where you were going once it is done.
 */
export async function waitForChallengeCleared(
  page: Page,
  log: (m: string) => void,
  timeoutMs: number,
): Promise<boolean> {
  const minutes = Math.round(timeoutMs / 60_000);
  log(`LinkedIn wants a security check — clear it in the browser window (waiting up to ${minutes} minute(s))`);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await sleep(3_000);
    if (page.isClosed()) return false;
    if (!(await looksLikeChallenge(page))) {
      log('security check cleared — resuming');
      await sleep(2_000);
      return true;
    }
  }
  log('nobody cleared the security check in time — giving up for now');
  return false;
}

/** Wait for navigation to actually finish. LinkedIn redirects a lot. */
export async function settle(page: Page): Promise<void> {
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);
  await sleep(1500);
}

/** LinkedIn sets `li_at` when a login succeeds, and only then. */
async function hasAuthCookie(page: Page): Promise<boolean> {
  const cookies = await page.context().cookies(ORIGIN);
  return cookies.some((cookie) => cookie.name === 'li_at' && cookie.value !== '');
}

/**
 * Load the feed and report whether we were allowed to stay on it.
 *
 * The only check that proves a session works: a stale `li_at` cookie survives
 * long after LinkedIn has stopped honouring it, and it bounces you to the
 * login page the moment you ask for anything.
 */
async function confirmSignedIn(page: Page): Promise<boolean> {
  await page.goto(FEED_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await sleep(2000);
  if (looksSignedOut(page)) return false;
  return /linkedin\.com\/feed/i.test(page.url()) && (await hasAuthCookie(page));
}

// ── Posts ─────────────────────────────────────────────────────

export interface LinkedInPost {
  /** The numeric id out of the post's urn. */
  id: string;
  /** `activity` or `ugcPost` — which urn the id belongs to. */
  kind: 'activity' | 'ugcPost';
  text: string;
  authorName: string;
  authorUrl: string;
  /** From the id, to the millisecond. */
  postedAt: string;
}

/**
 * Turn a post's comment-box key into its urn and publish time.
 *
 * The key is `CgsI…` or `EgsI…`: base64 of a protobuf whose outer field says
 * which kind of urn it is (1 = activity, 2 = ugcPost) and whose inner field 1
 * is the id, zigzag-encoded. LinkedIn ids carry their creation time in the top
 * 41 bits, in milliseconds since the epoch — the same scheme as a tweet id.
 */
export function decodePostKey(key: string): { kind: LinkedInPost['kind']; id: string; postedAt: string } | null {
  let buf: Buffer;
  try {
    buf = Buffer.from(key.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  } catch {
    return null;
  }
  if (buf.length < 4 || buf[2] !== 0x08) return null;

  const field = buf[0] >> 3;
  const kind = field === 1 ? 'activity' : field === 2 ? 'ugcPost' : null;
  if (!kind) return null;

  let raw = 0n;
  let shift = 0n;
  for (let i = 3; i < buf.length; i += 1) {
    const byte = BigInt(buf[i]);
    raw |= (byte & 0x7fn) << shift;
    shift += 7n;
    if (!(byte & 0x80n)) break;
  }
  const id = (raw >> 1n) ^ -(raw & 1n);
  if (id <= 0n) return null;

  const ms = Number(id >> 22n);
  const posted = new Date(ms);
  // Anything outside LinkedIn's lifetime means this was not an id after all.
  if (!Number.isFinite(ms) || posted.getUTCFullYear() < 2010 || ms > Date.now() + 86_400_000) return null;

  return { kind, id: id.toString(), postedAt: posted.toISOString() };
}

export const postUrl = (post: Pick<LinkedInPost, 'kind' | 'id'>): string =>
  `${ORIGIN}/feed/update/urn:li:${post.kind}:${post.id}/`;

const POST_CARD = '[role="listitem"][componentkey^="update-card-focus"]';
const COMMENT_BOX = '[componentkey*="-replaceableCommentTools"]';
const AUTHOR_LINK = 'a[href*="/in/"], a[href*="/company/"]';

interface DrawnPost {
  key: string;
  text: string;
  author: string;
  authorUrl: string;
}

/**
 * Comment-box keys by the hash they share with their post's card. The key is
 * `<base64 post key>-replaceableCommentTools<hash>FeedType_…`; see
 * `decodePostKey` for what the base64 part holds.
 */
async function commentBoxKeys(page: Page, trace: Trace): Promise<Map<string, string>> {
  const keys = new Map<string, string>();
  for (const box of await allOf(page.locator(COMMENT_BOX), 'comment boxes', trace)) {
    const ck = (await attributeOf(box, 'componentkey', 'comment box key', trace)) ?? '';
    const m = ck.match(/^([A-Za-z0-9+/_=-]+?)-replaceableCommentTools(.+?)FeedType_/);
    if (m) keys.set(m[2], m[1]);
  }
  return keys;
}

/** `update-card-focus<hash>FeedType_…` → `<hash>`. */
async function cardHash(card: Locator, trace: Trace): Promise<string> {
  const ck = (await attributeOf(card, 'componentkey', 'componentkey', trace)) ?? '';
  return ck.replace(/^update-card-focus/, '').replace(/FeedType_.*$/, '');
}

/** The first author or company link with a name on it, as an absolute URL without its query. */
async function postAuthor(page: Page, card: Locator, trace: Trace): Promise<{ author: string; authorUrl: string }> {
  for (const a of await allOf(card.locator(AUTHOR_LINK), 'author links', trace)) {
    const name = lines(await innerTextOf(a, 'author name', trace))[0] ?? '';
    if (!name) continue;
    const href = (await attributeOf(a, 'href', 'author href', trace)) ?? '';
    let authorUrl = '';
    try {
      authorUrl = new URL(href, page.url()).href.split('?')[0];
    } catch (err) {
      trace('author url', err);
    }
    return { author: name, authorUrl };
  }
  return { author: '', authorUrl: '' };
}

/** Every post currently drawn, feed or search results — they share one card. */
async function readDrawnPosts(page: Page, trace: Trace): Promise<DrawnPost[]> {
  const keys = await commentBoxKeys(page, trace);
  const out: DrawnPost[] = [];
  for (const [i, card] of (await allOf(page.locator(POST_CARD), 'post cards', trace)).entries()) {
    const t = within(trace, `post #${i}`);
    const hash = await cardHash(card, t);
    const text = (await innerTextOf(card.locator('[data-testid="expandable-text-box"]'), 'text', t)).trim();
    out.push({ key: keys.get(hash) || '', text, ...(await postAuthor(page, card, t)) });
  }
  return out;
}

/** Read the posts on screen. Posts with no readable id have no link, so they are skipped. */
async function readPosts(page: Page, trace: Trace = noTrace): Promise<LinkedInPost[]> {
  const drawn = await readDrawnPosts(page, trace);
  const posts: LinkedInPost[] = [];
  for (const d of drawn) {
    if (!d.text) continue;
    const decoded = d.key ? decodePostKey(d.key) : null;
    if (!decoded) continue;
    posts.push({
      ...decoded,
      // "…see more" is the expand button's label, not the author's words.
      text: d.text.replace(/\s*…\s*(see )?more\s*$/i, '').trim(),
      authorName: d.author.replace(/\s+/g, ' ').trim(),
      authorUrl: d.authorUrl,
    });
  }
  return posts;
}

const HASHTAG_RE = /#([\p{L}\p{N}_]+)/gu;

/** Map a post into the server's platform-agnostic RawLead shape. */
export function postToLead(post: LinkedInPost): RawLead {
  const text = post.text.replace(/\s+/g, ' ').trim();
  // By code point, not UTF-16 unit, so an emoji is never cut in half.
  const points = Array.from(text);
  const title = text
    ? points.slice(0, 100).join('') + (points.length > 100 ? '…' : '')
    : `Post by ${post.authorName || 'a LinkedIn member'}`;
  const tags = [...new Set(Array.from(post.text.matchAll(HASHTAG_RE), (m) => m[1]))].slice(0, 6);

  return {
    title,
    platform: PLATFORM,
    description: post.text,
    url: postUrl(post),
    author: post.authorName || null,
    tags,
    metadata: {
      kind: 'post',
      ...(post.authorUrl ? { authorProfile: post.authorUrl } : {}),
    },
    postedAt: post.postedAt,
  };
}

/**
 * What to search for one keyword. A phrase is quoted so LinkedIn matches it as
 * a phrase — "looking for a developer" unquoted matches any post with those
 * four words anywhere — unless you already quoted it or wrote your own AND / OR.
 */
export function searchQuery(keyword: string): string {
  const k = keyword.trim();
  const hasSyntax = /["()]|\b(AND|OR|NOT)\b/.test(k);
  return !hasSyntax && /\s/.test(k) ? `"${k}"` : k;
}

/** Post results for one keyword, latest first. */
export function searchUrl(keyword: string, origin?: string): string {
  return (
    `${ORIGIN}/search/results/content/?keywords=${encodeURIComponent(searchQuery(keyword))}` +
    `&sortBy=${encodeURIComponent('"date_posted"')}` +
    (origin ? `&origin=${encodeURIComponent(origin)}` : '')
  );
}

/**
 * What makes two posts the same post, in words: who wrote it and what it says.
 *
 * The id alone is not enough. One post can be drawn as `urn:li:activity:…` in
 * one result and `urn:li:ugcPost:…` in another — two different numbers — and a
 * reposted post is a new card with a new id around the same text.
 */
export function postContentKey(post: Pick<LinkedInPost, 'authorName' | 'text'>): string {
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
  return `${norm(post.authorName)}::${norm(post.text)}`;
}

interface PostScrapeOptions {
  cutoff: Date | null;
  limit: number;
  maxScrolls: number;
  /**
   * Ids and content keys of posts already taken this cycle, shared across
   * keywords, so a post found for one keyword is not taken again for the next
   * — nor counted against that keyword's limit.
   */
  seen: Set<string>;
  log: (m: string) => void;
}

/**
 * Collect posts from the search results in front of us, scrolling a screen at
 * a time. Scrolling is what loads more — there is no "next page" to request.
 */
async function collectPosts(page: Page, opts: PostScrapeOptions): Promise<LinkedInPost[]> {
  const found: LinkedInPost[] = [];
  const { seen } = opts;
  const trace = devTrace(opts.log, 'LinkedIn posts');
  const note = devNote(opts.log, 'LinkedIn posts');

  for (let scroll = 0; scroll <= opts.maxScrolls && found.length < opts.limit; scroll += 1) {
    const posts = await readPosts(page, within(trace, `collectPosts › screen ${scroll}`));
    if (!posts.length) note(`collectPosts › screen ${scroll}: no readable posts on ${page.url()}`);
    for (const post of posts) {
      const contentKey = postContentKey(post);
      if (seen.has(post.id) || seen.has(contentKey)) continue;
      seen.add(post.id);
      seen.add(contentKey);
      if (opts.cutoff && new Date(post.postedAt) < opts.cutoff) continue;
      found.push(post);
      if (found.length >= opts.limit) break;
    }
    if (found.length >= opts.limit || scroll === opts.maxScrolls) break;
    await page
      .evaluate('window.scrollBy(0, window.innerHeight * 1.6)')
      .catch((err) => trace(`collectPosts › scroll ${scroll}`, err));
    await humanDelay(1.8, 3.8);
  }
  return found;
}

/**
 * Is the page in front of us one we can read — signed in, and not held at a
 * security check? Returns false (having said why) when it is not.
 */
async function pageIsUsable(page: Page, ctx: ScrapeContext): Promise<boolean> {
  if (looksSignedOut(page)) {
    throw new Error('Your LinkedIn session has expired — sign in again on the Connections page.');
  }
  if (await looksLikeChallenge(page)) {
    if (!ctx.interactive) {
      ctx.log('LinkedIn is showing a security check and nobody is set to clear it');
      return false;
    }
    if (!(await waitForChallengeCleared(page, ctx.log, ctx.captchaTimeoutMs))) return false;
  }
  return true;
}

/**
 * The search box in LinkedIn's top bar. Found by what it is — a combobox
 * labelled or hinted "Search" — never by its hashed class.
 */
const SEARCH_BAR = [
  'input[role="combobox"][placeholder*="Search" i]',
  'input[role="combobox"][aria-label*="Search" i]',
  'input[type="search"]',
  'input[placeholder="Search" i]',
].join(', ');

/**
 * Type a search into the top bar and press Enter, the way a person searches.
 *
 * On a narrow window LinkedIn folds the bar behind a magnifier button, so if
 * no bar is showing that button is clicked first. Returns false when there is
 * no bar to type into, or the search went nowhere.
 */
async function typeIntoSearchBar(page: Page, query: string, trace: Trace): Promise<boolean> {
  try {
    const bar = page.locator(SEARCH_BAR).first();
    if (!(await bar.isVisible())) {
      await page
        .getByRole('button', { name: /^search$/i })
        .first()
        .click({ timeout: 3_000 })
        .catch((err) => trace('typeIntoSearchBar › open folded search', err));
    }
    await bar.click({ timeout: 5_000 });
    await bar.fill('');
    await bar.pressSequentially(query, { delay: 60 + Math.random() * 90 });
    await humanDelay(0.4, 1.2);
    await bar.press('Enter');
    await page.waitForURL(/\/search\/results\//, { timeout: 20_000 });
    return true;
  } catch (err) {
    trace('typeIntoSearchBar', err);
    return false;
  }
}

/**
 * Search posts for one keyword through the search bar, and land on its post
 * results, latest first.
 *
 * The bar lands on "All" results in LinkedIn's own order. Narrowing those to
 * posts sorted by date goes through the results URL rather than the filter
 * pills — the URL is the stable interface, the pills are hashed markup — but
 * the search itself went through the bar, as a person's would. With no bar to
 * type into, the results URL is opened directly.
 */
async function searchPosts(page: Page, keyword: string, ctx: ScrapeContext): Promise<boolean> {
  const trace = devTrace(ctx.log, 'LinkedIn search');

  if (await typeIntoSearchBar(page, searchQuery(keyword), trace)) {
    await settle(page);
    if (!(await pageIsUsable(page, ctx))) return false;
    const origin = new URL(page.url()).searchParams.get('origin') ?? undefined;
    await humanDelay(1, 2.5);
    await page.goto(searchUrl(keyword, origin), { waitUntil: 'domcontentloaded', timeout: 45_000 });
  } else {
    ctx.log("could not find LinkedIn's search bar — opening the search results directly");
    await page.goto(searchUrl(keyword), { waitUntil: 'domcontentloaded', timeout: 45_000 });
  }
  await settle(page);
  if (!(await pageIsUsable(page, ctx))) return false;

  try {
    await page.waitForSelector(POST_CARD, { timeout: 20_000 });
    return true;
  } catch (err) {
    trace(`searchPosts › waiting for posts at ${page.url()}`, err);
    ctx.log(`no posts rendered for "${keyword}" — nothing recent, or LinkedIn changed its layout`);
    return false;
  }
}

export const linkedinScraper: Scraper = {
  platform: PLATFORM,
  name: 'LinkedIn',

  /**
   * Posts are collected by the cycle. Jobs are not, and cannot be from here:
   * nothing in `scrape` opens job search. See ./watch.ts for those.
   */
  mode: 'scrape',

  async checkSession(log) {
    if (!hasProfile(PLATFORM)) return { hasProfile: false, signedIn: false };

    const runtime = loadLinkedInRuntimeConfig();
    const session = await openProfile(PLATFORM, { headless: true, userAgent: runtime.userAgent });
    try {
      const page = await session.page();
      const signedIn = await confirmSignedIn(page);
      if (!signedIn) log('the saved LinkedIn session has expired — sign in again');
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
    const runtime = loadLinkedInRuntimeConfig();
    // Always visible: the entire point is that a person signs in by hand.
    const session = await openProfile(PLATFORM, { headless: false, userAgent: runtime.userAgent });
    if (session.attached) {
      log('signing in inside the Chrome you started — look for the new tab');
    }
    try {
      const page = await session.page();
      await page.goto(SIGN_IN_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      return await waitForSignIn(
        session,
        page,
        // Already signed in, LinkedIn skips the form and lands on the feed.
        async () => /linkedin\.com\/feed/i.test(page.url()) || (await hasAuthCookie(page)),
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
      ctx.log('not signed in to LinkedIn — connect it on the Connections page first');
      return [];
    }

    const { config } = ctx;
    const keywords = config.keywords;
    if (!keywords.length) {
      ctx.log('no keywords set — add some on the Config page');
      return [];
    }

    // The newer of your max post age and whatever the server asks for.
    const cutoffs = [
      config.maxPostAgeHours > 0 ? new Date(Date.now() - config.maxPostAgeHours * 3_600_000) : null,
      ctx.since ?? null,
    ].filter((d): d is Date => d !== null);
    const cutoff = cutoffs.length ? new Date(Math.max(...cutoffs.map((d) => d.getTime()))) : null;

    const runtime = loadLinkedInRuntimeConfig();
    let session: BrowserSession | null = null;
    const posts = new Map<string, LinkedInPost>();
    const seen = new Set<string>();

    try {
      session = await openProfile(PLATFORM, { headless: runtime.headless, userAgent: runtime.userAgent });
      ctx.log(session.attached ? 'attached to your Chrome' : `browser started (headless=${runtime.headless})`);
      const page = await session.page();

      // Somewhere with LinkedIn's top bar on it, to search from.
      if (!isLinkedInUrl(page.url()) || looksSignedOut(page)) {
        await page.goto(FEED_URL, { waitUntil: 'domcontentloaded', timeout: 45_000 });
        await settle(page);
      }
      if (await pageIsUsable(page, ctx)) {
        for (const keyword of keywords) {
          const remaining = ctx.limit - posts.size;
          if (remaining <= 0) break;
          ctx.log(`searching posts: "${keyword}"`);
          if (!(await searchPosts(page, keyword, ctx))) continue;
          const found = await collectPosts(page, {
            cutoff,
            limit: Math.min(config.linkedinLimitPerKeyword, remaining),
            // Results come newest first, so a few screens reach the cutoff.
            maxScrolls: Math.ceil(config.linkedinLimitPerKeyword / 3) + 2,
            seen,
            log: ctx.log,
          });
          for (const post of found) posts.set(post.id, post);
          ctx.log(`${found.length} new post(s) for "${keyword}"`);
          await humanDelay(3, 7);
        }
      }
    } finally {
      await session?.release();
    }

    ctx.log(`total posts matching your keywords: ${posts.size}`);
    return [...posts.values()].map(postToLead);
  },
};

export default linkedinScraper;
