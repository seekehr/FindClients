import { supabase, unwrap } from '../db/supabase';
import { cache } from '../cache';
import { sourceHash } from '../utils/ids';
import { relativeTime } from '../utils/time';
import { sanitizeMetadata, sanitizeNullable, sanitizeText } from '../utils/text';
import { badRequest } from '../utils/http';
import type {
  AiVerdict,
  LeadDTO,
  LeadMetadata,
  LeadRow,
  LeadStatus,
  Platform,
  RawLead,
} from '../types';

const VALID_STATUS: LeadStatus[] = ['new', 'viewed', 'contacted', 'won', 'archived'];

/** One row as returned by the list_leads / get_lead SQL functions. */
interface LeadWithUserState {
  id: string;
  title: string;
  platform: Platform;
  description: string;
  budget: string | null;
  timeline: string | null;
  url: string | null;
  author: string | null;
  tags: string[] | null;
  metadata: LeadMetadata | null;
  posted_at: string;
  created_at: string;
  status: LeadStatus;
  bookmarked: boolean;
  ai_verdict: AiVerdict | null;
  ai_score: number | null;
  ai_reason: string | null;
  ai_checked_at: string | null;
  total_count?: number;
}

function toDTO(row: LeadWithUserState): LeadDTO {
  return {
    id: row.id,
    title: row.title,
    platform: row.platform,
    description: row.description,
    budget: row.budget,
    timeline: row.timeline,
    url: row.url,
    author: row.author,
    tags: row.tags ?? [],
    metadata: row.metadata ?? {},
    postedAt: row.posted_at,
    postedTime: relativeTime(row.posted_at),
    status: row.status ?? 'new',
    bookmarked: row.bookmarked ?? false,
    ai: {
      verdict: row.ai_verdict ?? null,
      score: row.ai_score ?? null,
      reason: row.ai_reason ?? '',
      checkedAt: row.ai_checked_at ?? null,
    },
    createdAt: row.created_at,
  };
}

export interface ListLeadsParams {
  userId: string;
  platform?: string;
  q?: string;
  status?: string;
  bookmarked?: boolean;
  /** 'qualified' | 'rejected' | 'unchecked' — this user's AI verdict. */
  ai?: string;
  page?: number;
  limit?: number;
}

export async function listLeads(params: ListLeadsParams) {
  const page = Math.max(1, params.page ?? 1);
  const limit = Math.min(100, Math.max(1, params.limit ?? 20));

  const rows = unwrap(
    await supabase.rpc('list_leads', {
      p_user_id: params.userId,
      p_platform: params.platform ?? null,
      p_status: params.status ?? null,
      p_q: params.q ?? null,
      p_bookmarked: params.bookmarked ?? false,
      p_ai: params.ai ?? null,
      p_limit: limit,
      p_offset: (page - 1) * limit,
    }),
    'listing leads',
  ) as LeadWithUserState[];

  // total_count is a window function over the filtered set, so it is the same
  // on every row and absent only when the page is empty.
  const total = rows.length ? Number(rows[0].total_count ?? 0) : 0;

  return {
    data: rows.map(toDTO),
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) || 1 },
  };
}

export async function getLead(userId: string, id: string): Promise<LeadDTO | null> {
  // A malformed id would make Postgres reject the uuid cast; treat it as absent.
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;

  const rows = unwrap(
    await supabase.rpc('get_lead', { p_user_id: userId, p_lead_id: id }),
    'loading a lead',
  ) as LeadWithUserState[];
  return rows.length ? toDTO(rows[0]) : null;
}

