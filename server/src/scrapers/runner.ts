import { db } from '../db';
import { newId } from '../utils/ids';
import { nowIso } from '../utils/time';
import { logger } from '../utils/logger';
import { insertLeads } from '../services/lead.service';
import { notifyNewLeads } from '../services/notification.service';
import { getActiveScrapers } from './loader';
import type { LeadDTO } from '../types';
import type { Scraper } from './types';

let running = false;

interface RunSummary {
  totalFound: number;
  totalInserted: number;
  perPlatform: Record<string, { found: number; inserted: number; error?: string }>;
}

async function runOne(scraper: Scraper, limit: number): Promise<{ inserted: LeadDTO[]; found: number; error?: string }> {
  const runId = newId('run');
  const startedAt = nowIso();
  db.prepare(
    `INSERT INTO scrape_runs (id, platform, status, started_at) VALUES (?, ?, 'running', ?)`,
  ).run(runId, scraper.platform, startedAt);

  try {
    const raw = await scraper.scrape({
      limit,
      log: (msg) => logger.debug(`[${scraper.name}] ${msg}`),
    });
    const inserted = insertLeads(raw);
    db.prepare(
      `UPDATE scrape_runs SET status = 'success', found = ?, inserted = ?, finished_at = ? WHERE id = ?`,
    ).run(raw.length, inserted.length, nowIso(), runId);
    logger.info(`[${scraper.name}] found ${raw.length}, inserted ${inserted.length}`);
    return { inserted, found: raw.length };
  } catch (err) {
    const message = (err as Error).message ?? 'unknown error';
    db.prepare(
      `UPDATE scrape_runs SET status = 'error', error = ?, finished_at = ? WHERE id = ?`,
    ).run(message, nowIso(), runId);
    logger.error(`[${scraper.name}] failed`, message);
    return { inserted: [], found: 0, error: message };
  }
}

/**
 * Run every active scraper once. Guarded so overlapping schedules can't stack.
 */
export async function runScrapeCycle(limitPerScraper = 10): Promise<RunSummary> {
  if (running) {
    logger.warn('Scrape cycle already in progress — skipping this tick');
    return { totalFound: 0, totalInserted: 0, perPlatform: {} };
  }
  running = true;
  const summary: RunSummary = { totalFound: 0, totalInserted: 0, perPlatform: {} };
  const allNew: LeadDTO[] = [];

  try {
    const scrapers = await getActiveScrapers();
    for (const scraper of scrapers) {
      const { inserted, found, error } = await runOne(scraper, limitPerScraper);
      summary.perPlatform[scraper.platform] = { found, inserted: inserted.length, error };
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
