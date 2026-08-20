import { supabase } from '../db/supabase';
import { logger } from '../utils/logger';
import {
  insertLeads,
  leadsAlreadyReviewed,
  saveAiReviews,
  type AiReviewToSave,
} from '../services/lead.service';
import { qualifyLeads } from '../services/ai.service';
import { notifyNewLeads } from '../services/notification.service';
import { getConfig } from '../services/config.service';
import {
  getConnectionsForPlatform,
  markCredentialError,
  markCredentialUsed,
} from '../services/credential.service';
import { loadUserScrapers } from './loader';
import type { LeadDTO, RawLead, SessionCookie, UserConfig } from '../types';
import type { Scraper } from './types';

async function reviewForUser(
  userId: string,
  leads: LeadDTO[],
  config: UserConfig,
  log: (msg: string) => void,
): Promise<void> {
  if (!config.aiEnabled || !leads.length) return;

  const alreadyDone = await leadsAlreadyReviewed(userId, leads.map((l) => l.id));
  const toReview = leads.filter((l) => !alreadyDone.has(l.id));
  if (!toReview.length) return;

  const verdicts = await qualifyLeads(toReview, config, log);
  if (!verdicts.size) return;

  const rows: AiReviewToSave[] = [];
  for (const [leadId, review] of verdicts) {
    rows.push({
      leadId,
      verdict: review.verdict,
      score: review.score,
      reason: review.reason,
      model: review.model,
      archive: config.aiAutoArchive,
    });
  }

  await saveAiReviews(userId, rows);
}

let running = false;

interface RunSummary {
  totalFound: number;
  totalInserted: number;
  perPlatform: Record<string, { runs: number; found: number; inserted: number }>;
  skipped: number;
}

export interface RunOptions {
  /** Limit the cycle to one user (the manual "Scrape now" button). */
  userId?: string;
}

async function runOne(
  scraper: Scraper,
  userId: string,
  cookies: SessionCookie[],
  config: UserConfig,
): Promise<{ inserted: LeadDTO[]; found: number; error?: string }> {
  // Open the audit row first so a run is visible while it is still going.
  // A failure here must not stop the scrape, but it must not be silent either —
  // without the row there is no record that the run ever happened.
  const { data: run, error: runError } = await supabase
    .from('scrape_runs')
    .insert({ user_id: userId, platform: scraper.platform, status: 'running' })
    .select('id')
    .single();

  if (runError) {
    logger.error(
      `[${scraper.name}] could not record a scrape run for ${userId}: ${runError.message}`,
      runError.details ?? runError.hint ?? '',
    );
  }
  const runId = (run as { id: string } | null)?.id;

  logger.info(`[${scraper.name}] scrape started`);

  try {
    let raw: RawLead[];
    try {
      raw = await scraper.scrape({
        userId,
        cookies,
        limit: config.leadsPerRun,
        log: (msg) => logger.info(`[${scraper.name}] ${msg}`),
      });
    } catch (err) {
      await markCredentialError(userId, scraper.platform, (err as Error).message);
      throw err;
    }

    const { inserted, all } = await insertLeads(raw);

    await reviewForUser(userId, all, config, () => {});

    if (runId) {
      const { error } = await supabase
        .from('scrape_runs')
        .update({
          status: 'success',
          found: raw.length,
          inserted: inserted.length,
          finished_at: new Date().toISOString(),
        })
        .eq('id', runId);
      if (error) logger.error(`Could not close scrape run ${runId}: ${error.message}`);
    }
    await markCredentialUsed(userId, scraper.platform);
    logger.info(`[${scraper.name}] scrape finished — found ${raw.length}, inserted ${inserted.length}`);
    return { inserted, found: raw.length };
  } catch (err) {
    const message = (err as Error).message ?? 'unknown error';
    if (runId) {
      const { error } = await supabase
        .from('scrape_runs')
        .update({ status: 'error', error: message, finished_at: new Date().toISOString() })
        .eq('id', runId);
      if (error) logger.error(`Could not close scrape run ${runId}: ${error.message}`);
    }
    logger.error(`[${scraper.name}] scrape failed`, message);
    return { inserted: [], found: 0, error: message };
  }
}

/**
 * Run every scraper for every user who has connected that platform, using that
 * user's own configuration (keywords, limits, platform selection, tuning).
 * Leads flow into the shared pool, de-duplicated by source_hash; notifications
 * then fan out to each user by their own filters.
 */
export async function runScrapeCycle(options: RunOptions = {}): Promise<RunSummary> {
  if (running) {
    logger.warn('Scrape cycle already in progress — skipping this tick');
    return { totalFound: 0, totalInserted: 0, perPlatform: {}, skipped: 0 };
  }
  running = true;

  const summary: RunSummary = { totalFound: 0, totalInserted: 0, perPlatform: {}, skipped: 0 };
  const allNew: LeadDTO[] = [];
  // One config read per user per cycle, not per scraper.
  const configs = new Map<string, UserConfig>();

  async function configFor(userId: string): Promise<UserConfig | null> {
    if (!configs.has(userId)) {
      try {
        configs.set(userId, await getConfig(userId));
      } catch (err) {
        logger.warn(`Could not load config for ${userId}`, (err as Error).message);
        return null;
      }
    }
    return configs.get(userId) ?? null;
  }

  try {
    const scrapers = await loadUserScrapers();

    async function runScraper(scraper: Scraper) {
      let connections = await getConnectionsForPlatform(scraper.platform);
      if (options.userId) connections = connections.filter((c) => c.userId === options.userId);

      const bucket = { runs: 0, found: 0, inserted: 0 };
      summary.perPlatform[scraper.platform] = bucket;

      if (!connections.length) return;

      for (const conn of connections) {
        const config = await configFor(conn.userId);
        if (!config) {
          summary.skipped += 1;
          continue;
        }

        if (!config.scrapeEnabled) {
          summary.skipped += 1;
          continue;
        }
        if (config.platforms.length && !config.platforms.includes(scraper.platform)) {
          summary.skipped += 1;
          continue;
        }

        const { inserted, found } = await runOne(scraper, conn.userId, conn.cookies, config);
        bucket.runs += 1;
        bucket.found += found;
        bucket.inserted += inserted.length;
        summary.totalFound += found;
        summary.totalInserted += inserted.length;
        allNew.push(...inserted);
      }
    }

    await Promise.all(scrapers.map(runScraper));

    if (allNew.length) await notifyNewLeads(allNew);
  } finally {
    running = false;
  }

  return summary;
}