async function upsertUserLead(
  userId: string,
  leadId: string,
  patch: { status?: LeadStatus; bookmarked?: boolean },
) {
  const { data: existing } = await supabase
    .from('user_leads')
    .select('status, bookmarked')
    .eq('user_id', userId)
    .eq('lead_id', leadId)
    .maybeSingle();

  const current = existing as { status: LeadStatus; bookmarked: boolean } | null;
  const status = patch.status ?? current?.status ?? 'new';
  const bookmarked = patch.bookmarked ?? current?.bookmarked ?? false;

  unwrap(
    await supabase
      .from('user_leads')
      .upsert(
        { user_id: userId, lead_id: leadId, status, bookmarked, updated_at: new Date().toISOString() },
        { onConflict: 'user_id,lead_id' },
      )
      .select('status, bookmarked')
      .single(),
    'saving your lead',
  );

  cache.invalidatePrefix(`leads:${userId}`);
  return { status, bookmarked };
}

export function setLeadStatus(userId: string, leadId: string, status: LeadStatus) {
  if (!VALID_STATUS.includes(status)) throw badRequest(`Invalid status: ${status}`);
  return upsertUserLead(userId, leadId, { status });
}

export function setBookmark(userId: string, leadId: string, bookmarked: boolean) {
  return upsertUserLead(userId, leadId, { bookmarked });
}

/** A lead row as it comes back from the pool, before per-user state exists. */
function rowToFreshDTO(row: LeadRow): LeadDTO {
  return {
    id: row.id,
    title: row.title,
    platform: row.platform,
    description: row.description,
    budget: row.budget,
    timeline: row.timeline,
    url: row.url,
    author: row.author,
    tags: row.tags ?? [],
    metadata: row.metadata ?? {},
    postedAt: row.posted_at,
    postedTime: relativeTime(row.posted_at),
    status: 'new',
    bookmarked: false,
    ai: { verdict: null, score: null, reason: '', checkedAt: null },
    createdAt: row.created_at,
  };
}

export interface InsertLeadsResult {
  /** Leads that were not already in the shared pool. Drives notifications. */
  inserted: LeadDTO[];
  /**
   * Every lead this batch referred to, new or not. A lead another user's
   * scrape found yesterday is still new *to this user*, so this is what the
   * per-user AI qualification pass runs over.
   */
  all: LeadDTO[];
}

/**
 * Insert leads discovered by a scraper, skipping ones already in the pool.
 *
 * De-duplication is the source_hash unique index: `ignoreDuplicates` turns the
 * insert into ON CONFLICT DO NOTHING, and the returned `inserted` rows are
 * exactly the ones that were genuinely new — which is what the caller fans
 * notifications out over.
 */
export async function insertLeads(raw: RawLead[]): Promise<InsertLeadsResult> {
  if (!raw.length) return { inserted: [], all: [] };

  const nowIso = new Date().toISOString();
  const seen = new Set<string>();
  const rows: Omit<LeadRow, 'id' | 'created_at'>[] = [];

  for (const r of raw) {
    const hash = sourceHash(r.platform, r.url, r.title);
    // A single scrape run can surface the same post twice; Postgres rejects a
    // statement that conflicts with itself, so collapse duplicates up front.
    if (seen.has(hash)) continue;
    seen.add(hash);

    // A scraper may report a date we can't parse; fall back to "now" rather
    // than throwing and losing every other lead in the batch.
    const parsed = r.postedAt ? new Date(r.postedAt) : null;
    const postedAt =
      parsed && !Number.isNaN(parsed.getTime()) ? parsed.toISOString() : nowIso;

    // A scraper can hand us text Postgres will refuse — a lone surrogate from
    // slicing an emoji in half, or a NUL byte. Left alone, one bad field fails
    // the whole batch and the entire run's leads are lost.
    rows.push({
      title: sanitizeText(r.title),
      platform: r.platform,
      description: sanitizeText(r.description ?? ''),
      budget: sanitizeNullable(r.budget),
      timeline: sanitizeNullable(r.timeline),
      url: sanitizeNullable(r.url),
      author: sanitizeNullable(r.author),
      tags: (r.tags ?? []).map(sanitizeText),
      metadata: sanitizeMetadata(r.metadata),
      source_hash: hash,
      posted_at: postedAt,
    });
  }

  const inserted = unwrap(
    await supabase
      .from('leads')
      .upsert(rows, { onConflict: 'source_hash', ignoreDuplicates: true })
      .select(),
    'saving discovered leads',
  ) as LeadRow[];

  if (inserted.length) cache.clear();

  // Re-read the whole batch by hash. `ignoreDuplicates` deliberately says
  // nothing about the rows it skipped, and those are exactly the leads that
  // are old to the pool but new to this user.
  const hashes = rows.map((r) => r.source_hash);
  const all = unwrap(
    await supabase.from('leads').select('*').in('source_hash', hashes),
    'loading discovered leads',
  ) as LeadRow[];

  return { inserted: inserted.map(rowToFreshDTO), all: all.map(rowToFreshDTO) };
}

