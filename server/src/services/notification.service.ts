import { db } from '../db';
import { env } from '../config/env';
import { newId } from '../utils/ids';
import { nowIso } from '../utils/time';
import { logger } from '../utils/logger';
import { getSettings } from './settings.service';
import type { LeadDTO } from '../types';

interface NotificationRow {
  id: string;
  user_id: string;
  type: string;
  title: string;
  message: string;
  lead_id: string | null;
  read: number;
  created_at: string;
}

function toDTO(row: NotificationRow) {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    message: row.message,
    leadId: row.lead_id,
    read: row.read === 1,
    createdAt: row.created_at,
  };
}

export function listNotifications(userId: string, unreadOnly = false) {
  const rows = db
    .prepare(
      `SELECT * FROM notifications
       WHERE user_id = ? ${unreadOnly ? 'AND read = 0' : ''}
       ORDER BY created_at DESC LIMIT 100`,
    )
    .all(userId) as NotificationRow[];
  const unread = (
    db.prepare('SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND read = 0').get(
      userId,
    ) as { c: number }
  ).c;
  return { data: rows.map(toDTO), unread };
}

export function markRead(userId: string, id: string) {
  db.prepare('UPDATE notifications SET read = 1 WHERE id = ? AND user_id = ?').run(id, userId);
}

export function markAllRead(userId: string) {
  db.prepare('UPDATE notifications SET read = 1 WHERE user_id = ?').run(userId);
}

export function createNotification(input: {
  userId: string;
  type?: string;
  title: string;
  message?: string;
  leadId?: string | null;
}) {
  const row: NotificationRow = {
    id: newId('ntf'),
    user_id: input.userId,
    type: input.type ?? 'lead',
    title: input.title,
    message: input.message ?? '',
    lead_id: input.leadId ?? null,
    read: 0,
    created_at: nowIso(),
  };
  db.prepare(
    `INSERT INTO notifications (id, user_id, type, title, message, lead_id, read, created_at)
     VALUES ($id, $user, $type, $title, $message, $lead, 0, $now)`,
  ).run({
    id: row.id,
    user: row.user_id,
    type: row.type,
    title: row.title,
    message: row.message,
    lead: row.lead_id,
    now: row.created_at,
  });
  return toDTO(row);
}

/**
 * Fan out newly discovered leads to every user who wants them, honoring each
 * user's platform + keyword preferences. Delivery channels (email/Discord/push)
 * are stubbed here — swap in real providers without changing callers.
 */
export async function notifyNewLeads(leads: LeadDTO[]): Promise<void> {
  if (!leads.length) return;
  const users = db.prepare('SELECT id FROM users').all() as { id: string }[];

  for (const user of users) {
    const prefs = getSettings(user.id);
    if (!prefs.newLeadsNotification) continue;

    const matches = leads.filter((lead) => {
      if (prefs.platforms.length && !prefs.platforms.includes(lead.platform)) return false;
      if (prefs.keywords.length) {
        const hay = `${lead.title} ${lead.description} ${lead.tags.join(' ')}`.toLowerCase();
        if (!prefs.keywords.some((k) => hay.includes(k.toLowerCase()))) return false;
      }
      return true;
    });
    if (!matches.length) continue;

    createNotification({
      userId: user.id,
      type: 'lead',
      title: `${matches.length} new lead${matches.length === 1 ? '' : 's'} found`,
      message: matches
        .slice(0, 3)
        .map((l) => l.title)
        .join(' • '),
      leadId: matches[0].id,
    });

    if (prefs.emailNotifications) {
      logger.debug(`[email] -> user ${user.id}: ${matches.length} new leads`);
    }
    if (env.discordWebhookUrl) {
      await postDiscord(matches).catch((e) => logger.warn('Discord webhook failed', e));
    }
  }
}

async function postDiscord(leads: LeadDTO[]): Promise<void> {
  if (!env.discordWebhookUrl) return;
  const content = `**${leads.length} new lead(s) on FindClients**\n` +
    leads.slice(0, 5).map((l) => `• [${l.platform}] ${l.title}`).join('\n');
  await fetch(env.discordWebhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  });
}
