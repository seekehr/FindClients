import { supabase, unwrap } from '../db/supabase';
import { logger } from '../utils/logger';
import { HttpError } from '../utils/http';
import type { Platform, UserConfig } from '../types';

/**
 * Per-user configuration, stored in public.user_config (one row per user,
 * created by the sign-up trigger). This is what the website's Config page
 * reads and writes, and what the scrape runner hands to each scraper — so a
 * change here actually changes what gets scraped on the next cycle.
 */

interface ConfigRow {
  user_id: string;
  email_notifications: boolean;
  push_notifications: boolean;
  new_leads_notify: boolean;
  discord_webhook_url: string;
  platforms: string[];
  keywords: string[];
  excluded_keywords: string[];
  min_budget: number;
  scrape_enabled: boolean;
  leads_per_run: number;
  max_post_age_hours: number;
  twitter_min_likes: number;
  twitter_min_views: number;
  twitter_limit_per_keyword: number;
  upwork_jobs_url: string;
  upwork_fetch_details: boolean;
  upwork_max_age_hours: number;
  updated_at: string;
}

function toDTO(row: ConfigRow): UserConfig {
  return {
    emailNotifications: row.email_notifications,
    pushNotifications: row.push_notifications,
    newLeadsNotification: row.new_leads_notify,
    discordWebhookUrl: row.discord_webhook_url,

    platforms: (row.platforms ?? []) as Platform[],
    keywords: row.keywords ?? [],
    excludedKeywords: row.excluded_keywords ?? [],
    minBudget: row.min_budget,

    scrapeEnabled: row.scrape_enabled,
    leadsPerRun: row.leads_per_run,
    maxPostAgeHours: row.max_post_age_hours,

    twitterMinLikes: row.twitter_min_likes,
    twitterMinViews: row.twitter_min_views,
    twitterLimitPerKeyword: row.twitter_limit_per_keyword,

    upworkJobsUrl: row.upwork_jobs_url,
    upworkFetchDetails: row.upwork_fetch_details,
    upworkMaxAgeHours: row.upwork_max_age_hours,

    updatedAt: row.updated_at,
  };
}

/** Camel-cased patch → snake_cased column names. Undefined keys are dropped. */
const COLUMNS: Record<keyof ConfigPatch, keyof ConfigRow> = {
  emailNotifications: 'email_notifications',
  pushNotifications: 'push_notifications',
  newLeadsNotification: 'new_leads_notify',
  discordWebhookUrl: 'discord_webhook_url',
  platforms: 'platforms',
  keywords: 'keywords',
  excludedKeywords: 'excluded_keywords',
  minBudget: 'min_budget',
  scrapeEnabled: 'scrape_enabled',
  leadsPerRun: 'leads_per_run',
  maxPostAgeHours: 'max_post_age_hours',
  twitterMinLikes: 'twitter_min_likes',
  twitterMinViews: 'twitter_min_views',
  twitterLimitPerKeyword: 'twitter_limit_per_keyword',
  upworkJobsUrl: 'upwork_jobs_url',
  upworkFetchDetails: 'upwork_fetch_details',
  upworkMaxAgeHours: 'upwork_max_age_hours',
};

export type ConfigPatch = Partial<Omit<UserConfig, 'updatedAt'>>;

export async function getConfig(userId: string): Promise<UserConfig> {
  const { data, error } = await supabase
    .from('user_config')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    logger.error('Failed to load user config', error.message);
    throw new HttpError(500, 'Could not load your configuration');
  }
  if (data) return toDTO(data as ConfigRow);

  // Defensive: the sign-up trigger should have made this row already.
  const created = unwrap(
    await supabase
      .from('user_config')
      .upsert({ user_id: userId }, { onConflict: 'user_id' })
      .select()
      .single(),
    'creating your configuration',
  ) as ConfigRow;
  return toDTO(created);
}

export async function updateConfig(userId: string, patch: ConfigPatch): Promise<UserConfig> {
  const update: Record<string, unknown> = {};
  for (const [key, column] of Object.entries(COLUMNS) as [keyof ConfigPatch, string][]) {
    const value = patch[key];
    if (value !== undefined) update[column] = value;
  }

  // Nothing to change — return the current row rather than a no-op UPDATE.
  if (!Object.keys(update).length) return getConfig(userId);

  // Make sure the row exists first, so a config save can never 404 for a user
  // whose account predates the provisioning trigger.
  await getConfig(userId);

  const row = unwrap(
    await supabase
      .from('user_config')
      .update(update)
      .eq('user_id', userId)
      .select()
      .single(),
    'saving your configuration',
  ) as ConfigRow;

  return toDTO(row);
}

/** Every user who has scraping switched on — the scrape cycle's work list. */
export async function listScrapeEnabledUserIds(): Promise<Set<string>> {
  const rows = unwrap(
    await supabase.from('user_config').select('user_id').eq('scrape_enabled', true),
    'listing users with scraping enabled',
  ) as { user_id: string }[];
  return new Set(rows.map((r) => r.user_id));
}
