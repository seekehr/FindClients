/**
 * Configuration for the X/Twitter scraper.
 *
 * There are two kinds of setting here, and the split matters:
 *
 *   • **Search settings** — keywords, thresholds, limits. These belong to the
 *     *user*, are stored in `public.user_config`, and are edited on the app's
 *     Config page. They are passed in per run; there is no environment
 *     variable for them, so the database is the only source of truth.
 *
 *   • **Runtime settings** — headless mode, proxies, user agent. These describe
 *     the *machine* the scraper runs on, are the same for every user, and come
 *     from the global `.env`.
 */

function list(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function bool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

/** Per-user search settings, sourced from `public.user_config`. */
export interface TwitterSearchConfig {
  /** Search terms to scrape (hiring-intent phrases work best). */
  keywords: string[];
  /** Max tweets to collect per keyword. */
  scrapeLimitPerKeyword: number;
  /** Skip tweets below this many likes (0 = no filter). */
  minimumPostLikes: number;
  /** Skip tweets below this many views (0 = no filter). */
  minimumPostViews: number;
  /** Skip tweets older than this many hours (0 = no filter). */
  maxPostAgeHours: number;
}

/** Machine-level settings, sourced from the global `.env`. */
export interface TwitterRuntimeConfig {
  /** Run Chromium headless. Set X_HEADLESS=false to watch it work. */
  headless: boolean;
  /** Optional rotating proxy list, e.g. "http://user:pass@host:port,...". */
  proxyList: string[];
  /** Browser user-agent string. */
  userAgent: string;
}

export type TwitterConfig = TwitterSearchConfig & TwitterRuntimeConfig;

export function loadTwitterRuntimeConfig(): TwitterRuntimeConfig {
  return {
    headless: bool(process.env.X_HEADLESS, true),
    proxyList: list(process.env.X_PROXY_LIST),
    userAgent:
      process.env.X_USER_AGENT ??
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  };
}

/** Combine the running user's saved search settings with this machine's runtime. */
export function loadTwitterConfig(search: TwitterSearchConfig): TwitterConfig {
  return { ...loadTwitterRuntimeConfig(), ...search };
}
