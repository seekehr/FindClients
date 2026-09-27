import type { BrowserContext, Locator, Page } from 'playwright';
import type {
  LeadMetadata,
  PlatformWatcher,
  RawLead,
  WatchResult,
  WatchTab,
  WatchTabOptions,
} from '../../server/src/scrapers/types';
import { devNote, devTrace, noTrace, within, type Trace } from '../lib/debug';
import {
  allOf,
  allTextContentsOf,
  attributeOf,
  clean,
  countOf,
  firstOf,
  innerTextOf,
  lines,
  textContentOf,
} from '../lib/dom';
import { openProfile, type BrowserSession } from '../lib/profile';
import { loadLinkedInRuntimeConfig } from './config';
import {
  isLinkedInUrl,
  looksLikeChallenge,
  looksSignedOut,
  settle,
  sleep,
  waitForChallengeCleared,
} from './index';

/**
 * The LinkedIn jobs tab you leave open.
 *
 * The same idea as the Upwork watcher, on LinkedIn's job search: sit on the
 * search you saved, reload that one page every few minutes, read the job cards
 * on the screen. The pacing lives in ../../server/src/watcher/, shared with
 * Upwork.
 *
 * What it will not do:
 *
 *  - It never pages. The first page of results is what a person sees when they
 *    glance at a search, and walking pages 2, 3, 4… on a timer is exactly the
 *    crawl LinkedIn restricts accounts for. Keep the search narrow — a job
 *    title, "Past 24 hours" — and the first page is all there is anyway.
 *  - It never navigates to a job. `inspect` clicks the job in the list, which
 *    opens it in the pane beside the list, and reads it there — the same click
 *    you would make, on the page already open.
 *  - It never adopts a LinkedIn tab that is not a job search. Attached to your
 *    own Chrome, the tab you are messaging someone in is not ours to reload.
 */

/** How long to let the results settle after a reload before reading them. */
const AFTER_RELOAD_MS = 2_000;

/** Job search pages, under both the 2026 name and the older one. */
const JOB_SEARCH_PATH = /^\/jobs\/(search-results|search|collections)(\/|$)/i;

/**
 * Query parameters LinkedIn adds or rewrites as you use the page, and that do
 * not change which jobs the search returns. Everything else is the search.
 */
const NOISE_PARAMS = new Set([
  'currentjobid',
  'origin',
  'referralsearchid',
  'refid',
  'trackingid',
  'trk',
  'lipi',
  'ebp',
  'sortby',
  'start',
]);

function searchKey(url: string): string {
  try {
    const u = new URL(url);
    const params = [...u.searchParams.entries()]
      .filter(([k]) => !NOISE_PARAMS.has(k.toLowerCase()))
      .map(([k, v]) => `${k.toLowerCase()}=${v.trim().toLowerCase()}`)
      .sort();
    return `${u.pathname.replace(/\/+$/, '').toLowerCase()}?${params.join('&')}`;
  } catch {
    return '';
  }
}

export const isJobSearchUrl = (url: string): boolean => {
  try {
    return isLinkedInUrl(url) && JOB_SEARCH_PATH.test(new URL(url).pathname);
  } catch {
    return false;
  }
};

/**
 * Is this tab showing the search we were asked to watch?
 *
 * By the search itself rather than the whole URL: LinkedIn writes
 * `currentJobId` into the address as soon as a job is selected, so an exact
 * match would send the tab navigating on every poll instead of reloading.
 */
export function onFeedPage(current: string, feedUrl: string): boolean {
  return isJobSearchUrl(current) && searchKey(current) === searchKey(feedUrl);
}

/**
 * The tab to work in: one already on this search, else any job search. Never
 * any other LinkedIn tab — that is you, using LinkedIn.
 */
export function findJobsPage(context: BrowserContext, feedUrl: string): Page | null {
  const open = context.pages().filter((p) => !p.isClosed() && isJobSearchUrl(p.url()));
  return open.find((p) => onFeedPage(p.url(), feedUrl)) ?? open[0] ?? null;
}

// ── Reading the results ───────────────────────────────────────

export interface LinkedInJob {
  id: string;
  title: string;
  company: string;
  location: string;
  /** "Posted 21 hours ago", as the card says it. */
  posted: string;
  /** Pay, when the card shows it. */
  salary: string;
  easyApply: boolean;
  promoted: boolean;
}

