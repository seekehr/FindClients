import { supabase, unwrap } from '../db/supabase';
import { logger } from '../utils/logger';
import { getConfig } from './config.service';
import { listUserIds } from './user.service';
import type { LeadDTO, UserConfig } from '../types';

interface NotificationRow {
  id: string;
  user_id: string;
  type: string;
  title: string;
  message: string;
  lead_id: string | null;
  read: boolean;
  created_at: string;
}

function toDTO(row: NotificationRow) {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    message: row.message,
    leadId: row.lead_id,
    read: row.read,
    createdAt: row.created_at,
  };
}

export async function listNotifications(userId: string, unreadOnly = false) {
  let query = supabase
    .from('notifications')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(100);
  if (unreadOnly) query = query.eq('read', false);

  const rows = unwrap(await query, 'loading notifications') as NotificationRow[];

  const { count } = await supabase
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('read', false);

  return { data: rows.map(toDTO), unread: count ?? 0 };
}

export async function markRead(userId: string, id: string) {
  unwrap(
    await supabase
      .from('notifications')
      .update({ read: true })
      .eq('id', id)
      .eq('user_id', userId)
      .select('id'),
    'marking a notification read',
  );
}

export async function markAllRead(userId: string) {
  unwrap(
    await supabase
      .from('notifications')
      .update({ read: true })
      .eq('user_id', userId)
      .eq('read', false)
      .select('id'),
    'marking notifications read',
  );
}

export async function createNotification(input: {
  userId: string;
  type?: string;
  title: string;
  message?: string;
  leadId?: string | null;
}) {
  const row = unwrap(
    await supabase
      .from('notifications')
      .insert({
        user_id: input.userId,
        type: input.type ?? 'lead',
        title: input.title,
        message: input.message ?? '',
        lead_id: input.leadId ?? null,
      })
      .select()
      .single(),
    'creating a notification',
  ) as NotificationRow;
  return toDTO(row);
}

/** Does this lead pass the user's platform / keyword / budget filters? */
function matchesConfig(lead: LeadDTO, config: UserConfig): boolean {
  if (config.platforms.length && !config.platforms.includes(lead.platform)) return false;

  const haystack = `${lead.title} ${lead.description} ${lead.tags.join(' ')}`.toLowerCase();

  if (config.excludedKeywords.some((k) => haystack.includes(k.toLowerCase()))) return false;
  if (config.keywords.length && !config.keywords.some((k) => haystack.includes(k.toLowerCase()))) {
    return false;
  }

  if (config.minBudget > 0 && lead.budget) {
    // Budgets arrive as free text ("$500", "50/hr"); take the largest number in
    // the string and let anything unparseable through rather than hide a lead.
    const numbers = lead.budget.match(/\d[\d,]*/g)?.map((n) => Number(n.replace(/,/g, '')));
    if (numbers?.length && Math.max(...numbers) < config.minBudget) return false;
  }

  return true;
}

/**
 * Fan newly discovered leads out to every user who wants them, honoring each
 * user's own configuration. Delivery channels beyond the in-app feed are best
 * effort — a failing webhook must not break a scrape cycle.
 */
export async function notifyNewLeads(leads: LeadDTO[]): Promise<void> {
  if (!leads.length) return;

  const userIds = await listUserIds();

  for (const userId of userIds) {
    let config: UserConfig;
    try {
      config = await getConfig(userId);
    } catch {
      continue;
    }
    if (!config.newLeadsNotification) continue;

    const matches = leads.filter((lead) => matchesConfig(lead, config));
    if (!matches.length) continue;

    await createNotification({
      userId,
      type: 'lead',
      title: `${matches.length} new lead${matches.length === 1 ? '' : 's'} found`,
      message: matches
        .slice(0, 3)
        .map((l) => l.title)
        .join(' • '),
      leadId: matches[0].id,
    });

    if (config.emailNotifications) {
      logger.debug(`[email] -> user ${userId}: ${matches.length} new leads`);
    }

    // Per-user only — there is deliberately no global webhook fallback, so one
    // user's leads can never be posted to another user's channel.
    if (config.discordWebhookUrl) {
      await postDiscord(config.discordWebhookUrl, matches).catch((e) =>
        logger.warn('Discord webhook failed', (e as Error).message),
      );
    }
  }
}

async function postDiscord(webhookUrl: string, leads: LeadDTO[]): Promise<void> {
  const content =
    `**${leads.length} new lead(s) on FindClients**\n` +
    leads
      .slice(0, 5)
      .map((l) => `• [${l.platform}] ${l.title}`)
      .join('\n');

  await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  });
}
