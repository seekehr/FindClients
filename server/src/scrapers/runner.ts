import { supabase } from '../db/supabase';
import { logger } from '../utils/logger';
import { insertLeads } from '../services/lead.service';
import { notifyNewLeads } from '../services/notification.service';
import { getConfig } from '../services/config.service';
import {
  getConnectionsForPlatform,
  markCredentialError,
  markCredentialUsed,
} from '../services/credential.service';
import { loadUserScrapers } from './loader';
import type { LeadDTO, SessionCookie, UserConfig } from '../types';
import type { Scraper } from './types';

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
  const { data: run } = await supabase
    .from('scrape_runs')
    .insert({ user_id: userId, platform: scraper.platform, status: 'running' })
    .select('id')
    .single();
  const runId = (run as { id: string } | null)?.id;

  try {
    const raw = await scraper.scrape({
      userId,
      cookies,
      config,
      limit: config.leadsPerRun,
      log: (msg) => logger.debug(`[${scraper.name}:${userId}] ${msg}`),
    });
    const inserted = await insertLeads(raw);

    if (runId) {
      await supabase
        .from('scrape_runs')
        .update({
          status: 'success',
          found: raw.length,
          inserted: inserted.length,
          finished_at: new Date().toISOString(),
        })
        .eq('id', runId);
    }
    await markCredentialUsed(userId, scraper.platform);
    logger.info(
      `[${scraper.name}] user ${userId}: found ${raw.length}, inserted ${inserted.length}`,
    );
    return { inserted, found: raw.length };
  } catch (err) {
    const message = (err as Error).message ?? 'unknown error';
    if (runId) {
      await supabase
        .from('scrape_runs')
        .update({ status: 'error', error: message, finished_at: new Date().toISOString() })
        .eq('id', runId);
    }
    await markCredentialError(userId, scraper.platform, message);
    logger.error(`[${scraper.name}] user ${userId} failed`, message);
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

    for (const scraper of scrapers) {
      let connections = await getConnectionsForPlatform(scraper.platform);
      if (options.userId) connections = connections.filter((c) => c.userId === options.userId);

      const bucket = { runs: 0, found: 0, inserted: 0 };
      summary.perPlatform[scraper.platform] = bucket;

      if (!connections.length) {
        logger.debug(`[${scraper.name}] no connected users — nothing to scrape`);
        continue;
      }

      for (const conn of connections) {
        const config = await configFor(conn.userId);
        if (!config) {
          summary.skipped += 1;
          continue;
        }

        // Honour the user's own switches: scraping off, or this platform not
        // selected on their Config page, means no run on their behalf.
        if (!config.scrapeEnabled) {
          logger.debug(`[${scraper.name}] user ${conn.userId} has scraping disabled — skipping`);
          summary.skipped += 1;
          continue;
        }
        if (config.platforms.length && !config.platforms.includes(scraper.platform)) {
          logger.debug(`[${scraper.name}] user ${conn.userId} has not selected this platform`);
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

    if (allNew.length) await notifyNewLeads(allNew);
  } finally {
    running = false;
  }

  return summary;
}
