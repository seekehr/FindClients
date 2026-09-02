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
import {
  getConnection,
  markCredentialError,
  markCredentialUsed,
} from '../services/credential.service';
import { loadScrapers } from './loader';
import { registerCaptcha } from '../services/captcha.service';
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
 */

async function review(leads: LeadDTO[], config: AppConfig, log: (msg: string) => void) {
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
  const cookies = getConnection(scraper.platform);
  if (!cookies) return { found: 0, inserted: [] };

  const run = startRun(scraper.platform);
  const log = (msg: string) => logger.info(`[${scraper.name}] ${msg}`);
  log('scrape started');

  try {
    let raw;
    try {
      raw = await scraper.scrape({
        config,
        cookies,
        limit: config.leadsPerRun,
        log,
        onCaptcha: (page, platform) => registerCaptcha(page, { platform }),
      });
    } catch (err) {
      markCredentialError(scraper.platform, (err as Error).message);
      throw err;
    }

    const { inserted, all } = insertLeads(raw);
    await review(all, config, log);

    finishRun(run.id, { status: 'success', found: raw.length, inserted: inserted.length });
    markCredentialUsed(scraper.platform);
    log(`scrape finished — found ${raw.length}, inserted ${inserted.length}`);
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

    const scrapers = await loadScrapers();
    const allNew: LeadDTO[] = [];

    for (const scraper of scrapers) {
      if (config.platforms.length && !config.platforms.includes(scraper.platform)) {
        summary.skipped.push(`${scraper.platform} (not enabled in your config)`);
        continue;
      }
      if (!getConnection(scraper.platform)) {
        summary.skipped.push(`${scraper.platform} (no account connected)`);
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
