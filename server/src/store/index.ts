import path from 'node:path';
import { env } from '../config/env';
import { logger } from '../utils/logger';
import { JsonFile, registerForFlush, flushAll } from './json-file';
import { DEFAULT_AI_MODEL, type AppConfig, type Lead, type Notification, type ScrapeRun } from '../types';

export { flushAll };

/**
 * The whole database: six JSON files in one folder.
 *
 * Each export below is a file kept in memory. Read `.data`, mutate it, call
 * `.save()`. There are no queries, no transactions and no connection — the
 * services above do their filtering in plain TypeScript, which at one person's
 * volume of leads is both faster and far easier to read than the SQL it
 * replaced.
 */

/**
 * The config as stored on disk. Differs from `AppConfig` in exactly one place:
 * the Gemini API key. It is kept off `AppConfig` because that shape is what
 * `GET /api/config` sends to the browser.
 *
 * The key and your session cookies are stored as plain text. On a single-user
 * local install that is the honest design: encrypting them with a key that
 * sits in the `.env` file beside them protects against nothing and adds a way
 * to lose your data. Treat `data/` the way you would treat `~/.aws` — it is
 * gitignored, and anyone who can read it can already read your browser's
 * cookie jar.
 */
export interface StoredConfig extends Omit<AppConfig, 'aiApiKeySet' | 'aiApiKeyHint'> {
  aiApiKey: string;
}

/**
 * What we remember about a platform connection.
 *
 * Deliberately not a credential. The session itself lives in a Chromium
 * profile under `data/browser/<platform>/`, exactly where a browser keeps one;
 * this record only says when you signed in and how the last run went, so
 * nothing secret passes through the JSON store at all.
 */
export interface StoredConnection {
  platform: string;
  status: 'connected' | 'expired' | 'error';
  lastError: string | null;
  connectedAt: string;
  updatedAt: string;
  lastUsedAt: string | null;
}

/**
 * What a brand-new install starts with. These used to be column defaults in
 * the Postgres schema; they are the same values, in the one place that now
 * defines them.
 */
export function defaultConfig(): StoredConfig {
  return {
    newLeadsNotification: true,
    discordWebhookUrl: '',

    platforms: ['upwork', 'twitter'],
    keywords: [
      'looking for a developer',
      'need a web designer',
      'hiring freelancer',
      'anyone know a good developer',
      'looking to hire',
    ],
    excludedKeywords: [],
    minBudget: 0,

    scrapeEnabled: true,
    leadsPerRun: 25,
    maxPostAgeHours: 48,

    twitterMinLikes: 0,
    twitterMinViews: 0,
    twitterLimitPerKeyword: 15,

    upworkJobsUrl: 'https://www.upwork.com/nx/find-work/most-recent?nav_dir=pop',
    upworkFetchDetails: true,
    upworkMaxAgeHours: 5,

    aiEnabled: false,
    aiPrompt:
      'Describe the work you want. For example: "I build Shopify storefronts for ' +
      'small brands. A good lead is someone who owns a store and wants design or ' +
      'development help and has a budget over $500. Reject people advertising ' +
      'their own services, unpaid work, and anything that is not e-commerce."',
    aiModel: DEFAULT_AI_MODEL,
    aiMinScore: 60,
    aiAutoArchive: true,
    aiApiKey: '',

    updatedAt: new Date().toISOString(),
  };
}

const file = (name: string) => path.join(env.dataDir, name);

/**
 * Config is merged over the defaults on load, so a file written by an older
 * version — missing a setting added since — picks the new default up instead
 * of arriving as `undefined` in the middle of a scrape.
 */
export const configStore = registerForFlush(
  new JsonFile<StoredConfig>(file('config.json'), defaultConfig),
);
configStore.data = { ...defaultConfig(), ...configStore.data };

export const leadsStore = registerForFlush(new JsonFile<Lead[]>(file('leads.json'), () => []));

/** A lead you cleared away, and when. */
export interface DismissedEntry {
  hash: string;
  at: string;
}

/**
 * How long a cleared lead stays cleared.
 *
 * There has to be a tombstone at all, or "clear leads" would be undone by the
 * next scrape — the posts are still on Upwork and X, so they would be found
 * and inserted straight back.
 *
 * It has to expire, or clearing quietly becomes permanent. The scrapers return
 * the same recent posts every cycle, so clearing right after a scrape
 * blacklists everything you just saw, forever: the log keeps reporting
 * `found 25, inserted 0` and the Leads page stays empty with no explanation.
 * Thirty days is longer than any of these posts stay live, so in practice a
 * cleared lead never comes back — it just stops being able to poison the well.
 */
export const DISMISS_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export const dismissedStore = registerForFlush(
  new JsonFile<DismissedEntry[]>(file('dismissed.json'), () => []),
);

// Older versions stored bare hash strings with no timestamp. Treat those as
// cleared now, so they expire on the new schedule rather than living forever.
dismissedStore.data = dismissedStore.data.map((entry) =>
  typeof entry === 'string' ? { hash: entry as unknown as string, at: new Date().toISOString() } : entry,
);

export const connectionsStore = registerForFlush(
  new JsonFile<Record<string, StoredConnection>>(file('connections.json'), () => ({})),
);

export const runsStore = registerForFlush(new JsonFile<ScrapeRun[]>(file('runs.json'), () => []));

export const notificationsStore = registerForFlush(
  new JsonFile<Notification[]>(file('notifications.json'), () => []),
);

/** History is for glancing at, not for archiving. Keep both lists bounded. */
export const MAX_RUNS = 200;
export const MAX_NOTIFICATIONS = 200;

export function initStore(): void {
  logger.info(`Data directory: ${env.dataDir}`);
  logger.info(
    `Loaded ${leadsStore.data.length} lead(s), ` +
      `${Object.keys(connectionsStore.data).length} connection(s)`,
  );
}
