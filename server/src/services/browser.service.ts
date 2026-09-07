import { env } from '../config/env';

/**
 * Is the browser the scrapers need actually there?
 *
 * When FindClients is attached to a Chrome you started yourself, that window
 * closing breaks every scrape, sign-in and session check — and the only clue
 * used to be a failed run reporting `Could not reach Chrome` some minutes
 * later. This is what lets the UI say so up front instead.
 *
 * The check is a plain GET against the CDP endpoint rather than a Playwright
 * connection: it answers in under a millisecond on loopback, and opening a real
 * CDP session just to ask "are you alive?" would be far more expensive than the
 * question deserves.
 */

export type BrowserMode = 'attached' | 'own';

export interface BrowserStatus {
  mode: BrowserMode;
  /** The CDP endpoint, when attached. */
  url: string;
  /** False only when attached and the browser is gone. */
  reachable: boolean;
  /** What to do about it, when it is not reachable. */
  hint: string;
}

/**
 * Polled from the UI every few seconds, so the answer is cached briefly. The
 * window is short enough that closing Chrome shows up almost immediately.
 */
const CACHE_MS = 3_000;
const TIMEOUT_MS = 1_500;

let cached: { at: number; value: BrowserStatus } | null = null;

async function probe(url: string): Promise<boolean> {
  try {
    const res = await fetch(`${url.replace(/\/+$/, '')}/json/version`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function browserStatus(): Promise<BrowserStatus> {
  // Launching our own browser per run means there is nothing to be down.
  if (!env.chromeCdpUrl) {
    return { mode: 'own', url: '', reachable: true, hint: '' };
  }

  if (cached && Date.now() - cached.at < CACHE_MS) return cached.value;

  const reachable = await probe(env.chromeCdpUrl);
  const value: BrowserStatus = {
    mode: 'attached',
    url: env.chromeCdpUrl,
    reachable,
    hint: reachable
      ? ''
      : 'Run `npm run chrome` in the project folder and leave that window open. ' +
        'Scraping and signing in both need it.',
  };

  cached = { at: Date.now(), value };
  return value;
}

/** Drop the cache, so the next read is fresh. */
export function invalidateBrowserStatus(): void {
  cached = null;
}
