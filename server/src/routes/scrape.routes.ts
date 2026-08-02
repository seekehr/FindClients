import { Router } from 'express';
import { asyncHandler } from '../utils/http';
import { requireAuth } from '../middleware/auth';
import { rateLimit } from '../middleware/rateLimit';
import { runScrapeCycle } from '../scrapers/runner';
import { recentScrapeRuns } from '../services/analytics.service';

export const scrapeRouter = Router();
scrapeRouter.use(requireAuth);

// Manually trigger a scrape cycle (handy for demos). Throttled so it can't be spammed.
scrapeRouter.post(
  '/run',
  rateLimit({ windowMs: 30_000, max: 3, bucket: 'scrape-run' }),
  asyncHandler(async (_req, res) => {
    const summary = await runScrapeCycle();
    res.json({ ok: true, summary });
  }),
);

scrapeRouter.get(
  '/runs',
  asyncHandler(async (_req, res) => {
    res.json({ data: recentScrapeRuns() });
  }),
);
