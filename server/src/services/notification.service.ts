import crypto from 'node:crypto';
import { MAX_NOTIFICATIONS, notificationsStore } from '../store';
import { logger } from '../utils/logger';
import { getConfig } from './config.service';
import type { AppConfig, LeadDTO, Notification } from '../types';

export function listNotifications(unreadOnly = false) {
  const all = notificationsStore.data;
  const data = unreadOnly ? all.filter((n) => !n.read) : all;
  return { data: data.slice(0, 100), unread: all.filter((n) => !n.read).length };
}

export function markRead(id: string): void {
  const found = notificationsStore.data.find((n) => n.id === id);
  if (!found || found.read) return;
  found.read = true;
  notificationsStore.save();
}

export function markAllRead(): void {
  let changed = false;
  for (const n of notificationsStore.data) {
    if (!n.read) {
      n.read = true;
      changed = true;
    }
  }
  if (changed) notificationsStore.save();
}

export function createNotification(input: {
  type?: string;
  title: string;
  message?: string;
  leadId?: string | null;
}): Notification {
  const notification: Notification = {
    id: crypto.randomUUID(),
    type: input.type ?? 'lead',
    title: input.title,
    message: input.message ?? '',
    leadId: input.leadId ?? null,
    read: false,
    createdAt: new Date().toISOString(),
  };

  notificationsStore.data.unshift(notification);
  if (notificationsStore.data.length > MAX_NOTIFICATIONS) {
    notificationsStore.data.length = MAX_NOTIFICATIONS;
  }
  notificationsStore.save();
  return notification;
}

/** Does this lead pass the platform / keyword / budget filters? */
function matchesConfig(lead: LeadDTO, config: AppConfig): boolean {
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
 * Announce newly discovered leads. Delivery beyond the in-app feed is best
 * effort — a failing webhook must not break a scrape cycle.
 */
export async function notifyNewLeads(leads: LeadDTO[]): Promise<void> {
  if (!leads.length) return;

  const config = getConfig();
  if (!config.newLeadsNotification) return;

  const matches = leads.filter((lead) => matchesConfig(lead, config));
  if (!matches.length) return;

  createNotification({
    type: 'lead',
    title: `${matches.length} new lead${matches.length === 1 ? '' : 's'} found`,
    message: matches
      .slice(0, 3)
      .map((l) => l.title)
      .join(' • '),
    leadId: matches[0].id,
  });

  if (config.discordWebhookUrl) {
    await postDiscord(config.discordWebhookUrl, matches).catch((e) =>
      logger.warn('Discord webhook failed', (e as Error).message),
    );
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
    signal: AbortSignal.timeout(10_000),
  });
}
