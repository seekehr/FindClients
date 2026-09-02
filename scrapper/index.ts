/**
 * Scraper registry.
 *
 * The server loads this file at runtime and runs every scraper you export in
 * the `scrapers` array on a schedule. Implement each platform in its own file
 * (see ./upwork, ./twitter, ./discord) and add it here.
 *
 * Each run is handed your saved configuration and the session cookies for
 * that platform — see `ScrapeContext` in ../server/src/scrapers/types.ts.
 */
import type { Scraper } from '../server/src/scrapers/types';

import { upworkScraper } from './upwork';
import { twitterScraper } from './twitter';
export const scrapers: Scraper[] = [
  // Both launch their own Chromium and inject the session cookies you saved on
  // the Connections page — nothing to start by hand. Both need
  // `npx playwright install chromium`, which `npm run setup` does for you.
  twitterScraper,
  upworkScraper,
];

export { upworkScraper, twitterScraper };
