/**
 * Scraper registry.
 *
 * The server loads this file at runtime and runs every scraper you export in
 * the `scrapers` array on a schedule. Implement each platform in its own file
 * (see ./upwork, ./twitter, ./discord) and add it here.
 *
 * Each run is handed your saved configuration — see `ScrapeContext` in
 * ../server/src/scrapers/types.ts. Sessions come from the browser profile, not
 * from anything passed in.
 */
import type { Scraper } from '../server/src/scrapers/types';

import { upworkScraper } from './upwork';
import { twitterScraper } from './twitter';
/**
 * Order matters: the runner works through this list one at a time.
 *
 * Upwork goes first because it is the one that can stop and ask for a human —
 * it sits behind Cloudflare and may need a challenge cleared by hand. Running
 * it first puts that prompt in front of you at the start of a cycle, rather
 * than several minutes in, by which time you may have walked away.
 */
export const scrapers: Scraper[] = [
  upworkScraper,
  twitterScraper,
];

export { upworkScraper, twitterScraper };
