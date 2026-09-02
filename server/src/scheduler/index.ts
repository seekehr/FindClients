import cron, { type ScheduledTask } from 'node-cron';
import { env } from '../config/env';
import { logger } from '../utils/logger';
import { runScrapeCycle } from '../scrapers/runner';

let task: ScheduledTask | null = null;
let pending: NodeJS.Timeout | null = null;

function fire(reason: string): void {
  void runScrapeCycle().catch((err) =>
    logger.error(`${reason} scrape crashed`, (err as Error).message),
  );
}

/**
 * Start the background scheduler.
 *
 * Cycles are jittered rather than fired exactly on the cron tick. Scraping
 * from your own IP with your own session looks like ordinary browsing until it
 * happens at 12:00:00, 12:30:00 and 13:00:00 to the second, forever — a
 * pattern no human produces and every rate-limiter notices.
 */
export function startScheduler(): void {
  if (!env.schedulerEnabled) {
    logger.info('Scheduler disabled (SCHEDULER_ENABLED=false)');
    return;
  }
  if (!cron.validate(env.scrapeCron)) {
    logger.error(`Invalid SCRAPE_CRON expression: "${env.scrapeCron}" — scheduler not started`);
    return;
  }

  task = cron.schedule(env.scrapeCron, () => {
    const delay = env.scrapeJitterMs > 0 ? Math.floor(Math.random() * env.scrapeJitterMs) : 0;
    if (!delay) return fire('Scheduled');

    logger.info(`Next scrape in ${Math.round(delay / 1000)}s`);
    pending = setTimeout(() => {
      pending = null;
      fire('Scheduled');
    }, delay);
    pending.unref?.();
  });

  logger.info(
    `Scheduler started (cron: "${env.scrapeCron}"` +
      (env.scrapeJitterMs > 0 ? `, up to ${Math.round(env.scrapeJitterMs / 1000)}s jitter)` : ')'),
  );

  // Off by default. Restarting the app is not a reason to hit the platforms
  // again, and in development that would mean a scrape on every file save.
  if (env.scrapeOnStart) fire('Startup');
}

export function stopScheduler(): void {
  task?.stop();
  task = null;
  if (pending) clearTimeout(pending);
  pending = null;
}