/**
 * Every job card drawn on the page is read two ways and merged by job id:
 *
 *  1. The 2026 search page. Cards are `componentkey="job-card-component-ref-<id>"`
 *     with hashed classes, so they are read by structure: the title is in the
 *     "Dismiss … job" button's label, then company and location follow it.
 *  2. The older `/jobs/search/` page, whose cards carry `data-occludable-job-id`.
 *
 * Plus, when neither recognised a single card, any bare `/jobs/view/<id>` link.
 */
const NEW_CARD = '[componentkey^="job-card-component-ref-"]';
const OLD_CARD = '[data-occludable-job-id], [data-job-id]';
const JOB_LINK = 'a[href*="/jobs/view/"]';

/**
 * A new-layout card's lines, in order. A <p> reads as its first <span> when it
 * has one — the page puts the visible text and a screen-reader copy side by
 * side in the same line — and lines inside a button (Dismiss, Save) are not
 * the card's.
 */
const NEW_CARD_LINES = 'p:not(button p):not(:has(> span)), p:not(button p) > span:first-of-type';

const isPay = (t: string) => /[$€£₹]|\/(hr|yr|mo)\b|per (hour|year|month)/i.test(t);
const isPosted = (t: string) => /^(re)?posted\b|\bago$|^just now$/i.test(t);
const isSeparator = (t: string) => /^[·•|]$/.test(t);

/** The first non-empty line of an element's drawn text, whitespace collapsed. */
async function firstLineOf(loc: Locator, where: string, trace: Trace): Promise<string> {
  return lines(await innerTextOf(loc, where, trace)).map(clean).find(Boolean) ?? '';
}

/** Collects jobs in page order, keeping the first card read for each job id. */
class JobList {
  private readonly seen = new Set<string>();
  readonly jobs: LinkedInJob[] = [];

  add(job: LinkedInJob): void {
    if (!job.id || !job.title || this.seen.has(job.id)) return;
    this.seen.add(job.id);
    this.jobs.push(job);
  }
}

/**
 * Title, company, location and the rest out of a new-layout card's lines. The
 * Dismiss button's label is the reliable title; the lines after it are company
 * then location, and everything past those is badges and footer.
 */
function jobFromCardLines(id: string, dismissTitle: string, texts: string[]): LinkedInJob {
  const title = clean(dismissTitle) || texts[0] || '';
  const at = Math.max(0, texts.indexOf(title));
  const rest = texts.slice(at + 3);
  return {
    id,
    title,
    company: texts[at + 1] || '',
    location: texts[at + 2] || '',
    posted: rest.find(isPosted) || '',
    salary: rest.find(isPay) || '',
    easyApply: rest.some((t) => /easy apply/i.test(t)),
    promoted: rest.some((t) => /^promoted/i.test(t)),
  };
}

/** The job id at the end of a new-layout card's `componentkey`. */
async function newCardId(card: Locator, trace: Trace): Promise<string> {
  const key = (await attributeOf(card, 'componentkey', 'componentkey', trace)) ?? '';
  return key.match(/(\d{6,})$/)?.[1] ?? '';
}

/** "Dismiss Senior Developer job" → "Senior Developer". */
async function dismissTitle(card: Locator, trace: Trace): Promise<string> {
  const label = await attributeOf(
    card.locator('button[aria-label^="Dismiss "]'),
    'aria-label',
    'dismiss button',
    trace,
  );
  return label?.match(/^Dismiss (.+) job$/)?.[1] ?? '';
}

async function newCardLines(card: Locator, trace: Trace): Promise<string[]> {
  const texts = await allTextContentsOf(card.locator(NEW_CARD_LINES), 'lines', trace);
  return texts.map(clean).filter((t) => t && !isSeparator(t));
}

async function readNewCard(card: Locator, trace: Trace): Promise<LinkedInJob> {
  const id = await newCardId(card, trace);
  const t = within(trace, `card ${id || '?'}`);
  return jobFromCardLines(id, await dismissTitle(card, t), await newCardLines(card, t));
}

async function oldCardId(card: Locator, trace: Trace): Promise<string> {
  return (
    (await attributeOf(card, 'data-occludable-job-id', 'data-occludable-job-id', trace)) ||
    (await attributeOf(card, 'data-job-id', 'data-job-id', trace)) ||
    ''
  );
}

