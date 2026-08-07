import cron, { type ScheduledTask } from 'node-cron';
import { env } from '../config/env';
import { logger } from '../utils/logger';
import { runScrapeCycle } from '../scrapers/runner';

let task: ScheduledTask | null = null;

/**
 * Start the background scheduler. Respects rate limits implicitly by running
 * on a fixed cron cadence and skipping overlapping cycles (see runner).
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
    void runScrapeCycle().catch((err) =>
      logger.error('Scrape cycle crashed', (err as Error).message),
    );
  });

  logger.info(`Scheduler started (cron: "${env.scrapeCron}")`);
}

export function stopScheduler(): void {
  task?.stop();
  task = null;
}
