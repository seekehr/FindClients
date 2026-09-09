import type { AppConfig, LeadMetadata, Platform, RawLead } from '../types';

// Re-exported so the scrapper workspace has one import site for these.
export type { AppConfig, LeadMetadata, Platform, RawLead };

/**
 * Context handed to every scraper run.
 *
 * Note what is no longer here: session cookies. Each scraper owns a persistent
 * Chromium profile in `data/browser/<platform>/` and is already signed in when
 * it starts — the same way your own browser is. Nothing in the server touches a
 * credential, because there is no longer a credential to touch.
 */
export interface ScrapeContext {
  /** Your saved settings — keywords, thresholds, limits, the Upwork feed. */
  config: AppConfig;
  /** Only return leads posted at/after this time, when the source supports it. */
  since?: Date;
  /** Soft cap on how many leads to return in one run. */
  limit: number;
  log: (msg: string) => void;
  /**
   * Whether the scraper may open a visible browser window and wait for a person
   * to solve a bot challenge in it.
   *
   * This assumes someone is actually at the machine. A scheduled run at 3am that
   * hits a CAPTCHA will open a window nobody sees and then time out — the honest
   * outcome, and far cheaper than the screenshot-relay solver it replaced. Set
   * CAPTCHA_OPEN_WINDOW=false to skip straight to giving up.
   */
  interactive: boolean;
  /** How long to leave that window open before giving up. */
  captchaTimeoutMs: number;
}

/** What we know about a platform's saved browser profile. */
export interface SessionStatus {
  /** A profile directory exists — you have signed in here at some point. */
  hasProfile: boolean;
  /** The saved session still works right now. */
  signedIn: boolean;
  /** Why not, when we could tell. */
  detail?: string;
}

export interface SignInOptions {
  /** How long to leave the sign-in window open. */
  timeoutMs: number;
  log: (msg: string) => void;
}

/**
 * The contract every platform scraper implements.
 *
 * Scrapers live in the top-level `scrapper/` folder and are loaded at runtime.
 * Beyond scraping, each owns its own sign-in: it knows where that platform's
 * login page is and how to tell a signed-in session from a signed-out one, so
 * the server never needs to learn anything platform-specific.
 */
export interface Scraper {
  platform: Platform;
  name: string;

  /**
   * How this platform is collected from — and, just as importantly, how it is
   * not.
   *
   *  - `'scrape'` — the scheduled cycle drives it. It opens a browser, pages
   *    through a feed, takes everything matching, and closes again.
   *  - `'watch'` — a long-lived watcher owns it (see `PlatformWatcher` below)
   *    and the scrape cycle never touches it. One tab stays open, gets
   *    reloaded now and then, and new posts are announced one at a time.
   *
   * Upwork is `'watch'`, and that is not a preference. Upwork's terms forbid
   * automated collection and it enforces them: a session that walks the feed
   * pulling every job, page after page, is the exact pattern behind the banned
   * accounts. Watching one tab the way a person leaves it open is not.
   */
  mode: 'scrape' | 'watch';

  /**
   * Return raw leads discovered on this run (may be empty).
   *
   * Optional, and absent on every `'watch'` scraper — deliberately, so that
   * "Upwork is never bulk-collected" is a fact about the code rather than a
   * flag someone has to remember to check.
   */
  scrape?(ctx: ScrapeContext): Promise<RawLead[]>;

  /**
   * Check the saved profile without any interaction. Opens the profile
   * headlessly, so it cannot run while a scrape is using it.
   */
  checkSession(log: (msg: string) => void): Promise<SessionStatus>;

  /**
   * Open a real browser window at the platform's login page and wait for the
   * person to sign in. Whatever they end up with is saved in the profile.
   */
  signIn(opts: SignInOptions): Promise<boolean>;

  /** Forget the saved profile entirely. */
  signOut(): Promise<void>;
}


/* ── Watching ──────────────────────────────────────────────────────────────
 *
 * The other half of the contract, for platforms that must not be scraped.
 *
 * A scraper is a *visit*: open, take, leave. A watcher is a *tab you left
 * open*: it sits on one page, reloads it at irregular intervals, and notices
 * what changed. It never pages, never opens a job it was not shown, and never
 * asks the site for more than the page it is already on.
 */

export interface WatchTabOptions {
  /** The feed to sit on. Any Upwork search URL the user pasted. */
  feedUrl: string;
  log: (msg: string) => void;
  /** Whether a person is around to clear a bot challenge in the window. */
  interactive: boolean;
  /** How long to leave that challenge on screen before giving up. */
  captchaTimeoutMs: number;
  /** Also read each new job's own page for client rating and hire rate. */
  fetchDetails: boolean;
}

/** Why a poll came back with nothing useful. */
export type WatchProblem = 'signed-out' | 'challenge' | 'no-feed' | 'closed';

export interface WatchResult {
  /** Everything currently on the feed — not only what is new. */
  leads: RawLead[];
  /** Set when the reload did not reach a readable feed. */
  problem?: WatchProblem;
  detail?: string;
}

/**
 * One open tab, held for as long as the watcher runs.
 *
 * `poll()` is the only thing that touches the network, and it does exactly what
 * a person pressing F5 does: reload the page in front of it and read what came
 * back.
 */
export interface WatchTab {
  /** Reload the feed and read it. Never navigates anywhere else. */
  poll(): Promise<WatchResult>;

  /**
   * Open one job's own page and read what the feed tile could not show —
   * client rating, hire rate — then come back to the feed.
   *
   * Called a couple of minutes after the job was spotted, never during a
   * reload, and only for jobs that are about to be alerted on. That is the one
   * click-through a person makes when something on the feed catches their eye;
   * it is not a crawl, and it must never be used to walk a list.
   */
  inspect?(url: string): Promise<LeadMetadata | null>;

  /** False once the tab or the browser behind it has gone away. */
  isOpen(): boolean;

  /** Close our tab. Never closes a browser the user started. */
  close(): Promise<void>;
}

/** The contract a watched platform implements, in place of `scrape`. */
export interface PlatformWatcher {
  platform: Platform;
  name: string;
  /** Open the tab and land it on the feed. Throws if it cannot. */
  open(opts: WatchTabOptions): Promise<WatchTab>;
}
