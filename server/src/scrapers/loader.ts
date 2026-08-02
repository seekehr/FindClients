import { env } from '../config/env';
import { logger } from '../utils/logger';
import { demoScrapers } from './demo';
import type { Scraper } from './types';

/**
 * Dynamically load the user-implemented scrapers from the top-level
 * `scrapper/` folder. Wrapped in try/catch so a missing or broken user scraper
 * never takes the server down — we simply fall back to whatever loaded.
 */
async function loadUserScrapers(): Promise<Scraper[]> {
  try {
    const mod: { scrapers?: Scraper[]; default?: Scraper[] } = await import('../../../scrapper');
    const scrapers = mod.scrapers ?? mod.default ?? [];
    const usable = scrapers.filter((s) => s && typeof s.scrape === 'function');
    if (usable.length) logger.info(`Loaded ${usable.length} user scraper(s) from scrapper/`);
    return usable;
  } catch (err) {
    logger.warn('No user scrapers loaded from scrapper/ (using demo only)', (err as Error).message);
    return [];
  }
}

/** The set of scrapers the scheduler will run, honoring env toggles. */
export async function getActiveScrapers(): Promise<Scraper[]> {
  const user = await loadUserScrapers();
  const active = [...user];
  if (env.useDemoScrapers) {
    // Only add demo scrapers for platforms the user hasn't already provided.
    const covered = new Set(user.map((s) => s.platform));
    active.push(...demoScrapers.filter((s) => !covered.has(s.platform)));
  }
  return active;
}
