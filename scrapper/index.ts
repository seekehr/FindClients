/**
 * Scraper registry.
 *
 * The server loads this file at runtime and runs every scraper you export in
 * the `scrapers` array on a schedule. Implement each platform in its own file
 * (see ./upwork, ./twitter, ./discord) and add it here.
 *
 * Anything you export here overrides the server's built-in *demo* scraper for
 * that platform. Until a scraper returns real leads, the demo scraper keeps the
 * pipeline alive (toggle with USE_DEMO_SCRAPERS in server/.env).
 */
import type { Scraper } from '../server/src/scrapers/types';

import { upworkScraper } from './upwork';
import { twitterScraper } from './twitter';
import { discordScraper } from './discord';

export const scrapers: Scraper[] = [
  // Uncomment / add scrapers here once you've implemented them.
  // upworkScraper,
  // twitterScraper,
  // discordScraper,
];

export { upworkScraper, twitterScraper, discordScraper };
