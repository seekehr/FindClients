import type { Platform, RawLead, SessionCookie, UserConfig } from '../types';

// Re-exported so the scrapper workspace has one import site for these.
export type { Platform, RawLead, SessionCookie, UserConfig };

/** Minimal Playwright Page surface used by the captcha flow. */
export interface CaptchaPage {
  screenshot(opts?: { type?: string }): Promise<Buffer>;
  mouse: { click(x: number, y: number): Promise<void> };
  url(): string;
  title(): Promise<string>;
  viewportSize(): { width: number; height: number } | null;
}

/**
 * Context handed to every scraper run. Scraping is per-user: each run is driven
 * by one connected user's session cookies (pasted from their browser).
 *
 * Note what is deliberately *absent*: the user's configuration. Scrapers fetch
 * that themselves from the server's `/api/internal` endpoint (see
 * `scrapper/lib/api.ts`), so they depend on an HTTP contract rather than on
 * being handed state by their caller — which is what lets them run
 * out-of-process without changing.
 */
export interface ScrapeContext {
  /** The user this run is scraping on behalf of. */
  userId: string;
  /** The user's decrypted session cookies for this platform, ready to inject. */
  cookies: SessionCookie[];
  /** Only return leads posted at/after this time, when the source supports it. */
  since?: Date;
  /** Soft cap on how many leads to return in one run. */
  limit: number;
  log: (msg: string) => void;
  /**
   * When true the scraper may pause on a CAPTCHA and wait for the user to solve
   * it in the visible browser window. Only set in non-headless / CLI mode.
   */
  interactive?: boolean;
  /**
   * Called when a CAPTCHA is detected. Hands off the Playwright page for remote
   * solving (screenshot → user clicks → relay). Returns true if solved.
   * When not provided, the scraper waits interactively or skips.
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
