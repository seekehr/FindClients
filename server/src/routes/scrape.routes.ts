import { Router } from 'express';
import { asyncHandler } from '../utils/http';
import { requireAuth } from '../middleware/auth';
import { rateLimit } from '../middleware/rateLimit';
import { runScrapeCycle } from '../scrapers/runner';
import { recentScrapeRuns } from '../services/analytics.service';

export const scrapeRouter = Router();
scrapeRouter.use(requireAuth);

// Manually trigger a scrape for the calling user's own connected accounts.
// Throttled so it can't be spammed.
scrapeRouter.post(
  '/run',
  rateLimit({ windowMs: 30_000, max: 3, bucket: 'scrape-run' }),
  asyncHandler(async (req, res) => {
    const summary = await runScrapeCycle({ userId: req.user!.id });
    res.json({ ok: true, summary });
  }),
);

scrapeRouter.get(
  '/runs',
  asyncHandler(async (req, res) => {
    res.json({ data: await recentScrapeRuns(req.user!.id) });
  }),
);
