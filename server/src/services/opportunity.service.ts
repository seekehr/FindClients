import crypto from 'node:crypto';
import { MAX_OPPORTUNITIES, opportunitiesStore } from '../store';
import { relativeTime } from '../utils/time';
import { sanitizeText } from '../utils/text';
import type { AiVerdict, LeadDTO, Opportunity, OpportunityDTO, Platform } from '../types';

/**
 * The New Opportunities feed.
 *
 * This is the front end of the Upwork watcher: a chronological list of job
 * alerts, each one released after its human delay. It is deliberately thin —
 * no filtering, no pipeline, no statuses. The Leads pages do that work; this is
 * the thing you glance at to see what has come in while you were working.
 */

function toDTO(row: Opportunity): OpportunityDTO {
  return {
    ...row,
    alertedTime: relativeTime(row.alertedAt),
    postedTime: relativeTime(row.postedAt),
  };
}

export interface ListOpportunitiesParams {
  /** Only the ones you have not looked at yet. */
  unseenOnly?: boolean;
  limit?: number;
}

export function listOpportunities(params: ListOpportunitiesParams = {}) {
  const limit = Math.min(200, Math.max(1, params.limit ?? 50));
  const all = opportunitiesStore.data;
  const rows = params.unseenOnly ? all.filter((o) => !o.seen) : all;

  return {
    data: rows.slice(0, limit).map(toDTO),
    total: all.length,
    unseen: all.filter((o) => !o.seen).length,
  };
}

export function unseenOpportunityCount(): number {
  return opportunitiesStore.data.filter((o) => !o.seen).length;
}

export function markOpportunitySeen(id: string): void {
  const row = opportunitiesStore.data.find((o) => o.id === id);
  if (!row || row.seen) return;
  row.seen = true;
  opportunitiesStore.save();
}

export function markAllOpportunitiesSeen(): number {
  let changed = 0;
  for (const row of opportunitiesStore.data) {
    if (row.seen) continue;
    row.seen = true;
    changed += 1;
  }
  if (changed) opportunitiesStore.save();
  return changed;
}

/**
 * Empty the panel.
 *
 * Only the alert records go — the leads behind them stay exactly where they
 * are, so clearing the feed can never lose you a job. That is the whole reason
 * these are stored separately from leads in the first place.
 */
export function clearOpportunities(): number {
  const removed = opportunitiesStore.data.length;
  if (!removed) return 0;
  opportunitiesStore.data = [];
  return removed;
}

export interface RecordOpportunityInput {
  platform: Platform;
  lead: LeadDTO;
  /** When the watcher first saw it on the feed. */
  spottedAt: string;
  /** How long it was deliberately held before being released to you. */
  heldForSeconds: number;
  verdict?: AiVerdict | null;
  score?: number | null;
  /** One-line client summary, when the watcher managed to read one. */
  client?: string;
}

/** Add one job alert to the top of the feed. */
export function recordOpportunity(input: RecordOpportunityInput): OpportunityDTO {
  const { lead } = input;

  const row: Opportunity = {
    id: crypto.randomUUID(),
    platform: input.platform,
    leadId: lead.id,
    title: lead.title,
    url: lead.url,
    budget: lead.budget,
    client: sanitizeText(input.client ?? ''),
    tags: lead.tags.slice(0, 6),
    postedAt: lead.postedAt,
    spottedAt: input.spottedAt,
    alertedAt: new Date().toISOString(),
    heldForSeconds: Math.round(input.heldForSeconds),
    verdict: input.verdict ?? null,
    score: input.score ?? null,
    seen: false,
  };

  opportunitiesStore.data.unshift(row);
  if (opportunitiesStore.data.length > MAX_OPPORTUNITIES) {
    opportunitiesStore.data.length = MAX_OPPORTUNITIES;
  }
  opportunitiesStore.save();

  return toDTO(row);
}
