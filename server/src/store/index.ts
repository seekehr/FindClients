import path from 'node:path';
import { env } from '../config/env';
import { logger } from '../utils/logger';
import { JsonFile, registerForFlush, flushAll } from './json-file';
import {
  DEFAULT_AI_MODEL,
  LINKEDIN_RELOAD_FLOOR_MINUTES,
  UPWORK_RELOAD_FLOOR_MINUTES,
  type AppConfig,
  type Lead,
  type Notification,
  type Opportunity,
  type ScrapeRun,
} from '../types';

export { flushAll };

/**
 * The whole database: a handful of JSON files in one folder.
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

    platforms: ['upwork', 'twitter', 'blackhatworld', 'linkedin'],
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

    bhwForumUrls: ['https://www.blackhatworld.com/forums/hire-a-freelancer.76/'],
    bhwLimitPerForum: 20,

    linkedinLimitPerKeyword: 10,

    upworkWatchEnabled: true,
    upworkJobsUrl: 'https://www.upwork.com/nx/find-work/most-recent',
    upworkFetchDetails: true,
    upworkMaxAgeHours: 5,
    upworkReloadMinMinutes: UPWORK_RELOAD_FLOOR_MINUTES,
    upworkReloadMaxMinutes: 15,
    upworkAlertDelayMinSeconds: 120,
    upworkAlertDelayMaxSeconds: 180,

    // Off until you have signed in to LinkedIn and pasted your own job search.
    linkedinWatchEnabled: false,
    // Past 24 hours, newest first. Any LinkedIn job search URL works here.
    linkedinJobsUrl:
      'https://www.linkedin.com/jobs/search-results/?keywords=software%20developer%2C%20remote&f_TPR=r86400',
    linkedinFetchDetails: true,
    linkedinMaxAgeHours: 24,
    linkedinReloadMinMinutes: LINKEDIN_RELOAD_FLOOR_MINUTES,
    linkedinReloadMaxMinutes: 15,
    linkedinAlertDelayMinSeconds: 120,
    linkedinAlertDelayMaxSeconds: 180,

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

// LinkedIn posts used to have a home-feed mode. Posts are always searched for
// now, so the settings that chose and tuned the feed are dropped.
{
  const legacy = configStore.data as unknown as Record<string, unknown>;
  if ('linkedinPostSource' in legacy || 'linkedinFeedScrolls' in legacy) {
    delete legacy.linkedinPostSource;
    delete legacy.linkedinFeedScrolls;
    configStore.save();
  }
}

// A file saved before the reload floor existed can still say "every 5
// minutes". Raise it rather than honour it — the floor is the point. The
// window moves up with it: 5–10 clamped to 10–10 would be a fixed interval,
// which is its own giveaway.
{
  const c = configStore.data;
  if (c.upworkReloadMinMinutes < UPWORK_RELOAD_FLOOR_MINUTES) {
    c.upworkReloadMinMinutes = UPWORK_RELOAD_FLOOR_MINUTES;
    c.upworkReloadMaxMinutes = Math.max(
      c.upworkReloadMaxMinutes,
      defaultConfig().upworkReloadMaxMinutes,
    );
  }
  c.upworkReloadMaxMinutes = Math.max(c.upworkReloadMinMinutes, c.upworkReloadMaxMinutes);

  if (c.linkedinReloadMinMinutes < LINKEDIN_RELOAD_FLOOR_MINUTES) {
    c.linkedinReloadMinMinutes = LINKEDIN_RELOAD_FLOOR_MINUTES;
  }
  c.linkedinReloadMaxMinutes = Math.max(c.linkedinReloadMinMinutes, c.linkedinReloadMaxMinutes);
}

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

/**
 * A lead you cleared, as it reads: kept in `data/cleared/<platform>.json`.
 *
 * Clearing empties the Leads page, but what people were asking for is still
 * worth having — read together, a few hundred cleared posts are a fair map of
 * the problems clients keep bringing to that platform. Only the words are
 * kept, so the file can be handed to anything (a spreadsheet, an LLM) as-is.
 */
export interface ClearedLead {
  title: string;
  description: string;
}

/**
 * What analytics needs to keep counting a lead after it is cleared: which
 * platform found it and when. One per cleared lead, never pruned — unlike
 * `dismissedStore`, which expires. The hash stops a lead cleared, restored,
 * found again and cleared again from being counted (or archived) twice.
 */
export interface ClearedStat {
  hash: string;
  platform: string;
  createdAt: string;
  clearedAt: string;
}

export const clearedStatsStore = registerForFlush(
  new JsonFile<ClearedStat[]>(file('cleared-stats.json'), () => []),
);

const clearedArchives = new Map<string, JsonFile<ClearedLead[]>>();

/** The cleared-lead archive for one platform, opened on first use. */
export function clearedArchive(platform: string): JsonFile<ClearedLead[]> {
  // Platform names come from our own enum; this is only belt and braces
  // against one ever becoming a path.
  const name = platform.toLowerCase().replace(/[^a-z0-9_-]/g, '') || 'other';
  let archive = clearedArchives.get(name);
  if (!archive) {
    archive = registerForFlush(
      new JsonFile<ClearedLead[]>(path.join(env.dataDir, 'cleared', `${name}.json`), () => []),
    );
    clearedArchives.set(name, archive);
  }
  return archive;
}

export const connectionsStore = registerForFlush(
  new JsonFile<Record<string, StoredConnection>>(file('connections.json'), () => ({})),
);

export const runsStore = registerForFlush(new JsonFile<ScrapeRun[]>(file('runs.json'), () => []));

export const notificationsStore = registerForFlush(
  new JsonFile<Notification[]>(file('notifications.json'), () => []),
);

/**
 * The New Opportunities feed: Upwork and LinkedIn job alerts, newest first.
 *
 * Kept apart from `leadsStore` on purpose. A lead is a record you work — you
 * archive it, bookmark it, mark it won. An opportunity is an *event*: this job
 * appeared at this time and reached you at that one. Storing the event
 * separately is what lets the panel keep saying "3 new since you last looked"
 * after you have archived every lead behind it.
 */
export const opportunitiesStore = registerForFlush(
  new JsonFile<Opportunity[]>(file('opportunities.json'), () => []),
);

/** History is for glancing at, not for archiving. Keep the lists bounded. */
export const MAX_RUNS = 200;
export const MAX_NOTIFICATIONS = 200;
export const MAX_OPPORTUNITIES = 300;

export function initStore(): void {
  logger.info(`Data directory: ${env.dataDir}`);
  logger.info(
    `Loaded ${leadsStore.data.length} lead(s), ` +
      `${Object.keys(connectionsStore.data).length} connection(s)`,
  );
}