/** Which of these leads has this user already reviewed or dismissed? */
export async function leadsAlreadyReviewed(
  userId: string,
  leadIds: string[],
): Promise<Set<string>> {
  if (!leadIds.length) return new Set();

  const rows = unwrap(
    await supabase
      .from('user_leads')
      .select('lead_id, status, ai_checked_at')
      .eq('user_id', userId)
      .in('lead_id', leadIds),
    'loading reviewed leads',
  ) as { lead_id: string; status: string; ai_checked_at: string | null }[];

  return new Set(
    rows
      .filter((r) => r.status === 'dismissed' || r.ai_checked_at !== null)
      .map((r) => r.lead_id),
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
 * Record this user's AI verdicts. Upserts into user_leads, so a lead the user
 * has already bookmarked or moved along their pipeline keeps that state — the
 * verdict is extra information about the lead, not a reset of it.
 */
export async function saveAiReviews(
  userId: string,
  reviews: AiReviewToSave[],
): Promise<void> {
  if (!reviews.length) return;

  const { data: existingRows } = await supabase
    .from('user_leads')
    .select('lead_id, status, bookmarked')
    .eq('user_id', userId)
    .in('lead_id', reviews.map((r) => r.leadId));

  const existing = new Map(
    ((existingRows ?? []) as { lead_id: string; status: LeadStatus; bookmarked: boolean }[]).map(
      (row) => [row.lead_id, row],
    ),
  );

  const now = new Date().toISOString();
  const rows = reviews.map((review) => {
    const current = existing.get(review.leadId);
    // Only archive a lead the user has not touched. Someone who already marked
    // a lead "contacted" has overruled the model by acting on it.
    const shouldArchive =
      review.archive && review.verdict === 'rejected' && (current?.status ?? 'new') === 'new';

    return {
      user_id: userId,
      lead_id: review.leadId,
      status: shouldArchive ? 'archived' : current?.status ?? 'new',
      bookmarked: current?.bookmarked ?? false,
      ai_verdict: review.verdict,
      ai_score: review.score,
      ai_reason: sanitizeText(review.reason),
      ai_model: review.model,
      ai_checked_at: now,
      updated_at: now,
    };
  });

  unwrap(
    await supabase
      .from('user_leads')
      .upsert(rows, { onConflict: 'user_id,lead_id' })
      .select('lead_id'),
    'saving AI reviews',
  );

  cache.invalidatePrefix(`leads:${userId}`);
}

export async function clearLeads(userId: string): Promise<number> {
  // Mark as dismissed rather than deleting — dismissed leads are excluded from
  // queries and won't reappear on future scrapes.
  const rows = unwrap(
    await supabase
      .from('user_leads')
      .update({ status: 'dismissed', updated_at: new Date().toISOString() })
      .eq('user_id', userId)
      .neq('status', 'dismissed')
      .neq('bookmarked', true)
      .select('lead_id'),
    'clearing your leads',
  ) as { lead_id: string }[];

  cache.invalidatePrefix(`leads:${userId}`);
  return rows.length;
}

export async function totalLeadCount(): Promise<number> {
  const { count, error } = await supabase
    .from('leads')
    .select('id', { count: 'exact', head: true });
  return error ? 0 : (count ?? 0);
}
