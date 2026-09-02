/**
 * Shared domain types for the FindClients API.
 * These mirror the shapes the website frontend expects.
 */

export type Platform = 'upwork' | 'twitter' | 'discord' | 'reddit' | 'linkedin';

export const PLATFORMS: Platform[] = ['upwork', 'twitter', 'discord', 'reddit', 'linkedin'];

export type LeadStatus = 'new' | 'viewed' | 'contacted' | 'won' | 'archived';

/**
 * Models the lead qualifier may be pointed at.
 *
 * Google Gemini only, and an allow-list rather than free text: the user brings
 * their own key, so a typo here would burn a scrape cycle failing on every
 * lead and read as "the AI is broken" rather than "that model does not exist".
 * Mirrors the CHECK constraint in supabase/migrations/0005_user_gemini_api_key.sql.
 */
export const AI_MODELS = ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.5-flash-lite'] as const;

export type AiModel = (typeof AI_MODELS)[number];

/** Screening is a short judgment call on every lead — cheap and fast by default. */
export const DEFAULT_AI_MODEL: AiModel = 'gemini-2.5-flash';

export type Plan = 'free' | 'pro' | 'agency';

/**
 * Platform-specific facts a scraper collected about a lead, beyond the fields
 * every platform shares. Free-form on purpose: an Upwork job has a client
 * hire rate, a tweet has view counts, and neither should force a column on
 * the other. Stored as JSONB, rendered as labelled facts in the UI, and given
 * to the AI qualifier so it can judge on more than the post text.
 */
export type LeadMetadata = Record<string, string | number | boolean | null>;

/** A lead as stored in Postgres (global, platform-discovered). */
export interface LeadRow {
  id: string;
  title: string;
  platform: Platform;
  description: string;
  budget: string | null;
  timeline: string | null;
  url: string | null;
  author: string | null;
  tags: string[];
  metadata: LeadMetadata;
  source_hash: string;
  posted_at: string; // ISO
  created_at: string; // ISO
}

/** This user's AI verdict on a lead. Absent until their qualifier has run. */
export type AiVerdict = 'qualified' | 'rejected' | 'error';

export interface LeadAiReview {
  verdict: AiVerdict | null;
  /** 0–100 confidence that the lead is worth this user's time. */
  score: number | null;
  reason: string;
  checkedAt: string | null;
}

/** A lead as returned by the API (per-user fields merged in). */
export interface LeadDTO {
  id: string;
  title: string;
  platform: Platform;
  description: string;
  budget: string | null;
  timeline: string | null;
  url: string | null;
  author: string | null;
  tags: string[];
  metadata: LeadMetadata;
  postedAt: string;
  postedTime: string; // human-relative, e.g. "2 hours ago"
  status: LeadStatus;
  bookmarked: boolean;
  ai: LeadAiReview;
  createdAt: string;
}

/** Raw lead produced by a scraper before it is normalized/inserted. */
export interface RawLead {
  title: string;
  platform: Platform;
  description: string;
  budget?: string | null;
  timeline?: string | null;
  url?: string | null;
  author?: string | null;
  tags?: string[];
  /** Platform-specific extras — see LeadMetadata. */
  metadata?: LeadMetadata;
  /** When the lead was originally posted on the source platform (ISO or Date). */
  postedAt?: string | Date;
}

/** public.profiles — the app-visible mirror of a Supabase auth user. */
export interface ProfileRow {
  id: string;
  email: string;
  full_name: string;
  plan: Plan;
  created_at: string;
  updated_at: string;
}

export interface PublicUser {
  id: string;
  email: string;
  fullName: string;
  plan: Plan;
  createdAt: string;
}

export interface AuthedRequestUser {
  id: string;
  email: string;
  plan: Plan;
}

/**
 * Everything a user can configure, as returned by GET /api/config.
 * Persisted in public.user_config — one row per user.
 */
export interface UserConfig {
  // Notifications
  emailNotifications: boolean;
  pushNotifications: boolean;
  newLeadsNotification: boolean;
  /** This user's own Discord webhook. Empty means no Discord delivery. */
  discordWebhookUrl: string;

  // Lead targeting
  platforms: Platform[];
  keywords: string[];
  excludedKeywords: string[];
  minBudget: number;

  // Scraping behaviour
  scrapeEnabled: boolean;
  leadsPerRun: number;
  maxPostAgeHours: number;

  // X / Twitter tuning
  twitterMinLikes: number;
  twitterMinViews: number;
  twitterLimitPerKeyword: number;

  // Upwork tuning
  upworkJobsUrl: string;
  upworkFetchDetails: boolean;
  upworkMaxAgeHours: number;

  // AI qualification — the user's own definition of a lead worth their time,
  // reviewed with the user's own Gemini API key.
  aiEnabled: boolean;
  /** Free-text criteria the model scores each lead against. */
  aiPrompt: string;
  aiModel: string;
  /**
   * Whether this user has stored a Gemini API key. The key itself is never
   * part of this DTO: `UserConfig` is returned by GET /api/config *and* handed
   * to the scrapers over /api/internal, so anything on it is effectively
   * public to the client. Read the key with `getAiApiKey` instead.
   */
  aiApiKeySet: boolean;
  /** Masked tail of the stored key ("…aB3d"), so the user can tell which one it is. */
  aiApiKeyHint: string;
  /** Leads scoring below this (0–100) are rejected. */
  aiMinScore: number;
  /** Archive rejected leads instead of leaving them in the inbox. */
  aiAutoArchive: boolean;

  updatedAt: string;
}

/** A cookie ready to be injected into a Playwright browser context. */
export interface SessionCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
}
