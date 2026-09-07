import path from 'node:path';
import dotenv from 'dotenv';

/**
 * Machine-level settings, read from the `.env` at the repository root.
 *
 * Note how little is here. Everything about *what* to scrape — keywords,
 * thresholds, limits, the Upwork feed, the AI criteria and key — lives in
 * data/config.json and is edited in the app. This file only describes the
 * machine: which port, which browser mode, how often.
 */
const serverDir = path.resolve(__dirname, '..', '..');
const repoRoot = path.resolve(serverDir, '..');

dotenv.config({ path: path.join(repoRoot, '.env') });

function bool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

function num(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  isProd: process.env.NODE_ENV === 'production',
  port: num(process.env.PORT, 4000),

  /**
   * Which interface to listen on. Loopback by default, deliberately: this
   * server has no authentication, so binding it to every interface would hand
   * anyone on the same network your leads, your saved sessions and a button
   * that starts a scrape. Change it only if you understand that.
   */
  host: process.env.HOST ?? '127.0.0.1',

  /**
   * Where the JSON data files live. Everything the app remembers is in this
   * one folder, so backing up FindClients means copying it.
   */
  dataDir: process.env.DATA_DIR
    ? path.resolve(repoRoot, process.env.DATA_DIR)
    : path.join(repoRoot, 'data'),

  /**
   * Serve the built Next.js app from this same process, so there is one
   * command and one port. Set SERVE_WEBSITE=false to run `next dev` separately.
   */
  serveWebsite: bool(process.env.SERVE_WEBSITE, true),

  /**
   * When a scraper hits a bot challenge, reopen the run in a visible browser
   * window so you can solve it by hand.
   *
   * This assumes you are at the machine. A scheduled run at 3am will open a
   * window nobody sees and time out after `CAPTCHA_TIMEOUT_MS`, costing that
   * one cycle — the next one starts clean. Set false to skip challenges
   * outright instead.
   */
  captchaOpenWindow: bool(process.env.CAPTCHA_OPEN_WINDOW, true),
  captchaTimeoutMs: num(process.env.CAPTCHA_TIMEOUT_MS, 5 * 60 * 1000),

  /**
   * Attach to a Chrome the user started (`npm run chrome`) instead of letting
   * the scrapers launch one. Empty means launch our own per-platform profile.
   */
  chromeCdpUrl: process.env.CHROME_CDP_URL?.trim() ?? '',

  schedulerEnabled: bool(process.env.SCHEDULER_ENABLED, true),

  /**
   * How often to scrape. Every 30 minutes by default.
   *
   * This is the single most important setting for not getting your Upwork or X
   * account flagged. Scraping runs from your own IP with your own logged-in
   * session, which looks like ordinary use — right up until it happens every
   * two minutes, forever, at exactly the same offset. Slower is safer, and the
   * leads are not going anywhere.
   */
  scrapeCron: process.env.SCRAPE_CRON ?? '*/30 * * * *',

  /**
   * Random delay before each scheduled cycle actually starts, so runs don't
   * land on a perfectly regular clock tick. 0 disables it.
   */
  scrapeJitterMs: num(process.env.SCRAPE_JITTER_MS, 120_000),

  /**
   * Scrape once immediately at startup. Off by default: restarting the app
   * should not be a reason to hit the platforms again, and during development
   * that means a scrape on every file save.
   */
  scrapeOnStart: bool(process.env.SCRAPE_ON_START, false),

  repoRoot,
  serverDir,
  websiteDir: path.join(repoRoot, 'website'),
} as const;
