import { logStackInDev, logger } from '../utils/logger';
import {
  insertLeads,
  leadsAlreadyReviewed,
  saveAiReviews,
  type AiReviewToSave,
} from '../services/lead.service';
import { qualifyLeads } from '../services/ai.service';
import { notifyNewLeads } from '../services/notification.service';
import { finishRun, startRun } from '../services/analytics.service';
import { getAiApiKey, getConfig } from '../services/config.service';
import { isConnected, markError, markUsed } from '../services/connection.service';
import { loadBulkScrapers } from './loader';
import { resumeWatcher, suspendWatcher } from '../watcher';
import { env } from '../config/env';
import type { AppConfig, LeadDTO } from '../types';
import type { Scraper } from './types';

/**
 * One scrape cycle: run every enabled scraper you have connected an account
 * for, store what they find, qualify it, and announce it.
 *
 * Scrapers run one after another rather than in parallel. Each one drives its
 * own Chromium instance, and two of those competing for the machine you are
 * working on is the difference between a background task and a laptop that
 * stops responding.
 *
 * Upwork is not in here and cannot be. It is a watch-mode platform: bulk
 * collection is what gets Upwork accounts banned, so it is handled by the
 * long-lived watcher in ../watcher/ instead, one open tab at a time. See
 * `Scraper.mode` in ./types.ts.
 *
 * LinkedIn is in here for its *posts* only. Its jobs are watched the same way
 * Upwork's are, by the watcher, never by this cycle.
 */

/**
 * Run AI qualification over a batch of leads and store the verdicts.
 *
 * Scraped leads only. Upwork alerts skip it: the watched feed is already the
 * user's own tuned search.
 *
 * @returns the ids of the leads the review rejected, so they are not announced.
 */
async function reviewLeads(
  leads: LeadDTO[],
  config: AppConfig,
  log: (msg: string) => void,
): Promise<Set<string>> {
  const rejected = new Set<string>();
  if (!config.aiEnabled || !leads.length) return rejected;

  const alreadyDone = leadsAlreadyReviewed(leads.map((l) => l.id));
  const toReview = leads.filter((l) => !alreadyDone.has(l.id));
  if (!toReview.length) return rejected;

  // Read the key only when there is actually something to review, so it is
  // never held in memory during the scrape itself.
  const verdicts = await qualifyLeads(toReview, config, getAiApiKey(), log);

  const rows: AiReviewToSave[] = [];
  for (const [leadId, verdict] of verdicts) {
    // A skipped lead is left unchecked, so a pass after the pause reviews it.
    if (verdict.verdict === 'skipped') continue;
    if (verdict.verdict === 'rejected') rejected.add(leadId);
    rows.push({
      leadId,
      verdict: verdict.verdict,
      score: verdict.score,
      reason: verdict.reason,
      model: verdict.model,
      archive: config.aiAutoArchive,
    });
  }

  saveAiReviews(rows);
  return rejected;
}

let running = false;

export interface RunSummary {
  totalFound: number;
  totalInserted: number;
  perPlatform: Record<string, { found: number; inserted: number }>;
  skipped: string[];
}

/**
 * Borrow a platform's browser profile from its job watcher for one scrape.
 *
 * Only when FindClients launches its own browsers: a launched profile can be
 * open in one process at a time, and LinkedIn's posts and LinkedIn's job tab
 * share one. Attached to your own Chrome there is nothing to borrow — the
 * scrape opens its own tab beside the watcher's — so the job alerts carry on.
 */
async function withWatcherPaused<T>(platform: string, fn: () => Promise<T>): Promise<T> {
  const paused = env.chromeCdpUrl ? false : await suspendWatcher(platform);
  try {
    return await fn();
  } finally {
    if (paused) resumeWatcher(platform, 'scrape finished');
  }
}

/**
 * What one scraper run produced: everything it stored, and the part of that
 * worth announcing — the AI's rejects are stored (and archived) but not sent.
 */
interface RunOutcome {
  found: number;
  inserted: LeadDTO[];
  toNotify: LeadDTO[];
}

async function runOne(scraper: Scraper, config: AppConfig): Promise<RunOutcome> {
  const run = startRun(scraper.platform);
  const log = (msg: string) => logger.info(`[${scraper.name}] ${msg}`);
  log('scrape started');

  try {
    let raw;
    try {
      raw = await withWatcherPaused(scraper.platform, () =>
        scraper.scrape!({
          config,
          limit: config.leadsPerRun,
          log,
          interactive: env.captchaOpenWindow,
          captchaTimeoutMs: env.captchaTimeoutMs,
        }),
      );
    } catch (err) {
      markError(scraper.platform, (err as Error).message);
      throw err;
    }

    const { inserted, all, skippedAsCleared } = insertLeads(raw);
    const rejected = await reviewLeads(all, config, log);
    const toNotify = inserted.filter((lead) => !rejected.has(lead.id));

    finishRun(run.id, { status: 'success', found: raw.length, inserted: inserted.length });
    markUsed(scraper.platform);
    log(
      `scrape finished — found ${raw.length}, inserted ${inserted.length}` +
        // Otherwise "found 25, inserted 0" reads as a broken scraper when it is
        // really every result having been cleared away earlier.
        (skippedAsCleared ? `, skipped ${skippedAsCleared} you had cleared` : '') +
        (inserted.length > toNotify.length ? `, ${inserted.length - toNotify.length} rejected by AI review (not announced)` : ''),
    );
    return { found: raw.length, inserted, toNotify };
  } catch (err) {
    const message = (err as Error).message ?? 'unknown error';
    finishRun(run.id, { status: 'error', error: message });
    logger.error(`[${scraper.name}] scrape failed`, message);
    logStackInDev(env.devMode, `[${scraper.name}] scrape failed`, err);
    return { found: 0, inserted: [], toNotify: [] };
  }
}

export async function runScrapeCycle(): Promise<RunSummary> {
  const summary: RunSummary = {
    totalFound: 0,
    totalInserted: 0,
    perPlatform: {},
    skipped: [],
  };

  if (running) {
    logger.warn('A scrape is already in progress — skipping this one');
    return summary;
  }
  running = true;

  try {
    const config = getConfig();

    if (!config.scrapeEnabled) {
      logger.info('Scraping is switched off in your config — nothing to do');
      return summary;
    }

    // Bulk scrapers only. Watch-mode platforms — Upwork — are owned by the
    // watcher and must never be pulled through a cycle; see `loadBulkScrapers`.
    // LinkedIn is here for its posts; its jobs stay with the watcher.
    const scrapers = await loadBulkScrapers();
    const allNew: LeadDTO[] = [];

    for (const scraper of scrapers) {
      if (config.platforms.length && !config.platforms.includes(scraper.platform)) {
        summary.skipped.push(`${scraper.platform} (not enabled in your config)`);
        continue;
      }
      if (scraper.requiresSignIn !== false && !isConnected(scraper.platform)) {
        summary.skipped.push(`${scraper.platform} (not signed in)`);
        continue;
      }

      const { found, inserted, toNotify } = await runOne(scraper, config);
      summary.perPlatform[scraper.platform] = { found, inserted: inserted.length };
      summary.totalFound += found;
      summary.totalInserted += inserted.length;
      allNew.push(...toNotify);
    }

    if (allNew.length) await notifyNewLeads(allNew);
  } finally {
    running = false;
  }

  return summary;
}

/** Whether a cycle is in flight, for the manual "Scrape now" button. */
export function isScraping(): boolean {
  return running;
}
