/**
 * Machine-level settings for the Upwork tab.
 *
 * Everything about *what* to watch — the feed URL, the reload window, how long
 * a job is held before it reaches you — lives in data/config.json and is edited
 * on the Config page, because those are decisions about your account and your
 * risk. What is left here describes the machine: which user agent, how patient
 * to be with a slow page.
 *
 * `headless` survives only for `checkSession`, which loads one page and closes
 * again. The watcher itself is never headless: it lives in the Chrome you
 * already have open.
 */

function bool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

function num(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/** Machine-level settings, sourced from the global `.env`. */
export interface UpworkRuntimeConfig {
  /** Run Chromium headless. Only used by the session check. */
  headless: boolean;
  /**
   * Override the browser's user agent. Undefined — the default — lets Chromium
   * send its own, which is the right answer now that we drive a real persistent
   * profile: a pinned UA string drifts out of date with the actual browser and
   * turns into a fingerprint mismatch rather than a disguise.
   */
  userAgent?: string;
  /** Delay between detail-page visits (be polite). */
  requestDelayMs: number;
  /** How long to wait for the "hire rate" text on a detail page. */
  detailTimeoutMs: number;
}

export function loadUpworkRuntimeConfig(): UpworkRuntimeConfig {
  return {
    headless: bool(process.env.UPWORK_HEADLESS, true),
    userAgent: process.env.UPWORK_USER_AGENT || undefined,
    requestDelayMs: num(process.env.UPWORK_REQUEST_DELAY_MS, 1500),
    detailTimeoutMs: num(process.env.UPWORK_DETAIL_TIMEOUT_MS, 10_000),
  };
}