/** The card's `<time>`: its machine-readable date when it has one, else its words. */
async function oldCardPosted(card: Locator, trace: Trace): Promise<string> {
  const time = await firstOf(card.locator('time'), 'time', trace);
  if (!time) return '';
  return (await attributeOf(time, 'datetime', 'time@datetime', trace)) || clean(await textContentOf(time, 'time', trace));
}

async function readOldCard(card: Locator, trace: Trace): Promise<LinkedInJob> {
  const id = await oldCardId(card, trace);
  const t = within(trace, `card ${id || '?'}`);
  const meta = (await allTextContentsOf(card.locator('li'), 'meta', t)).map(clean);
  const whole = await textContentOf(card, 'card text', t);
  return {
    id,
    title: await firstLineOf(card.locator(JOB_LINK), 'title link', t),
    company: await firstLineOf(card.locator('.artdeco-entity-lockup__subtitle'), 'company', t),
    location: await firstLineOf(card.locator('.artdeco-entity-lockup__caption'), 'location', t),
    posted: await oldCardPosted(card, t),
    salary: meta.find(isPay) || '',
    easyApply: /easy apply/i.test(whole),
    promoted: /\bpromoted\b/i.test(whole),
  };
}

/** A bare `/jobs/view/<id>` link, as a job with only a title. */
async function readJobLink(link: Locator, trace: Trace): Promise<LinkedInJob> {
  const href = (await attributeOf(link, 'href', 'href', trace)) ?? '';
  const id = href.match(/\/jobs\/view\/(\d+)/)?.[1] ?? '';
  return {
    id,
    title: await firstLineOf(link, `link ${id || '?'}`, trace),
    company: '',
    location: '',
    posted: '',
    salary: '',
    easyApply: false,
    promoted: false,
  };
}

/** Read every card on the page, under both layouts, merged by job id. */
export async function readJobs(
  page: Page,
  trace: Trace = noTrace,
  note: (m: string) => void = () => undefined,
): Promise<LinkedInJob[]> {
  const list = new JobList();

  const newCards = await allOf(page.locator(NEW_CARD), 'new-layout cards', trace);
  for (const [i, card] of newCards.entries()) {
    list.add(await readNewCard(card, within(trace, `new layout #${i}`)));
  }
  const fromNew = list.jobs.length;

  const oldCards = await allOf(page.locator(OLD_CARD), 'old-layout cards', trace);
  for (const [i, card] of oldCards.entries()) {
    list.add(await readOldCard(card, within(trace, `old layout #${i}`)));
  }
  note(
    `read ${fromNew} job(s) from ${newCards.length} new-layout card(s), ` +
      `${list.jobs.length - fromNew} more from ${oldCards.length} old-layout card(s)`,
  );

  // Only when no card was recognised at all: the details pane links to
  // "similar jobs" that are not part of your search.
  if (list.jobs.length) return list.jobs;
  const links = await allOf(page.locator(JOB_LINK), 'job links', trace);
  for (const link of links) list.add(await readJobLink(link, within(trace, 'fallback')));
  note(`no cards recognised — ${list.jobs.length} job(s) from ${links.length} bare job link(s)`);
  return list.jobs;
}

/** How many job cards are drawn, under either layout. */
function countCards(page: Page, trace: Trace): Promise<number> {
  return countOf(page.locator('[componentkey^="job-card-component-ref-"], [data-occludable-job-id]'), 'count cards', trace);
}

const UNIT_MS: Record<string, number> = {
  second: 1_000,
  minute: 60_000,
  hour: 3_600_000,
  day: 86_400_000,
  week: 604_800_000,
  month: 2_592_000_000,
};

/** "Posted 21 hours ago" / "Reposted 3 days ago" / "Just now" / an ISO date → a date. */
export function postedDate(text: string): Date | null {
  const t = text.trim().toLowerCase();
  if (!t) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) {
    const d = new Date(t);
    return Number.isFinite(d.getTime()) ? d : null;
  }
  if (/just now|moments ago/.test(t)) return new Date();
  const m = t.match(/(\d+)\s+(second|minute|hour|day|week|month)s?\s+ago/);
  return m ? new Date(Date.now() - Number(m[1]) * UNIT_MS[m[2]]) : null;
}

