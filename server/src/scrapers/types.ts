import type { AppConfig, Platform, RawLead } from '../types';

// Re-exported so the scrapper workspace has one import site for these.
export type { AppConfig, Platform, RawLead };

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

  /** Return raw leads discovered on this run (may be empty). */
  scrape(ctx: ScrapeContext): Promise<RawLead[]>;

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
