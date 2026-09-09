import crypto from 'node:crypto';
import { DISMISS_TTL_MS, dismissedStore, leadsStore } from '../store';
import { sourceHash } from '../utils/ids';
import { relativeTime } from '../utils/time';
import { sanitizeMetadata, sanitizeNullable, sanitizeText } from '../utils/text';
import { badRequest } from '../utils/http';
import {
  LEAD_STATUSES,
  type AiVerdict,
  type Lead,
  type LeadDTO,
  type LeadStatus,
  type RawLead,
} from '../types';

/**
 * Leads, stored as one array in data/leads.json and filtered in memory.
 *
 * This replaced a Postgres pool joined to per-user rows through a plpgsql
 * function. With one person's leads on one machine, `Array.prototype.filter`
 * is both faster than the round trip it replaced and considerably easier to
 * be sure about.
 */

function toDTO(lead: Lead): LeadDTO {
  return { ...lead, postedTime: relativeTime(lead.postedAt) };
}

/** Newest first — the only order the UI ever wants. */
function byNewest(a: Lead, b: Lead): number {
  return new Date(b.postedAt).getTime() - new Date(a.postedAt).getTime();
}

export interface ListLeadsParams {
  platform?: string;
  q?: string;
  status?: string;
  bookmarked?: boolean;
  /** 'qualified' | 'rejected' | 'unchecked' */
  ai?: string;
  page?: number;
  limit?: number;
}

export function listLeads(params: ListLeadsParams) {
  const page = Math.max(1, params.page ?? 1);
  const limit = Math.min(100, Math.max(1, params.limit ?? 20));
  const needle = params.q?.trim().toLowerCase();

  const matched = leadsStore.data.filter((lead) => {
    if (params.platform && lead.platform !== params.platform) return false;
    if (params.status && lead.status !== params.status) return false;
    if (params.bookmarked && !lead.bookmarked) return false;

    if (params.ai === 'unchecked' && lead.ai.verdict !== null) return false;
    if (params.ai === 'qualified' && lead.ai.verdict !== 'qualified') return false;
    if (params.ai === 'rejected' && lead.ai.verdict !== 'rejected') return false;

    if (needle) {
      const haystack = [lead.title, lead.description, lead.author ?? '', lead.tags.join(' ')]
        .join(' ')
        .toLowerCase();
      if (!haystack.includes(needle)) return false;
    }
    return true;
  });

  matched.sort(byNewest);

  const total = matched.length;
  const start = (page - 1) * limit;

  return {
    data: matched.slice(start, start + limit).map(toDTO),
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) || 1 },
  };
}

function find(id: string): Lead | undefined {
  return leadsStore.data.find((lead) => lead.id === id);
}

export function getLead(id: string): LeadDTO | null {
  const lead = find(id);
  return lead ? toDTO(lead) : null;
}

export function setLeadStatus(id: string, status: LeadStatus) {
  if (!LEAD_STATUSES.includes(status)) throw badRequest(`Invalid status: ${status}`);
  const lead = find(id);
  if (!lead) return null;
  lead.status = status;
  lead.updatedAt = new Date().toISOString();
  leadsStore.save();
  return { status: lead.status, bookmarked: lead.bookmarked };
}

export function setBookmark(id: string, bookmarked: boolean) {
  const lead = find(id);
  if (!lead) return null;
  lead.bookmarked = bookmarked;
  lead.updatedAt = new Date().toISOString();
  leadsStore.save();
  return { status: lead.status, bookmarked: lead.bookmarked };
}

/** Cleared hashes that are still within their suppression window. */
function activeDismissals(): Set<string> {
  const cutoff = Date.now() - DISMISS_TTL_MS;
  const live = dismissedStore.data.filter((d) => new Date(d.at).getTime() > cutoff);

  // Prune on read, so the file cannot grow without bound.
  if (live.length !== dismissedStore.data.length) dismissedStore.data = live;

  return new Set(live.map((d) => d.hash));
}

/**
 * Have we seen this post before — as a stored lead, or as one you cleared?
 *
 * The watcher asks this before it queues an alert. Without it, every restart
 * would re-announce whatever is currently on the Upwork feed as brand new,
 * which is precisely the noise the whole delay-and-dedupe machinery exists to
 * avoid.
 */
export function isLeadKnown(platform: string, url: string | null | undefined, title: string): boolean {
  const hash = sourceHash(platform, url, title);
  if (leadsStore.data.some((lead) => lead.sourceHash === hash)) return true;
  return activeDismissals().has(hash);
}

export interface InsertLeadsResult {
  /** Leads that were genuinely new. Drives notifications. */
  inserted: LeadDTO[];
  /**
   * Every lead this batch referred to, new or not. A lead found last week but
   * never reviewed — because qualification was switched off at the time — is
   * still waiting for a verdict, so this is what the AI pass runs over.
   */
  all: LeadDTO[];
  /**
   * How many were skipped because you had cleared them.
   *
   * Reported so `found 25, inserted 0` cannot look like a broken scraper when
   * it is really the dismissal list doing its job.
   */
  skippedAsCleared: number;
}

