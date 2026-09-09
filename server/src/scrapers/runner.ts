import { logger } from '../utils/logger';
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
 */

/**
 * Run AI qualification over a batch of leads and store the verdicts.
 *
 * Exported because the Upwork watcher needs exactly this, one lead at a time,
 * at the moment it releases an alert — a job the model rejects should never
 * reach the New Opportunities panel in the first place.
 */
export async function reviewLeads(
  leads: LeadDTO[],
  config: AppConfig,
  log: (msg: string) => void,
): Promise<void> {
  if (!config.aiEnabled || !leads.length) return;

  const alreadyDone = leadsAlreadyReviewed(leads.map((l) => l.id));
  const toReview = leads.filter((l) => !alreadyDone.has(l.id));
  if (!toReview.length) return;

  // Read the key only when there is actually something to review, so it is
  // never held in memory during the scrape itself.
  const verdicts = await qualifyLeads(toReview, config, getAiApiKey(), log);
  if (!verdicts.size) return;

  const rows: AiReviewToSave[] = [];
  for (const [leadId, verdict] of verdicts) {
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
}

let running = false;

export interface RunSummary {
  totalFound: number;
  totalInserted: number;
  perPlatform: Record<string, { found: number; inserted: number }>;
  skipped: string[];
}

async function runOne(scraper: Scraper, config: AppConfig): Promise<{ found: number; inserted: LeadDTO[] }> {
  const run = startRun(scraper.platform);
  const log = (msg: string) => logger.info(`[${scraper.name}] ${msg}`);
  log('scrape started');

  try {
    let raw;
    try {
      raw = await scraper.scrape!({
        config,
        limit: config.leadsPerRun,
        log,
        interactive: env.captchaOpenWindow,
        captchaTimeoutMs: env.captchaTimeoutMs,
      });
    } catch (err) {
      markError(scraper.platform, (err as Error).message);
      throw err;
    }

    const { inserted, all, skippedAsCleared } = insertLeads(raw);
    await reviewLeads(all, config, log);

    finishRun(run.id, { status: 'success', found: raw.length, inserted: inserted.length });
    markUsed(scraper.platform);
    log(
      `scrape finished — found ${raw.length}, inserted ${inserted.length}` +
        // Otherwise "found 25, inserted 0" reads as a broken scraper when it is
        // really every result having been cleared away earlier.
        (skippedAsCleared ? `, skipped ${skippedAsCleared} you had cleared` : ''),
    );
    return { found: raw.length, inserted };
  } catch (err) {
    const message = (err as Error).message ?? 'unknown error';
    finishRun(run.id, { status: 'error', error: message });
    logger.error(`[${scraper.name}] scrape failed`, message);
    return { found: 0, inserted: [] };
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
    const scrapers = await loadBulkScrapers();
    const allNew: LeadDTO[] = [];

    for (const scraper of scrapers) {
      if (config.platforms.length && !config.platforms.includes(scraper.platform)) {
        summary.skipped.push(`${scraper.platform} (not enabled in your config)`);
        continue;
      }
      if (!isConnected(scraper.platform)) {
        summary.skipped.push(`${scraper.platform} (not signed in)`);
        continue;
      }

      const { found, inserted } = await runOne(scraper, config);
      summary.perPlatform[scraper.platform] = { found, inserted: inserted.length };
      summary.totalFound += found;
      summary.totalInserted += inserted.length;
      allNew.push(...inserted);
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