export const jobUrl = (id: string) => `https://www.linkedin.com/jobs/view/${id}/`;

/** "Lahore (Remote)" → "Remote". */
function workplace(location: string): string {
  return location.match(/\((remote|hybrid|on-site)\)/i)?.[1] ?? '';
}

/** Map a job card into the server's platform-agnostic RawLead shape. */
export function jobToLead(job: LinkedInJob): RawLead {
  const posted = postedDate(job.posted);
  const where = [job.company, job.location].filter(Boolean).join(' · ');
  const tags = [workplace(job.location), job.easyApply ? 'Easy Apply' : ''].filter(Boolean);

  const metadata: LeadMetadata = { kind: 'job', jobId: job.id };
  if (job.company) metadata.company = job.company;
  if (job.location) metadata.location = job.location;
  if (job.easyApply) metadata.easyApply = true;
  if (job.promoted) metadata.promoted = true;

  return {
    title: job.title,
    platform: 'linkedin',
    // Replaced with the job's full description when the details are read.
    description: [where, job.salary].filter(Boolean).join('\n'),
    budget: job.salary || null,
    timeline: null,
    url: jobUrl(job.id),
    author: job.company || null,
    tags,
    metadata,
    postedAt: posted ? posted.toISOString() : undefined,
  };
}

// ── Reading the job open beside the list ──────────────────────

interface JobDetail {
  /** The pane is showing this job. */
  ready: boolean;
  description: string;
  applicants: string;
}

const stripAboutHeading = (text: string) => text.replace(/^\s*About the job\s*/i, '').trim();

/** The 2026 page's "About the job" section for this job, by key and then by id. */
async function aboutTheJob(page: Page, id: string, trace: Trace): Promise<Locator | null> {
  return (
    (await firstOf(page.locator(`[componentkey="JobDetails_AboutTheJob_${id}"]`), 'about (componentkey)', trace)) ??
    (await firstOf(page.locator(`[id="JobDetails_AboutTheJob_${id}"]`), 'about (id)', trace))
  );
}

/** The description inside it: the expandable text box when there is one. */
async function aboutText(about: Locator, trace: Trace): Promise<string> {
  const box = await firstOf(about.locator('[data-testid="expandable-text-box"]'), 'text box', trace);
  return stripAboutHeading(await innerTextOf(box ?? about, 'description', trace));
}

/**
 * The older page: one details pane, showing whichever job is selected — so it
 * only counts when the URL says the selected job is this one.
 */
async function oldPaneText(page: Page, id: string, trace: Trace): Promise<string> {
  let selected: string | null = null;
  try {
    selected = new URL(page.url()).searchParams.get('currentJobId');
  } catch (err) {
    trace('page url', err);
  }
  if (selected !== id) return '';
  return stripAboutHeading(await innerTextOf(page.locator('.jobs-description__content, #job-details'), 'old pane', trace));
}

/** "Over 100 applicants" / "37 applicants", from the block around the job's title link. */
async function applicantsLine(page: Page, id: string, trace: Trace): Promise<string> {
  const link = await firstOf(page.locator(`a[href*="/jobs/view/${id}"]`), 'title link', trace);
  if (!link) return '';
  const top =
    (await firstOf(link.locator('xpath=ancestor::*[@data-component-type="LazyColumn"][1]'), 'lazy column', trace)) ??
    (await firstOf(link.locator('xpath=../../..'), 'title block', trace));
  const text = top ? await innerTextOf(top, 'title block', trace) : '';
  return text.match(/(over\s+)?\d[\d,]*\+?\s+applicants?/i)?.[0].replace(/\s+/g, ' ') ?? '';
}

/**
 * The job currently open in the pane beside the list: its description, and
 * the applicant count from the line under its title.
 */
async function readDetail(page: Page, id: string, trace: Trace): Promise<JobDetail> {
  const about = await aboutTheJob(page, id, trace);
  const description = about ? await aboutText(about, trace) : await oldPaneText(page, id, trace);
  const applicants = await applicantsLine(page, id, trace);
  return { ready: !!about || !!description, description, applicants };
}

// ── The tab ───────────────────────────────────────────────────

class LinkedInJobsTab implements WatchTab {
  private closed = false;

