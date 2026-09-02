import fs from 'node:fs';
import path from 'node:path';
import { loadRootEnv } from './env';
import type { AppConfig, SessionCookie } from '../../server/src/scrapers/types';

/**
 * Read the app's saved data straight off disk.
 *
 * This replaced an HTTP client that asked the server for the same values over
 * an authenticated internal API. The server is on this machine, reading these
 * exact files — so the standalone tools (the CLI, the smoke tests) just read
 * them too, and no longer need the app running to work.
 *
 * Read-only, deliberately: only the server writes to `data/`, so a smoke test
 * can never corrupt your leads.
 */

loadRootEnv();

function dataDir(): string {
  const root = path.resolve(__dirname, '..', '..');
  return process.env.DATA_DIR ? path.resolve(root, process.env.DATA_DIR) : path.join(root, 'data');
}

function readJson<T>(name: string): T | null {
  const file = path.join(dataDir(), name);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
  } catch {
    return null;
  }
}

/** Your saved settings, or null if the app has never been run. */
export function readSavedConfig(): AppConfig | null {
  const stored = readJson<Record<string, unknown>>('config.json');
  if (!stored) return null;
  // The key is not needed here and has no business in a test process.
  const { aiApiKey, ...rest } = stored;
  return { ...rest, aiApiKeySet: Boolean(aiApiKey), aiApiKeyHint: '' } as unknown as AppConfig;
}

interface StoredCredential {
  platform: string;
  cookies: string;
}

/** The session cookies saved for a platform, parsed. Empty if not connected. */
export function readSavedCookies(platform: string): SessionCookie[] {
  const all = readJson<Record<string, StoredCredential>>('credentials.json');
  const raw = all?.[platform]?.cookies;
  if (!raw) return [];

  const domain = platform === 'twitter' ? '.x.com' : `.${platform}.com`;
  return raw
    .replace(/^cookie:/i, '')
    .split(/;|\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((pair) => {
      const i = pair.indexOf('=');
      return {
        name: i >= 0 ? pair.slice(0, i).trim() : pair,
        value: i >= 0 ? pair.slice(i + 1).trim() : '',
        domain,
        path: '/',
      };
    })
    .filter((c) => c.name && c.value);
}
