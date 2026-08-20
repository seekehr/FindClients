import { logger } from '../utils/logger';
import type { Scraper } from './types';

/**
 * Dynamically load the user-implemented scrapers from the top-level
 * `scrapper/` folder. Wrapped in try/catch so a missing or broken user scraper
 * never takes the server down.
 */
export async function loadUserScrapers(): Promise<Scraper[]> {
  try {
    const mod = (await import('../../../scrapper/index.js')) as unknown as {
      scrapers?: Scraper[];
    };
    const scrapers = mod.scrapers ?? [];
    return scrapers.filter((s) => s && typeof s.scrape === 'function');
  } catch (err) {
    logger.warn('Could not load scrapers from scrapper/', (err as Error).message);
    return [];
  }
}
