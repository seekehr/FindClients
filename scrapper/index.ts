/**
 * Scraper registry.
 *
 * The server loads this file at runtime and runs every scraper you export in
 * the `scrapers` array on a schedule. Implement each platform in its own file
 * (see ./upwork, ./twitter, ./discord) and add it here.
 *
 * Each run is driven by one user's connected session cookies and their saved
 * configuration — see `ScrapeContext` in ../server/src/scrapers/types.ts.
 */
import type { Scraper } from '../server/src/scrapers/types';

import { upworkScraper } from './upwork';
import { twitterScraper } from './twitter';
export const scrapers: Scraper[] = [
  // Implemented — real Playwright scrapers.
  //   Twitter/X: needs X_AUTH_TOKEN (see scrapper/twitter).
  //   Upwork:    needs Chrome on --remote-debugging-port=9222, logged into Upwork
  //              (see scrapper/upwork). Both need `npx playwright install chromium`.
  twitterScraper,
  upworkScraper,
];

export { upworkScraper, twitterScraper };
