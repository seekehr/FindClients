import { connectionsStore, type StoredConnection } from '../store';
import { logger } from '../utils/logger';
import { badRequest, conflict } from '../utils/http';
import { loadScrapers } from '../scrapers/loader';
import { isScraping } from '../scrapers/runner';
import type { Scraper, SessionStatus } from '../scrapers/types';

/**
 * Platform connections.
 *
 * A connection is a signed-in browser profile in `data/browser/<platform>/`,
 * not a stored credential. This service holds no secrets at all — it records
 * when you last signed in and whether the last run worked, and delegates every
 * question about the session itself to the scraper that owns the profile.
 *
 * That is the whole reason this file is now a third of its former size: there
 * is no cookie parsing, no required-cookie validation and no encryption,
 * because there is nothing here to encrypt.
 */

/** Platforms you can sign in to. */
export const CONNECTABLE_PLATFORMS = ['twitter', 'upwork'] as const;
export type ConnectablePlatform = (typeof CONNECTABLE_PLATFORMS)[number];

export function isConnectablePlatform(p: string): p is ConnectablePlatform {
  return (CONNECTABLE_PLATFORMS as readonly string[]).includes(p);
}

export interface ConnectionStatus {
  platform: string;
  /** 'connected' | 'expired' | 'error' | 'disconnected' */
  status: string;
  connectedAt: string | null;
  lastUsedAt: string | null;
  lastError: string | null;
}

/** How long to leave a sign-in window open before giving up. */
const SIGN_IN_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * A sign-in in progress. At most one at a time: each one drives a browser
 * profile that only one process may hold open.
 */
interface SignInState {
  platform: string;
  status: 'waiting' | 'done' | 'failed';
  message: string;
  startedAt: string;
}

let signInState: SignInState | null = null;

function toStatus(platform: string, row: StoredConnection | undefined): ConnectionStatus {
  if (!row) {
    return {
      platform,
      status: 'disconnected',
      connectedAt: null,
      lastUsedAt: null,
      lastError: null,
    };
  }
  return {
    platform,
    status: row.status,
    connectedAt: row.connectedAt,
    lastUsedAt: row.lastUsedAt,
    lastError: row.lastError,
  };
}

export function listConnections(): ConnectionStatus[] {
  return CONNECTABLE_PLATFORMS.map((p) => toStatus(p, connectionsStore.data[p]));
}

/** The sign-in currently in progress, if any. Polled by the Connections page. */
export function getSignInState(): SignInState | null {
  return signInState;
}

async function scraperFor(platform: string): Promise<Scraper> {
  const scrapers = await loadScrapers();
  const scraper = scrapers.find((s) => s.platform === platform);
  if (!scraper) throw badRequest(`No scraper is installed for ${platform}`);
  return scraper;
}

function record(platform: string, patch: Partial<StoredConnection>): void {
  const now = new Date().toISOString();
  const base: StoredConnection = connectionsStore.data[platform] ?? {
    platform,
    status: 'connected',
    connectedAt: now,
    updatedAt: now,
    lastUsedAt: null,
    lastError: null,
  };

  connectionsStore.data[platform] = { ...base, ...patch, platform, updatedAt: now };
  connectionsStore.save();
}

/**
 * Open a browser window for the user to sign in, in the background.
 *
 * Returns as soon as the window is on its way — signing in takes as long as it
 * takes, and an HTTP request should not be held open for it. The Connections
 * page follows along with `getSignInState`.
 */
export function startSignIn(platform: ConnectablePlatform): void {
  if (signInState?.status === 'waiting') {
    throw conflict(`Already waiting for you to sign in to ${signInState.platform}.`);
  }
  // Both would open the same profile directory, and Chromium locks it.
  if (isScraping()) {
    throw conflict('A scrape is running right now. Wait for it to finish, then sign in.');
  }

  signInState = {
    platform,
    status: 'waiting',
    message: 'Opening a browser window…',
    startedAt: new Date().toISOString(),
  };

  void (async () => {
    const log = (msg: string) => {
      logger.info(`[${platform}] ${msg}`);
      if (signInState?.status === 'waiting') signInState.message = msg;
    };

    try {
      const scraper = await scraperFor(platform);
      const ok = await scraper.signIn({ timeoutMs: SIGN_IN_TIMEOUT_MS, log });

      if (ok) {
        record(platform, { status: 'connected', connectedAt: new Date().toISOString() });
        signInState = {
          ...signInState!,
          status: 'done',
          message: `Signed in to ${platform}.`,
        };
      } else {
        signInState = {
          ...signInState!,
          status: 'failed',
          message: 'Sign-in was not completed.',
        };
      }
    } catch (err) {
      const message = (err as Error).message ?? 'unknown error';
      logger.error(`[${platform}] sign-in failed`, message);
      record(platform, { status: 'error', lastError: message });
      signInState = { ...signInState!, status: 'failed', message };
    }
  })();
}

/** Forget a platform's browser profile. */
export async function disconnect(platform: ConnectablePlatform): Promise<void> {
  if (isScraping()) {
    throw conflict('A scrape is running right now. Wait for it to finish, then disconnect.');
  }
  const scraper = await scraperFor(platform);
  await scraper.signOut();
  delete connectionsStore.data[platform];
  connectionsStore.save();
}

/**
 * Ask the scraper whether its saved session still works.
 *
 * This opens the profile headlessly, so it cannot run during a scrape — the
 * caller is expected to have checked.
 */
export async function checkConnection(platform: ConnectablePlatform): Promise<SessionStatus> {
  const scraper = await scraperFor(platform);
  const status = await scraper.checkSession((msg) => logger.info(`[${platform}] ${msg}`));

  if (!status.hasProfile) {
    delete connectionsStore.data[platform];
    connectionsStore.save();
  } else {
    record(platform, {
      status: status.signedIn ? 'connected' : 'expired',
      lastError: status.detail ?? null,
    });
  }
  return status;
}

/**
 * Has this platform been signed in to? Cheap — no browser involved.
 *
 * An 'expired' or 'error' connection deliberately still counts. A failed run is
 * often transient, and a session that looked dead one cycle is frequently fine
 * the next; excluding them would mean one bad cycle silently switched a
 * platform off until you noticed. A good run clears the flag via `markUsed`.
 */
export function isConnected(platform: string): boolean {
  return Boolean(connectionsStore.data[platform]);
}

export function markUsed(platform: string): void {
  record(platform, { status: 'connected', lastUsedAt: new Date().toISOString(), lastError: null });
}

export function markError(platform: string, error: string): void {
  record(platform, { status: 'error', lastError: error.slice(0, 300) });
}
