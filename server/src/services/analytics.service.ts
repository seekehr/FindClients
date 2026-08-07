import { supabase, unwrap } from '../db/supabase';
import type { Platform } from '../types';

/** Top-line dashboard metrics for a user. */
export async function overview(userId: string) {
  const rows = unwrap(
    await supabase.rpc('analytics_overview', { p_user_id: userId }),
    'loading your analytics',
  ) as {
    new_leads: number;
    total_leads: number;
    bookmarked: number;
    contacted: number;
    won: number;
    last_7d: number;
  }[];

  const r = rows[0] ?? {
    new_leads: 0,
    total_leads: 0,
    bookmarked: 0,
    contacted: 0,
    won: 0,
    last_7d: 0,
  };

  const contacted = Number(r.contacted);
  const won = Number(r.won);

  return {
    newLeads: Number(r.new_leads),
    totalLeads: Number(r.total_leads),
    bookmarked: Number(r.bookmarked),
    contacted,
    won,
    conversionRate: contacted > 0 ? Math.round((won / contacted) * 100) : 0,
    last7d: Number(r.last_7d),
  };
}

/** Lead counts grouped by platform, with percentages. */
export async function byPlatform() {
  const rows = unwrap(
    await supabase.rpc('leads_by_platform'),
    'loading platform breakdown',
  ) as { platform: string; count: number }[];

  const total = rows.reduce((sum, r) => sum + Number(r.count), 0) || 1;
  return rows.map((r) => ({
    platform: r.platform as Platform,
    count: Number(r.count),
    percentage: Math.round((Number(r.count) / total) * 100),
  }));
}

/** New-leads-per-day for the last N days (for a trend chart). */
export async function leadsTrend(days = 14) {
  const rows = unwrap(
    await supabase.rpc('leads_trend', { p_days: days }),
    'loading the lead trend',
  ) as { day: string; count: number }[];
  return rows.map((r) => ({ date: r.day, count: Number(r.count) }));
}

/**
 * A run left in 'running' for longer than this is assumed dead — the process
 * was killed mid-scrape and never got to close its row. Treating it as active
 * forever would pin a "scraping…" spinner in the UI permanently.
 */
const STALE_RUN_MS = 30 * 60 * 1000;

/**
 * Whether a scrape is currently in flight for this user, so the UI can say
 * "finding leads" instead of "no leads yet".
 */
export async function scrapeStatus(userId: string) {
  const rows = unwrap(
    await supabase
      .from('scrape_runs')
      .select('id, platform, status, started_at, finished_at')
      .eq('user_id', userId)
      .order('started_at', { ascending: false })
      .limit(20),
    'checking scrape status',
  ) as {
    id: string;
    platform: string;
    status: string;
    started_at: string;
    finished_at: string | null;
  }[];

  const cutoff = Date.now() - STALE_RUN_MS;
  const active = rows.filter(
    (r) => r.status === 'running' && new Date(r.started_at).getTime() > cutoff,
  );

  const lastFinished = rows.find((r) => r.finished_at);

  return {
    running: active.length > 0,
    runs: active.map((r) => ({
      id: r.id,
      platform: r.platform,
      startedAt: r.started_at,
    })),
    lastFinishedAt: lastFinished?.finished_at ?? null,
  };
}

/**
 * Recent scraper runs (scraping history). Scoped to one user — runs are
 * per-connected-account, so another user's runs are none of your business.
 */
export async function recentScrapeRuns(userId: string, limit = 20) {
  const rows = unwrap(
    await supabase
      .from('scrape_runs')
      .select('id, platform, status, found, inserted, error, started_at, finished_at')
      .eq('user_id', userId)
      .order('started_at', { ascending: false })
      .limit(limit),
    'loading scrape history',
  ) as {
    id: string;
    platform: string;
    status: string;
    found: number;
    inserted: number;
    error: string | null;
    started_at: string;
    finished_at: string | null;
  }[];

  return rows.map((r) => ({
    id: r.id,
    platform: r.platform,
    status: r.status,
    found: r.found,
    inserted: r.inserted,
    error: r.error,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
  }));
}
