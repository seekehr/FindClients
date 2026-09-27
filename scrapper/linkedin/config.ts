/**
 * Machine-level settings for LinkedIn.
 *
 * Everything about *what* to look for — the keywords, feed or search, the job
 * search the alerts tab sits on and how it is paced — lives in data/config.json
 * and is edited on the Config page. What is left here describes the machine.
 *
 * `headless` covers the session check and the post scrape when FindClients
 * launches its own browser. The job watcher is never headless, and attached to
 * your own Chrome (CHROME_CDP_URL) none of this applies — that window is
 * already on screen.
 */

function bool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

/** Machine-level settings, sourced from the global `.env`. */
export interface LinkedInRuntimeConfig {
  /** Run Chromium headless. Set LINKEDIN_HEADLESS=false to watch it work. */
  headless: boolean;
  /**
   * Override the browser's user agent. Undefined — the default — lets Chromium
   * send its own, which is the right answer now that we drive a real persistent
   * profile: a pinned UA string drifts out of date with the actual browser and
   * turns into a fingerprint mismatch rather than a disguise.
   */
  userAgent?: string;
}

export function loadLinkedInRuntimeConfig(): LinkedInRuntimeConfig {
  return {
    headless: bool(process.env.LINKEDIN_HEADLESS, true),
    userAgent: process.env.LINKEDIN_USER_AGENT || undefined,
  };
}
