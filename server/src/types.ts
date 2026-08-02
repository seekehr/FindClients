/**
 * Shared domain types for the FindClients API.
 * These mirror the shapes the website frontend expects.
 */

export type Platform = 'upwork' | 'twitter' | 'discord' | 'reddit' | 'linkedin';

export type LeadStatus = 'new' | 'viewed' | 'contacted' | 'won' | 'archived';

export type Plan = 'free' | 'pro' | 'agency';

/** A lead as stored in the database (global, platform-discovered). */
export interface LeadRow {
  id: string;
  title: string;
  platform: Platform;
  description: string;
  budget: string | null;
  timeline: string | null;
  url: string | null;
  author: string | null;
  tags: string; // JSON-encoded string[]
  source_hash: string;
  posted_at: string; // ISO
  created_at: string; // ISO
}

/** A lead as returned by the API (tags parsed, per-user fields merged in). */
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

export interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  full_name: string;
  plan: Plan;
  created_at: string;
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
