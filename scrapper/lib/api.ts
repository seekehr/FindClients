import { loadRootEnv } from './env';
import type { SessionCookie, UserConfig } from '../../server/src/scrapers/types';

/**
 * Client for the server's service-to-service API (`/api/internal`).
 *
 * Scrapers do not touch the database. Everything they need to run — the user's
 * configuration and, when running standalone, their platform session — is
 * fetched from the server over HTTP with the shared INTERNAL_API_KEY.
 *
 * That boundary is the point: Supabase credentials stay in one process, and a
 * scraper can move out-of-process (its own worker, its own machine) without a
 * single line changing here.
 */

loadRootEnv();

function baseUrl(): string {
  const url =
    process.env.INTERNAL_API_URL ??
    process.env.NEXT_PUBLIC_API_URL ??
    `http://localhost:${process.env.PORT ?? 4000}/api`;
  return url.replace(/\/+$/, '');
}

export class InternalApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'InternalApiError';
    this.status = status;
  }
}

async function get<T>(path: string): Promise<T> {
  const key = process.env.INTERNAL_API_KEY;
  if (!key) {
    throw new InternalApiError(
      0,
      'INTERNAL_API_KEY is not set — the scraper cannot reach the server API. ' +
        'Add it to the .env at the repository root.',
    );
  }

  const url = `${baseUrl()}/internal${path}`;

  let res: Response;
  try {
    res = await fetch(url, {
      headers: { 'x-internal-key': key, Accept: 'application/json' },
      // A scrape run is slow, but a config lookup should never hang it.
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    throw new InternalApiError(
      0,
      `Cannot reach the server API at ${url}: ${(err as Error).message}`,
    );
  }

  const body = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) {
    throw new InternalApiError(res.status, body.error ?? `${res.status} ${res.statusText}`);
  }
  return body as T;
}

/**
 * A user's config is stable across a run but read by every scraper, so cache it
 * briefly. The TTL is short enough that a change on the Config page lands on the
 * next cycle rather than the one after.
 */
const CONFIG_TTL_MS = 30_000;
const configCache = new Map<string, { value: UserConfig; expiresAt: number }>();

export async function getUserConfig(userId: string): Promise<UserConfig> {
  const hit = configCache.get(userId);
  if (hit && hit.expiresAt > Date.now()) return hit.value;

  const { config } = await get<{ userId: string; config: UserConfig }>(
    `/users/${encodeURIComponent(userId)}/config`,
  );
  configCache.set(userId, { value: config, expiresAt: Date.now() + CONFIG_TTL_MS });
  return config;
}

/** Forget a cached config (after a run fails, or in tests). */
export function clearConfigCache(userId?: string): void {
  if (userId) configCache.delete(userId);
  else configCache.clear();
}

export interface PlatformConnection {
  userId: string;
  cookies: SessionCookie[];
  config: UserConfig;
}

/**
 * Every user who has connected this platform, with their session cookies and
 * config. Only needed when driving scrapers standalone — when the server runs
 * them it already passes the cookies through the ScrapeContext.
 */
export async function getPlatformConnections(platform: string): Promise<PlatformConnection[]> {
  const { connections } = await get<{ platform: string; connections: PlatformConnection[] }>(
    `/platforms/${encodeURIComponent(platform)}/connections`,
  );
  return connections;
}

/** Platforms the server can hold a connected session for. */
export async function getSupportedPlatforms(): Promise<string[]> {
  const { platforms } = await get<{ platforms: string[] }>('/platforms');
  return platforms;
}
