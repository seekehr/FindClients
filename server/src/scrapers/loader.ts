import { logger } from '../utils/logger';
import type { PlatformWatcher, Scraper } from './types';

interface ScrapperModule {
  scrapers?: Scraper[];
  watchers?: PlatformWatcher[];
}

/**
 * Load the top-level `scrapper/` folder once and keep it.
 *
 * Wrapped in try/catch so a broken scraper never takes the whole app down
 * with it, and cached because the watcher asks for its driver on every
 * reconnect — re-importing per call would leak a module instance each time.
 */
let cached: Promise<ScrapperModule> | null = null;

function load(): Promise<ScrapperModule> {
  cached ??= (import('../../../scrapper/index.js') as Promise<ScrapperModule>).catch((err) => {
    logger.warn('Could not load scrapper/', (err as Error).message);
    // Don't cache the failure: a syntax error fixed mid-session should be
    // picked up by the next restart, not remembered until one.
    cached = null;
    return {};
  });
  return cached;
}

/**
 * Every scraper the scheduled cycle may run.
 *
 * Watch-mode platforms are filtered out here rather than in the runner, so a
 * platform that must not be bulk-collected cannot reach the cycle at all —
 * including through a future caller that forgets to check `mode`.
 */
export async function loadScrapers(): Promise<Scraper[]> {
  const mod = await load();
  return (mod.scrapers ?? []).filter((s) => s && typeof s.checkSession === 'function');
}

/** The scrapers the cycle is actually allowed to run. */
export async function loadBulkScrapers(): Promise<Scraper[]> {
  const all = await loadScrapers();
  return all.filter((s) => s.mode === 'scrape' && typeof s.scrape === 'function');
}

/** The long-lived watchers, keyed by platform. */
export async function loadWatchers(): Promise<PlatformWatcher[]> {
  const mod = await load();
  return (mod.watchers ?? []).filter((w) => w && typeof w.open === 'function');
}

export async function loadWatcher(platform: string): Promise<PlatformWatcher | null> {
  const watchers = await loadWatchers();
  return watchers.find((w) => w.platform === platform) ?? null;
}