  /** The tab we are working in, once we have settled on one. */
  private page: Page | null = null;

  /** Tabs this class opened, and may therefore close again. */
  private readonly created = new Set<Page>();

  /** Where a swallowed error happened, logged in --dev mode only. */
  private readonly trace: Trace;
  private readonly note: (m: string) => void;

  constructor(
    private readonly session: BrowserSession,
    private readonly opts: WatchTabOptions,
  ) {
    this.trace = devTrace(opts.log, 'LinkedIn jobs');
    this.note = devNote(opts.log, 'LinkedIn jobs');
  }

  isOpen(): boolean {
    if (this.closed) return false;
    const browser = this.session.context.browser();
    return browser ? browser.isConnected() : true;
  }

  /**
   * The jobs tab, resolved fresh every time — you may have closed ours or
   * opened your own since the last look. A tab we opened stays ours wherever it
   * has wandered; a tab we adopted is only ours while it is on a job search.
   */
  private async resolveTab(): Promise<Page> {
    const { context } = this.session;
    const { feedUrl, log } = this.opts;

    if (this.page && !this.page.isClosed()) {
      if (this.created.has(this.page) || isJobSearchUrl(this.page.url())) return this.page;
    }

    const existing = findJobsPage(context, feedUrl);
    if (existing) {
      if (existing !== this.page) log('using the LinkedIn job search already open in this browser');
      this.page = existing;
      return existing;
    }

    log('no LinkedIn job search open — opening one');
    const page = await context.newPage();
    this.created.add(page);
    this.page = page;
    return page;
  }

