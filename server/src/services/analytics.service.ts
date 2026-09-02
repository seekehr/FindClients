import crypto from 'node:crypto';
import { MAX_RUNS, leadsStore, runsStore } from '../store';
import type { Platform, ScrapeRun } from '../types';

/**
 * Dashboard numbers and the scrape history.
 *
 * All of it is computed from the two JSON files on every call. That is a full
 * pass over the leads array, which at a few thousand leads is well under a
 * millisecond — cheaper than the round trip to the SQL functions this replaced,
 * and it can never disagree with what the leads page is showing.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** Top-line dashboard metrics. */
export function overview() {
  const leads = leadsStore.data;
  const weekAgo = Date.now() - 7 * DAY_MS;

  const contacted = leads.filter((l) => l.status === 'contacted').length;
  const won = leads.filter((l) => l.status === 'won').length;

  return {
    newLeads: leads.filter((l) => l.status === 'new').length,
    totalLeads: leads.length,
    bookmarked: leads.filter((l) => l.bookmarked).length,
    contacted,
    won,
    conversionRate: contacted > 0 ? Math.round((won / contacted) * 100) : 0,
    last7d: leads.filter((l) => new Date(l.createdAt).getTime() >= weekAgo).length,
  };
}

/** Lead counts grouped by platform, with percentages. */
export function byPlatform() {
  const counts = new Map<string, number>();
  for (const lead of leadsStore.data) {
    counts.set(lead.platform, (counts.get(lead.platform) ?? 0) + 1);
  }

  const total = leadsStore.data.length || 1;
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([platform, count]) => ({
      platform: platform as Platform,
      count,
      percentage: Math.round((count / total) * 100),
    }));
}

/**
 * New leads per day for the last N days.
 *
 * Every day in the window is present, including the empty ones — a trend chart
 * that silently skips quiet days draws a misleading line.
 */
export function leadsTrend(days = 14) {
  const buckets = new Map<string, number>();
  const today = new Date();

  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date(today.getTime() - i * DAY_MS);
    buckets.set(d.toISOString().slice(0, 10), 0);
  }

  for (const lead of leadsStore.data) {
    const day = lead.createdAt.slice(0, 10);
    if (buckets.has(day)) buckets.set(day, (buckets.get(day) ?? 0) + 1);
  }

  return [...buckets.entries()].map(([date, count]) => ({ date, count }));
}

/**
 * A run left in 'running' for longer than this is assumed dead — the process
 * was killed mid-scrape and never got to close its record. Treating it as
 * active forever would pin a "scraping…" spinner in the UI permanently.
 */
const STALE_RUN_MS = 30 * 60 * 1000;

/** Whether a scrape is in flight right now, so the UI can say "finding leads". */
export function scrapeStatus() {
  const cutoff = Date.now() - STALE_RUN_MS;
  const active = runsStore.data.filter(
    (r) => r.status === 'running' && new Date(r.startedAt).getTime() > cutoff,
  );
  const lastFinished = runsStore.data.find((r) => r.finishedAt);

  return {
    running: active.length > 0,
    runs: active.map((r) => ({ id: r.id, platform: r.platform, startedAt: r.startedAt })),
    lastFinishedAt: lastFinished?.finishedAt ?? null,
  };
}

/** Recent scraper runs, newest first. */
export function recentScrapeRuns(limit = 20) {
  return runsStore.data.slice(0, limit);
}

/**
 * Open a run record before the scrape starts, so a run is visible in the UI
 * while it is still going and a crash leaves evidence that it happened.
 */
export function startRun(platform: string): ScrapeRun {
  const run: ScrapeRun = {
    id: crypto.randomUUID(),
    platform,
    status: 'running',
    found: 0,
    inserted: 0,
    error: null,
    startedAt: new Date().toISOString(),
    finishedAt: null,
  };

  // Newest first, so `recentScrapeRuns` is a slice rather than a sort.
  runsStore.data.unshift(run);
  if (runsStore.data.length > MAX_RUNS) runsStore.data.length = MAX_RUNS;
  runsStore.save();
  return run;
}

export function finishRun(
  id: string,
  patch: { status: 'success' | 'error'; found?: number; inserted?: number; error?: string },
): void {
  const run = runsStore.data.find((r) => r.id === id);
  if (!run) return;
  run.status = patch.status;
  run.found = patch.found ?? 0;
  run.inserted = patch.inserted ?? 0;
  run.error = patch.error ?? null;
  run.finishedAt = new Date().toISOString();
  runsStore.save();
}

/**
 * Close out runs left open by a process that died mid-scrape.
 *
 * Called once at startup: the browser those runs were driving is gone, so
 * nothing will ever finish them, and leaving them 'running' makes the UI claim
 * a scrape is in progress forever.
 */
export function closeStaleRuns(): number {
  let closed = 0;
  for (const run of runsStore.data) {
    if (run.status !== 'running') continue;
    run.status = 'error';
    run.error = 'Interrupted — the app stopped while this run was in progress.';
    run.finishedAt = new Date().toISOString();
    closed += 1;
  }
  if (closed) runsStore.save();
  return closed;
}
