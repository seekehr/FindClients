/**
 * Shared domain types.
 *
 * FindClients runs on one machine for one person, so there is no user id
 * anywhere in here: there is one config, one set of connections, one pile of
 * leads. Anything that used to be "per user" is simply "the" thing now.
 */

export type Platform = 'upwork' | 'twitter' | 'discord' | 'reddit' | 'linkedin';

export const PLATFORMS: Platform[] = ['upwork', 'twitter', 'discord', 'reddit', 'linkedin'];

export type LeadStatus = 'new' | 'viewed' | 'contacted' | 'won' | 'archived';

export const LEAD_STATUSES: LeadStatus[] = ['new', 'viewed', 'contacted', 'won', 'archived'];

/**
 * Models the lead qualifier may be pointed at.
 *
 * Google Gemini only, and an allow-list rather than free text: a typo would
 * burn a scrape cycle failing on every lead and read as "the AI is broken"
 * rather than "that model does not exist".
 */
export const AI_MODELS = ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.5-flash-lite'] as const;

export type AiModel = (typeof AI_MODELS)[number];

/** Screening is a short judgment call on every lead — cheap and fast by default. */
export const DEFAULT_AI_MODEL: AiModel = 'gemini-2.5-flash';

/**
 * Platform-specific facts a scraper collected about a lead, beyond the fields
 * every platform shares. Free-form on purpose: an Upwork job has a client hire
 * rate, a tweet has view counts, and neither should force a field on the other.
 * Rendered as labelled facts in the UI and given to the AI qualifier so it can
 * judge on more than the post text.
 */
export type LeadMetadata = Record<string, string | number | boolean | null>;

export type AiVerdict = 'qualified' | 'rejected' | 'error';

export interface LeadAiReview {
  verdict: AiVerdict | null;
  /** 0–100 confidence that the lead is worth your time. */
  score: number | null;
  reason: string;
  model: string;
  checkedAt: string | null;
}

/**
 * A lead exactly as it is stored in data/leads.json.
 *
 * The old schema split this across a shared `leads` pool and a per-user
 * `user_leads` row. With one user there is nothing to split: status, bookmark
 * and AI verdict live on the lead itself.
 */
export interface Lead {
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
  /** sha1(platform + url||title) — how re-scraping the same post is detected. */
  sourceHash: string;
  postedAt: string;
  createdAt: string;
  updatedAt: string;
  status: LeadStatus;
  bookmarked: boolean;
  ai: LeadAiReview;
}

/** A lead as the API returns it: the stored shape plus a human-readable date. */
export interface LeadDTO extends Lead {
  /** e.g. "2 hours ago" — computed on read, never stored. */
  postedTime: string;
}

/** Raw lead produced by a scraper before it is normalized and stored. */
export interface RawLead {
  title: string;
  platform: Platform;
  description: string;
  budget?: string | null;
  timeline?: string | null;
  url?: string | null;
  author?: string | null;
  tags?: string[];
  metadata?: LeadMetadata;
  /** When the lead was posted on the source platform (ISO string or Date). */
  postedAt?: string | Date;
}

/**
 * Everything you can configure, stored in data/config.json and edited on the
 * Config page. This is the single source of truth for what gets scraped.
 *
 * `aiApiKey` is deliberately absent — see `StoredConfig` in store/index.ts.
 * This shape is what the API hands to the browser, so a secret on it would be
 * a secret in the page source.
 */
export interface AppConfig {
  // Notifications
  newLeadsNotification: boolean;
  /** Discord webhook to post new leads to. Empty means no Discord delivery. */
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

  // AI qualification — your definition of a lead worth your time.
  aiEnabled: boolean;
  /** Free-text criteria the model scores each lead against. */
  aiPrompt: string;
  aiModel: string;
  /** Leads scoring below this (0–100) are rejected. */
  aiMinScore: number;
  /** Archive rejected leads instead of leaving them in the inbox. */
  aiAutoArchive: boolean;
  /** Whether a Gemini key is saved. The key itself never leaves the server. */
  aiApiKeySet: boolean;
  /** Masked tail of the saved key ("••••aB3d"), so you can tell which it is. */
  aiApiKeyHint: string;

  updatedAt: string;
}

/** One entry in the scrape history. */
export interface ScrapeRun {
  id: string;
  platform: string;
  status: 'running' | 'success' | 'error';
  found: number;
  inserted: number;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
}

export interface Notification {
  id: string;
  type: string;
  title: string;
  message: string;
  leadId: string | null;
  read: boolean;
  createdAt: string;
}