  /** Put the tab on the search: a reload if it is there, a navigation if not. */
  private async goToFeed(page: Page): Promise<void> {
    const { feedUrl, log } = this.opts;
    const current = page.url();

    if (onFeedPage(current, feedUrl)) {
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 45_000 });
      return;
    }
    if (isJobSearchUrl(current)) log('that tab is on a different job search — sending it to yours');
    await page.goto(feedUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  }

  /** Wait for the job cards to draw, and to stop changing for a moment. */
  private async waitForCards(page: Page): Promise<number> {
    const deadline = Date.now() + 25_000;
    let last = -1;
    let steady = 0;
    while (Date.now() < deadline) {
      const count = await countCards(page, within(this.trace, 'waitForCards'));
      steady = count === last && count > 0 ? steady + 1 : 0;
      last = count;
      if (steady >= 4) return count;
      await sleep(500);
    }
    return Math.max(0, last);
  }

  /** Reload the search and read it. */
  async poll(): Promise<WatchResult> {
    if (!this.isOpen()) return { leads: [], problem: 'closed' };

    let page: Page;
    try {
      page = await this.resolveTab();
      await this.goToFeed(page);
    } catch (err) {
      this.trace('poll › opening the job search', err);
      if (!this.isOpen()) return { leads: [], problem: 'closed' };
      return { leads: [], problem: 'no-feed', detail: (err as Error).message };
    }

    await settle(page);

    // Signed out first: nobody can "solve" a login page.
    if (looksSignedOut(page)) return { leads: [], problem: 'signed-out' };

    if (await looksLikeChallenge(page)) {
      if (!this.opts.interactive) {
        this.opts.log('LinkedIn is showing a security check and nobody is set to clear it');
        return { leads: [], problem: 'challenge' };
      }
      const cleared = await waitForChallengeCleared(page, this.opts.log, this.opts.captchaTimeoutMs);
      if (!cleared) return { leads: [], problem: 'challenge' };
      if (looksSignedOut(page)) return { leads: [], problem: 'signed-out' };
    }

    const landed = page.url();
    if (!isJobSearchUrl(landed)) {
      this.note(`poll › landed on ${landed}, which is not a job search`);
      let where = landed;
      try {
        where = new URL(landed).pathname;
      } catch {
        /* keep the raw URL */
      }
      return {
        leads: [],
        problem: 'no-feed',
        detail:
          `LinkedIn sent that tab to ${where} instead of your job search. ` +
          'Check the job search URL on the Config page.',
      };
    }

    const drawn = await this.waitForCards(page);
    await sleep(AFTER_RELOAD_MS);

    const jobs = await readJobs(page, within(this.trace, 'poll › readJobs'), this.note);
    if (!jobs.length) {
      this.note(`poll › no jobs read (${drawn} card(s) counted while waiting)`);
      // A search can genuinely have no results in the past 24 hours. It says so.
      const body = await innerTextOf(page.locator('main'), 'poll › main', this.trace);
      if (/no matching jobs|no results|0 results/i.test(body)) return { leads: [] };
      return {
        leads: [],
        problem: 'no-feed',
        detail:
          drawn > 0
            ? 'Your job search loaded but no jobs could be read from it. LinkedIn may have changed its job-card markup.'
            : 'Your job search did not show any job cards. LinkedIn may have changed the page — check that tab in Chrome.',
      };
    }

    const warning = !onFeedPage(landed, this.opts.feedUrl)
      ? 'LinkedIn changed your job search when it loaded (a filter or keyword was rewritten). ' +
        'Reading the page it showed; open it in Chrome and copy its URL to the Config page to make this go away.'
      : undefined;

    return { leads: jobs.map(jobToLead), warning };
  }

  /**
   * Click one job in the list and read it in the pane beside the list: the
   * full description and the applicant count. No navigation — this is the
   * click a person makes on the page already open.
   */
  async inspect(url: string): Promise<LeadMetadata | null> {
    if (!this.isOpen() || !this.opts.fetchDetails) return null;
    const id = url.match(/\/jobs\/view\/(\d+)/)?.[1];
    if (!id) return null;

    let page: Page;
    try {
      page = await this.resolveTab();
    } catch (err) {
      this.trace(`inspect ${id} › finding the tab`, err);
      return null;
    }
    if (!isJobSearchUrl(page.url())) {
      this.note(`inspect ${id} › the tab is not on a job search any more (${page.url()})`);
      return null;
    }

    const card = page
      .locator(
        `[componentkey="job-card-component-ref-${id}"] [role="button"], ` +
          `[data-occludable-job-id="${id}"] a[href*="/jobs/view/"], [data-job-id="${id}"] a[href*="/jobs/view/"]`,
      )
      .first();
    if ((await countOf(card, `inspect ${id} › find card`, this.trace)) === 0) {
      // Gone from the first page since it was spotted. Not worth a navigation.
      this.opts.log('that job is no longer in the list — alerting with what the card said');
      return null;
    }

    let step = 'scroll to card';
    try {
      await card.scrollIntoViewIfNeeded({ timeout: 5_000 });
      await sleep(400 + Math.random() * 600);
      step = 'click card';
      await card.click({ timeout: 5_000 });

      step = 'read details pane';
      const trace = within(this.trace, `inspect ${id} › readDetail`);
      const deadline = Date.now() + 12_000;
      let detail: JobDetail = { ready: false, description: '', applicants: '' };
      while (Date.now() < deadline) {
        await sleep(700);
        detail = await readDetail(page, id, trace).catch(() => detail);
        if (detail.ready && detail.description) break;
      }
      if (!detail.description) this.note(`inspect ${id} › the details pane never showed a description`);

      const meta: LeadMetadata = {};
      if (detail.description) meta.description = detail.description.slice(0, 8000);
      if (detail.applicants) meta.applicants = detail.applicants;
      return Object.keys(meta).length ? meta : null;
    } catch (err) {
      this.trace(`inspect ${id} › ${step}`, err);
      this.opts.log(`could not open that job in the list: ${(err as Error).message}`);
      return null;
    }
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;

    // Only tabs we opened. A job search you already had open stays open.
    for (const page of this.created) {
      if (!page.isClosed()) await page.close().catch(() => undefined);
    }
    this.created.clear();
    this.page = null;

    // Drops the CDP connection; your Chrome stays exactly where it was.
    await this.session.release().catch(() => undefined);
  }
}

export const linkedinWatcher: PlatformWatcher = {
  platform: 'linkedin',
  name: 'LinkedIn job alerts',

  async open(opts: WatchTabOptions): Promise<WatchTab> {
    const runtime = loadLinkedInRuntimeConfig();

    // Never headless: the tab lives in the browser you already have open.
    const session = await openProfile('linkedin', {
      headless: false,
      userAgent: runtime.userAgent,
    });

    const tab = new LinkedInJobsTab(session, opts);
    opts.log(`watching ${opts.feedUrl}`);
    return tab;
  },
};

export default linkedinWatcher;
