import { Router } from 'express';
import { asyncHandler } from '../utils/http';
import { requireAuth } from '../middleware/auth';
import { rateLimit } from '../middleware/rateLimit';
import { logger } from '../utils/logger';
import { runScrapeCycle } from '../scrapers/runner';
import { recentScrapeRuns, scrapeStatus } from '../services/analytics.service';

export const scrapeRouter = Router();
scrapeRouter.use(requireAuth);

/**
 * Trigger a scrape for the calling user's own connected accounts.
 *
 * A full cycle drives a real browser and can take minutes, so this does not
 * wait for it: the run is started in the background and the client follows it
 * with GET /scrape/status. Throttled so it can't be spammed.
 */
scrapeRouter.post(
  '/run',
  rateLimit({ windowMs: 30_000, max: 3, bucket: 'scrape-run' }),
  asyncHandler(async (req, res) => {
    const userId = req.user!.id;

    void runScrapeCycle({ userId }).catch((err) =>
      logger.error(`Manual scrape for ${userId} crashed`, (err as Error).message),
    );

    res.status(202).json({ ok: true, started: true });
  }),
);

// Is a scrape in flight right now? Polled by the UI, so it stays cheap.
scrapeRouter.get(
  '/status',
  asyncHandler(async (req, res) => {
    res.json(await scrapeStatus(req.user!.id));
  }),
);

scrapeRouter.get(
  '/runs',
  asyncHandler(async (req, res) => {
    res.json({ data: await recentScrapeRuns(req.user!.id) });
  }),
);
