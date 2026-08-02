import { db } from '../db';
import { cache } from '../cache';
import { newId, sourceHash } from '../utils/ids';
import { nowIso, relativeTime } from '../utils/time';
import type { LeadDTO, LeadRow, LeadStatus, RawLead } from '../types';

const VALID_STATUS: LeadStatus[] = ['new', 'viewed', 'contacted', 'won', 'archived'];

interface RowWithUser extends LeadRow {
  ul_status: string | null;
  ul_bookmarked: number | null;
}

function toDTO(row: RowWithUser): LeadDTO {
  return {
    id: row.id,
    title: row.title,
    platform: row.platform,
    description: row.description,
    budget: row.budget,
    timeline: row.timeline,
    url: row.url,
    author: row.author,
    tags: safeTags(row.tags),
    postedAt: row.posted_at,
    postedTime: relativeTime(row.posted_at),
    status: (row.ul_status as LeadStatus) ?? 'new',
    bookmarked: row.ul_bookmarked === 1,
    createdAt: row.created_at,
  };
}

function safeTags(json: string): string[] {
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
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

export function listLeads(params: ListLeadsParams) {
  const page = Math.max(1, params.page ?? 1);
  const limit = Math.min(100, Math.max(1, params.limit ?? 20));
  const offset = (page - 1) * limit;

  const where: string[] = [];
  // node:sqlite rejects bound keys that don't appear in the statement, so the
  // shared filter params (used by both queries) are kept separate from the
  // pagination params (used only by the SELECT).
  const filterArgs: Record<string, unknown> = { userId: params.userId };

  if (params.platform) {
    where.push('l.platform = $platform');
    filterArgs.platform = params.platform;
  }
  if (params.status) {
    where.push("COALESCE(ul.status, 'new') = $status");
    filterArgs.status = params.status;
  }
  if (params.bookmarked) {
    where.push('ul.bookmarked = 1');
  }
  if (params.q) {
    where.push('(l.title LIKE $q OR l.description LIKE $q)');
    filterArgs.q = `%${params.q}%`;
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const rows = db
    .prepare(
      `SELECT l.*, ul.status AS ul_status, ul.bookmarked AS ul_bookmarked
       FROM leads l
       LEFT JOIN user_leads ul ON ul.lead_id = l.id AND ul.user_id = $userId
       ${whereSql}
       ORDER BY l.posted_at DESC
       LIMIT $limit OFFSET $offset`,
    )
    .all({ ...filterArgs, limit, offset }) as RowWithUser[];

  const total = (
    db
      .prepare(
        `SELECT COUNT(*) AS c
         FROM leads l
         LEFT JOIN user_leads ul ON ul.lead_id = l.id AND ul.user_id = $userId
         ${whereSql}`,
      )
      .get(filterArgs) as { c: number }
  ).c;

  return {
    data: rows.map(toDTO),
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) || 1 },
  };
}

export function getLead(userId: string, id: string): LeadDTO | null {
  const row = db
    .prepare(
      `SELECT l.*, ul.status AS ul_status, ul.bookmarked AS ul_bookmarked
       FROM leads l
       LEFT JOIN user_leads ul ON ul.lead_id = l.id AND ul.user_id = $userId
       WHERE l.id = $id`,
    )
    .get({ userId, id }) as RowWithUser | undefined;
  return row ? toDTO(row) : null;
}

function upsertUserLead(userId: string, leadId: string, patch: { status?: LeadStatus; bookmarked?: boolean }) {
  const existing = db
    .prepare('SELECT status, bookmarked FROM user_leads WHERE user_id = ? AND lead_id = ?')
    .get(userId, leadId) as { status: string; bookmarked: number } | undefined;

  const status = patch.status ?? (existing?.status as LeadStatus) ?? 'new';
  const bm = patch.bookmarked === undefined ? existing?.bookmarked ?? 0 : patch.bookmarked ? 1 : 0;

  db.prepare(
    `INSERT INTO user_leads (user_id, lead_id, bookmarked, status, updated_at)
     VALUES ($userId, $leadId, $bm, $status, $now)
     ON CONFLICT(user_id, lead_id) DO UPDATE SET
       bookmarked = $bm, status = $status, updated_at = $now`,
  ).run({ userId, leadId, bm, status, now: nowIso() });

  cache.invalidatePrefix(`leads:${userId}`);
  return { status, bookmarked: bm === 1 };
}

export function setLeadStatus(userId: string, leadId: string, status: LeadStatus) {
  if (!VALID_STATUS.includes(status)) throw new Error(`Invalid status: ${status}`);
  return upsertUserLead(userId, leadId, { status });
}

export function setBookmark(userId: string, leadId: string, bookmarked: boolean) {
  return upsertUserLead(userId, leadId, { bookmarked });
}

/**
 * Insert leads discovered by a scraper, skipping duplicates via source_hash.
 * Returns the newly inserted leads (so the caller can fan out notifications).
 */
export function insertLeads(raw: RawLead[]): LeadDTO[] {
  const inserted: LeadRow[] = [];
  const insert = db.prepare(
    `INSERT INTO leads (id, title, platform, description, budget, timeline, url, author, tags, source_hash, posted_at, created_at)
     VALUES ($id, $title, $platform, $description, $budget, $timeline, $url, $author, $tags, $hash, $postedAt, $createdAt)
     ON CONFLICT(source_hash) DO NOTHING`,
  );

  for (const r of raw) {
    const postedAt = r.postedAt ? new Date(r.postedAt).toISOString() : nowIso();
    const row: LeadRow = {
      id: newId('lead'),
      title: r.title,
      platform: r.platform,
      description: r.description ?? '',
      budget: r.budget ?? null,
      timeline: r.timeline ?? null,
      url: r.url ?? null,
      author: r.author ?? null,
      tags: JSON.stringify(r.tags ?? []),
      source_hash: sourceHash(r.platform, r.url, r.title),
      posted_at: postedAt,
      created_at: nowIso(),
    };
    const res = insert.run({
      id: row.id,
      title: row.title,
      platform: row.platform,
      description: row.description,
      budget: row.budget,
      timeline: row.timeline,
      url: row.url,
      author: row.author,
      tags: row.tags,
      hash: row.source_hash,
      postedAt: row.posted_at,
      createdAt: row.created_at,
    });
    if (res.changes > 0) inserted.push(row);
  }

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
    tags: safeTags(row.tags),
    postedAt: row.posted_at,
    postedTime: relativeTime(row.posted_at),
    status: 'new',
    bookmarked: false,
    createdAt: row.created_at,
  }));
}

export function totalLeadCount(): number {
  return (db.prepare('SELECT COUNT(*) AS c FROM leads').get() as { c: number }).c;
}