/**
 * Store leads discovered by a scraper, skipping ones already known and ones
 * that were explicitly cleared away.
 */
export function insertLeads(raw: RawLead[]): InsertLeadsResult {
  if (!raw.length) return { inserted: [], all: [], skippedAsCleared: 0 };

  const now = new Date().toISOString();
  const byHash = new Map(leadsStore.data.map((lead) => [lead.sourceHash, lead]));
  const dismissed = activeDismissals();

  const inserted: Lead[] = [];
  const all: Lead[] = [];
  const seen = new Set<string>();
  let skippedAsCleared = 0;

  for (const r of raw) {
    const hash = sourceHash(r.platform, r.url, r.title);

    // One run can surface the same post twice (two keywords, one tweet).
    if (seen.has(hash)) continue;
    seen.add(hash);

    // Cleared away on purpose — do not drag it back in.
    if (dismissed.has(hash)) {
      skippedAsCleared += 1;
      continue;
    }

    const existing = byHash.get(hash);
    if (existing) {
      all.push(existing);
      continue;
    }

    // A scraper may report a date we cannot parse; fall back to "now" rather
    // than throwing and losing every other lead in the batch.
    const parsed = r.postedAt ? new Date(r.postedAt) : null;
    const postedAt = parsed && !Number.isNaN(parsed.getTime()) ? parsed.toISOString() : now;

    // Scraped text can contain a lone surrogate from slicing an emoji in half,
    // or a stray NUL. Left alone it would make the whole file unparseable on
    // the next boot, costing every lead in it.
    const lead: Lead = {
      id: crypto.randomUUID(),
      title: sanitizeText(r.title),
      platform: r.platform,
      description: sanitizeText(r.description ?? ''),
      budget: sanitizeNullable(r.budget),
      timeline: sanitizeNullable(r.timeline),
      url: sanitizeNullable(r.url),
      author: sanitizeNullable(r.author),
      tags: (r.tags ?? []).map(sanitizeText),
      metadata: sanitizeMetadata(r.metadata),
      sourceHash: hash,
      postedAt,
      createdAt: now,
      updatedAt: now,
      status: 'new',
      bookmarked: false,
      ai: { verdict: null, score: null, reason: '', model: '', checkedAt: null },
    };

    leadsStore.data.push(lead);
    byHash.set(hash, lead);
    inserted.push(lead);
    all.push(lead);
  }

  if (inserted.length) leadsStore.save();

  return { inserted: inserted.map(toDTO), all: all.map(toDTO), skippedAsCleared };
}

/** Which of these leads already carry a verdict? */
export function leadsAlreadyReviewed(leadIds: string[]): Set<string> {
  const wanted = new Set(leadIds);
  return new Set(
    leadsStore.data
      .filter((lead) => wanted.has(lead.id) && lead.ai.checkedAt !== null)
      .map((lead) => lead.id),
  );
}

export interface AiReviewToSave {
  leadId: string;
  verdict: AiVerdict;
  score: number | null;
  reason: string;
  model: string;
  /** Park rejected leads in the archive instead of the inbox. */
  archive: boolean;
}

/**
 * Record AI verdicts. A verdict is extra information about a lead, not a reset
 * of it: a lead already bookmarked or moved along the pipeline keeps that.
 */
export function saveAiReviews(reviews: AiReviewToSave[]): void {
  if (!reviews.length) return;
  const now = new Date().toISOString();
  let changed = false;

  for (const review of reviews) {
    const lead = find(review.leadId);
    if (!lead) continue;

    lead.ai = {
      verdict: review.verdict,
      score: review.score,
      reason: sanitizeText(review.reason),
      model: review.model,
      checkedAt: now,
    };

    // Only archive a lead you have not touched. Marking one "contacted" is
    // overruling the model by acting on it.
    if (review.archive && review.verdict === 'rejected' && lead.status === 'new') {
      lead.status = 'archived';
    }
    lead.updatedAt = now;
    changed = true;
  }

  if (changed) leadsStore.save();
}

/**
 * Clear every lead except bookmarks.
 *
 * Their source hashes are remembered so the next scrape does not simply find
 * the same posts and put them all back.
 */
export function clearLeads(): number {
  const keep: Lead[] = [];
  const now = new Date().toISOString();
  const dismissed = new Map(dismissedStore.data.map((d) => [d.hash, d]));

  for (const lead of leadsStore.data) {
    if (lead.bookmarked) keep.push(lead);
    else dismissed.set(lead.sourceHash, { hash: lead.sourceHash, at: now });
  }

  const removed = leadsStore.data.length - keep.length;
  if (!removed) return 0;

  leadsStore.data = keep;
  dismissedStore.data = [...dismissed.values()];
  return removed;
}

/** Forget every dismissal, so cleared leads can be found again. */
export function restoreClearedLeads(): number {
  const count = dismissedStore.data.length;
  dismissedStore.data = [];
  return count;
}

export function totalLeadCount(): number {
  return leadsStore.data.length;
}
