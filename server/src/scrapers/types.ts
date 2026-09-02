import type { AppConfig, Platform, RawLead, SessionCookie } from '../types';
import type { CaptchaPage } from '../../../scrapper/lib/captcha';

// Re-exported so the scrapper workspace has one import site for these.
export type { AppConfig, Platform, RawLead, SessionCookie, CaptchaPage };

/**
 * Context handed to every scraper run.
 *
 * The config is passed in rather than fetched. It used to arrive over an
 * authenticated HTTP call to the server's own `/api/internal` route — a
 * service boundary that existed so a scraper could run on a different machine
 * from the API. Nothing runs on a different machine any more, so the scraper
 * was making a network round trip to the process it was already inside of.
 */
export interface ScrapeContext {
  /** Your saved settings — keywords, thresholds, limits, the Upwork feed. */
  config: AppConfig;
  /** Your session cookies for this platform, ready to inject. */
  cookies: SessionCookie[];
  /** Only return leads posted at/after this time, when the source supports it. */
  since?: Date;
  /** Soft cap on how many leads to return in one run. */
  limit: number;
  log: (msg: string) => void;
  /**
   * When true the scraper may pause on a CAPTCHA and wait for it to be solved
   * in the visible browser window. Only set in non-headless / CLI mode.
   */
  interactive?: boolean;
  /**
   * Called when a CAPTCHA is detected. Hands off the Playwright page for remote
   * solving (screenshot → click → relay). Returns true if solved. When not
   * provided, the scraper waits interactively or skips.
   */
  onCaptcha?: (page: CaptchaPage, platform: string) => Promise<boolean>;
}

/**
 * The contract every platform scraper implements.
 *
 * Real scrapers live in the top-level `scrapper/` folder and are loaded at
 * runtime. Each must be side-effect free: fetch + parse + return, and let the
 * server handle de-duplication, persistence, and notifications.
 */
export interface Scraper {
  platform: Platform;
  name: string;
  /** Return raw leads discovered on this run (may be empty). */
  scrape(ctx: ScrapeContext): Promise<RawLead[]>;
}
