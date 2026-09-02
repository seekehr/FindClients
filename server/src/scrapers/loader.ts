import { logger } from '../utils/logger';
import type { Scraper } from './types';

/**
 * Load the scrapers from the top-level `scrapper/` folder. Wrapped in
 * try/catch so a broken scraper never takes the whole app down with it.
 */
export async function loadScrapers(): Promise<Scraper[]> {
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
