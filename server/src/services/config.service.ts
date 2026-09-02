import { supabase, unwrap } from '../db/supabase';
import { logger } from '../utils/logger';
import { HttpError } from '../utils/http';
import { encryptSecret, decryptSecret } from '../utils/crypto';
import { DEFAULT_AI_MODEL, type Platform, type UserConfig } from '../types';

/**
 * Per-user configuration, stored in public.user_config (one row per user,
 * created by the sign-up trigger). This is what the website's Config page
 * reads and writes, and what the scrape runner hands to each scraper — so a
 * change here actually changes what gets scraped on the next cycle.
 *
 * One value in this table is a secret: `ai_api_key`, the user's own Gemini
 * key. It is stored encrypted and kept off `UserConfig` entirely, because
 * `UserConfig` goes to the browser (GET /api/config) and to the scrapers
 * (GET /api/internal/users/:id/config). Read it with `getAiApiKey`, which is
 * called only by the qualifier.
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
  ai_enabled: boolean;
  ai_prompt: string;
  ai_model: string;
  ai_min_score: number;
  ai_auto_archive: boolean;
  /** AES-256-GCM ciphertext of the user's Gemini key. '' when unset. */
  ai_api_key: string;
  updated_at: string;
}

/**
 * Open a stored key, or return '' if it cannot be opened.
 *
 * A ciphertext written under a different ENCRYPTION_KEY is unrecoverable, so
 * treating it as "no key" is the honest answer: the Config page then asks for
 * a key instead of claiming one is saved while every review fails.
 */
function readApiKey(row: ConfigRow): string {
  if (!row.ai_api_key) return '';
  try {
    return decryptSecret(row.ai_api_key);
  } catch {
    logger.warn(`Could not decrypt the Gemini API key for ${row.user_id} — treating it as unset`);
    return '';
  }
}

function toDTO(row: ConfigRow): UserConfig {
  const apiKey = readApiKey(row);
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

    aiEnabled: row.ai_enabled ?? false,
    aiPrompt: row.ai_prompt ?? '',
    aiModel: row.ai_model || DEFAULT_AI_MODEL,
    aiMinScore: row.ai_min_score ?? 60,
    aiAutoArchive: row.ai_auto_archive ?? true,
    aiApiKeySet: Boolean(apiKey),
    // Enough to recognise a key, far too little to use one.
    aiApiKeyHint: apiKey ? `••••${apiKey.slice(-4)}` : '',

    updatedAt: row.updated_at,
  };
}

/**
 * Camel-cased patch → snake_cased column names. Undefined keys are dropped.
 * `aiApiKey` is absent on purpose: it needs encrypting, so updateConfig maps
 * it by hand rather than copying it straight through.
 */
const COLUMNS: Record<Exclude<keyof ConfigPatch, 'aiApiKey'>, keyof ConfigRow> = {
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
  aiEnabled: 'ai_enabled',
  aiPrompt: 'ai_prompt',
  aiModel: 'ai_model',
  aiMinScore: 'ai_min_score',
  aiAutoArchive: 'ai_auto_archive',
};

/**
 * A config update. `aiApiKey` is write-only — it has no counterpart on
 * `UserConfig` because the key never travels back out. Sending '' clears it.
 */
export type ConfigPatch = Partial<Omit<UserConfig, 'updatedAt' | 'aiApiKeySet' | 'aiApiKeyHint'>> & {
  aiApiKey?: string;
};

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
  for (const [key, column] of Object.entries(COLUMNS) as [keyof typeof COLUMNS, string][]) {
    const value = patch[key];
    if (value !== undefined) update[column] = value;
  }

  // The Gemini key is encrypted on the way in and never stored in the clear.
  // An empty string is a deliberate "forget my key", not a no-op.
  if (patch.aiApiKey !== undefined) {
    const key = patch.aiApiKey.trim();
    update.ai_api_key = key ? encryptSecret(key) : '';
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

/**
 * This user's Gemini API key, decrypted. '' when they have not set one (or the
 * stored value cannot be opened — see `readApiKey`).
 *
 * Deliberately a separate call from `getConfig`: the key must reach the
 * qualifier and nothing else, and keeping it off the config DTO means it
 * cannot leak through /api/config or /api/internal by accident.
 */
export async function getAiApiKey(userId: string): Promise<string> {
  const { data, error } = await supabase
    .from('user_config')
    .select('user_id, ai_api_key')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    logger.error('Failed to load the stored AI key', error.message);
    return '';
  }
  return data ? readApiKey(data as ConfigRow) : '';
}

/** Every user who has scraping switched on — the scrape cycle's work list. */
export async function listScrapeEnabledUserIds(): Promise<Set<string>> {
  const rows = unwrap(
    await supabase.from('user_config').select('user_id').eq('scrape_enabled', true),
    'listing users with scraping enabled',
  ) as { user_id: string }[];
  return new Set(rows.map((r) => r.user_id));
}
