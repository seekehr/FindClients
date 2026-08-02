import { db } from '../db';
import type { Platform } from '../types';

interface CountRow {
  k: string;
  c: number;
}

/** Top-line dashboard metrics for a user. */
export function overview(userId: string) {
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const newLeads = (
    db.prepare('SELECT COUNT(*) AS c FROM leads WHERE posted_at >= ?').get(since24h) as {
      c: number;
    }
  ).c;

  const totalLeads = (db.prepare('SELECT COUNT(*) AS c FROM leads').get() as { c: number }).c;

  const bookmarked = (
    db
      .prepare('SELECT COUNT(*) AS c FROM user_leads WHERE user_id = ? AND bookmarked = 1')
      .get(userId) as { c: number }
  ).c;

  const statusRows = db
    .prepare('SELECT status AS k, COUNT(*) AS c FROM user_leads WHERE user_id = ? GROUP BY status')
    .all(userId) as CountRow[];
  const byStatus = Object.fromEntries(statusRows.map((r) => [r.k, r.c]));

  const contacted = byStatus.contacted ?? 0;
  const won = byStatus.won ?? 0;
  const conversionRate = contacted > 0 ? Math.round((won / contacted) * 100) : 0;

  const last7d = (
    db.prepare('SELECT COUNT(*) AS c FROM leads WHERE posted_at >= ?').get(since7d) as {
      c: number;
    }
  ).c;

  return {
    newLeads,
    totalLeads,
    bookmarked,
    contacted,
    won,
    conversionRate,
    last7d,
  };
}

/** Lead counts grouped by platform, with percentages. */
export function byPlatform() {
  const rows = db
    .prepare('SELECT platform AS k, COUNT(*) AS c FROM leads GROUP BY platform ORDER BY c DESC')
    .all() as CountRow[];
  const total = rows.reduce((sum, r) => sum + r.c, 0) || 1;
  return rows.map((r) => ({
    platform: r.k as Platform,
    count: r.c,
    percentage: Math.round((r.c / total) * 100),
  }));
}

/** New-leads-per-day for the last N days (for a trend chart). */
export function leadsTrend(days = 14) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const rows = db
    .prepare(
      `SELECT substr(posted_at, 1, 10) AS k, COUNT(*) AS c
       FROM leads WHERE posted_at >= ?
       GROUP BY k ORDER BY k ASC`,
    )
    .all(since) as CountRow[];
  return rows.map((r) => ({ date: r.k, count: r.c }));
}

/** Recent scraper runs (scraping history). */
export function recentScrapeRuns(limit = 20) {
  return db
    .prepare(
      `SELECT id, platform, status, found, inserted, error, started_at AS startedAt, finished_at AS finishedAt
       FROM scrape_runs ORDER BY started_at DESC LIMIT ?`,
    )
    .all(limit);
}
