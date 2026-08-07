import type { Platform, RawLead, SessionCookie, UserConfig } from '../types';

export type { Platform, RawLead, SessionCookie, UserConfig };

/**
 * Context handed to every scraper run. Scraping is per-user: each run is driven
 * by one connected user's session cookies (pasted from their browser) and that
 * user's own saved configuration.
 */
export interface ScrapeContext {
  /** The user this run is scraping on behalf of. */
  userId: string;
  /** The user's decrypted session cookies for this platform, ready to inject. */
  cookies: SessionCookie[];
  /**
   * The user's saved configuration (`public.user_config`), as edited on the
   * app's Config page. This is the *only* source for search settings —
   * keywords, thresholds and limits are per-user and are not read from the
   * environment, so a change in the UI takes effect on the next cycle.
   */
  config: UserConfig;
  /** Only return leads posted at/after this time, when the source supports it. */
  since?: Date;
  /** Soft cap on how many leads to return in one run. */
  limit: number;
  log: (msg: string) => void;
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
