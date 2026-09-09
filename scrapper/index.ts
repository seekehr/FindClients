/**
 * Scraper and watcher registry.
 *
 * The server loads this file at runtime. There are two lists, and which one a
 * platform belongs in is a decision about that platform's terms of service, not
 * a technical convenience:
 *
 *  - `scrapers` — everything the server knows how to sign in to. Those with
 *    `mode: 'scrape'` are also run by the scheduled cycle, which opens a feed,
 *    takes what matches, and closes again.
 *
 *  - `watchers` — long-lived tabs, for platforms that must not be scraped.
 *    Upwork is the only one today: it forbids automated collection and enforces
 *    it, so instead of a cycle it gets one tab left open on the feed, reloaded
 *    every few minutes, with new jobs announced after a human-sized pause. See
 *    ./upwork/watch.ts and ../server/src/watcher/.
 *
 * A platform in `watchers` still appears in `scrapers` — it needs sign-in and
 * session checking like any other — but with `mode: 'watch'` and no `scrape`
 * method at all, so the cycle cannot collect from it even by accident.
 */
import type { PlatformWatcher, Scraper } from '../server/src/scrapers/types';

import { upworkScraper } from './upwork';
import { upworkWatcher } from './upwork/watch';
import { twitterScraper } from './twitter';

export const scrapers: Scraper[] = [
  upworkScraper,
  twitterScraper,
];

export const watchers: PlatformWatcher[] = [
  upworkWatcher,
];

export { upworkScraper, upworkWatcher, twitterScraper };
