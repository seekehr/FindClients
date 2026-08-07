/**
 * Shared domain types for the FindClients API.
 * These mirror the shapes the website frontend expects.
 */

export type Platform = 'upwork' | 'twitter' | 'discord' | 'reddit' | 'linkedin';

export const PLATFORMS: Platform[] = ['upwork', 'twitter', 'discord', 'reddit', 'linkedin'];

export type LeadStatus = 'new' | 'viewed' | 'contacted' | 'won' | 'archived';

export type Plan = 'free' | 'pro' | 'agency';

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
  source_hash: string;
  posted_at: string; // ISO
  created_at: string; // ISO
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
  postedAt: string;
  postedTime: string; // human-relative, e.g. "2 hours ago"
  status: LeadStatus;
  bookmarked: boolean;
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

  updatedAt: string;
}

/** A cookie ready to be injected into a Playwright browser context. */
export interface SessionCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
}
