/**
 * Configuration for the BlackHatWorld scraper.
 *
 * Same split as the X scraper:
 *
 *   • **What to read** — the sub forums and how many threads from each. Yours,
 *     saved in `data/config.json` and edited on the Config page.
 *
 *   • **Runtime settings** — headless mode and user agent. The machine's, from
 *     the root `.env`.
 */

function bool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

/** Per-user settings, from data/config.json. */
export interface BhwSearchConfig {
  /** Sub forum pages to read, e.g. https://www.blackhatworld.com/forums/hire-a-freelancer.76/ */
  forumUrls: string[];
  /** Newest threads read per sub forum. */
  limitPerForum: number;
  /** Skip threads started longer ago than this many hours (0 = no filter). */
  maxPostAgeHours: number;
}

/** Machine-level settings, from the root `.env`. */
export interface BhwRuntimeConfig {
  /**
   * Run the launched browser headless. Off by default, unlike X: the site sits
   * behind Cloudflare, which stops a headless Chrome on sight, and its
   * clearance cookie is tied to the user agent — so a clearance earned in a
   * visible window does not carry over to a headless one. Ignored when
   * attached to your own Chrome (CHROME_CDP_URL), which is never headless.
   */
  headless: boolean;
  /** Override the browser's user agent. Leave unset — see the X config. */
  userAgent?: string;
}

export type BhwConfig = BhwSearchConfig & BhwRuntimeConfig;

export function loadBhwRuntimeConfig(): BhwRuntimeConfig {
  return {
    headless: bool(process.env.BHW_HEADLESS, false),
    userAgent: process.env.BHW_USER_AGENT || undefined,
  };
}

export function loadBhwConfig(search: BhwSearchConfig): BhwConfig {
  return { ...loadBhwRuntimeConfig(), ...search };
}
