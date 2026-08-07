import { supabase, unwrap } from '../db/supabase';
import { cache } from '../cache';
import { sourceHash } from '../utils/ids';
import { relativeTime } from '../utils/time';
import { sanitizeNullable, sanitizeText } from '../utils/text';
import { badRequest } from '../utils/http';
import type { LeadDTO, LeadRow, LeadStatus, Platform, RawLead } from '../types';

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
  posted_at: string;
  created_at: string;
  status: LeadStatus;
  bookmarked: boolean;
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
    postedAt: row.posted_at,
    postedTime: relativeTime(row.posted_at),
    status: row.status ?? 'new',
    bookmarked: row.bookmarked ?? false,
    createdAt: row.created_at,
  };
}

export interface ListLeadsParams {
  userId: string;
  platform?: string;
  q?: string;
  status?: string;
  bookmarked?: boolean;
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

/**
 * Insert leads discovered by a scraper, skipping ones already in the pool.
 *
 * De-duplication is the source_hash unique index: `ignoreDuplicates` turns the
 * insert into ON CONFLICT DO NOTHING, and the returned rows are exactly the
 * ones that were genuinely new — which is what the caller fans notifications
 * out over.
 */
export async function insertLeads(raw: RawLead[]): Promise<LeadDTO[]> {
  if (!raw.length) return [];

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

  return inserted.map((row) => ({
    id: row.id,
    title: row.title,
    platform: row.platform,
    description: row.description,
    budget: row.budget,
    timeline: row.timeline,
    url: row.url,
    author: row.author,
    tags: row.tags ?? [],
    postedAt: row.posted_at,
    postedTime: relativeTime(row.posted_at),
    status: 'new',
    bookmarked: false,
    createdAt: row.created_at,
  }));
}

export async function totalLeadCount(): Promise<number> {
  const { count, error } = await supabase
    .from('leads')
    .select('id', { count: 'exact', head: true });
  return error ? 0 : (count ?? 0);
}
