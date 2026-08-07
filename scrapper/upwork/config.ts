/**
 * Configuration for the Upwork scraper.
 *
 * The scraper launches its own headless Chromium and injects the connecting
 * user's Upwork session cookies (provided per-user through the app), so no local
 * Chrome / remote-debugging setup is required.
 *
 * There are two kinds of setting here, and the split matters:
 *
 *   • **Search settings** — which feed to read, how far back to go, whether to
 *     enrich. These belong to the *user*, are stored in `public.user_config`,
 *     and are edited on the app's Config page. They are passed in per run;
 *     there is no environment variable for them.
 *
 *   • **Runtime settings** — headless mode, user agent, timeouts and politeness
 *     delays. These describe the *machine*, are the same for every user, and
 *     come from the global `.env`.
 */

function bool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

function num(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/** Per-user search settings, sourced from `public.user_config`. */
export interface UpworkSearchConfig {
  /** Feed to scrape (any Upwork search URL). */
  jobsUrl: string;
  /** Only collect jobs posted within this many hours. */
  maxAgeHours: number;
  /** Also open each job's detail page to enrich client rating + hire rate. */
  fetchDetails: boolean;
}

/** Machine-level settings, sourced from the global `.env`. */
export interface UpworkRuntimeConfig {
  /** Run Chromium headless. Set UPWORK_HEADLESS=false to watch it. */
  headless: boolean;
  /** Browser user-agent string. */
  userAgent: string;
  /** Delay between detail-page visits (be polite). */
  requestDelayMs: number;
  /** How long to wait for the "hire rate" text on a detail page. */
  detailTimeoutMs: number;
  /** How long to wait for new tiles after clicking "Load More Jobs". */
  loadMoreWaitMs: number;
  /** Safety cap on how many times to click "Load More Jobs" in one run. */
  maxLoadMoreClicks: number;
}

export type UpworkConfig = UpworkSearchConfig & UpworkRuntimeConfig;

export function loadUpworkRuntimeConfig(): UpworkRuntimeConfig {
  return {
    headless: bool(process.env.UPWORK_HEADLESS, true),
    userAgent:
      process.env.UPWORK_USER_AGENT ??
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    requestDelayMs: num(process.env.UPWORK_REQUEST_DELAY_MS, 1500),
    detailTimeoutMs: num(process.env.UPWORK_DETAIL_TIMEOUT_MS, 10_000),
    loadMoreWaitMs: num(process.env.UPWORK_LOAD_MORE_WAIT_MS, 15_000),
    maxLoadMoreClicks: num(process.env.UPWORK_MAX_LOAD_MORE, 20),
  };
}

/** Combine the running user's saved search settings with this machine's runtime. */
export function loadUpworkConfig(search: UpworkSearchConfig): UpworkConfig {
  return { ...loadUpworkRuntimeConfig(), ...search };
}
