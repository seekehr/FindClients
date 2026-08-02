import type { Platform, RawLead } from '../types';

export type { Platform, RawLead };

/** Context handed to every scraper run. */
export interface ScrapeContext {
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
