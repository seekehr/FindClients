import { Router } from 'express';
import { asyncHandler } from '../utils/http';
import { requireAuth } from '../middleware/auth';
import { byPlatform, leadsTrend, overview, recentScrapeRuns } from '../services/analytics.service';

export const analyticsRouter = Router();
analyticsRouter.use(requireAuth);

analyticsRouter.get(
  '/overview',
  asyncHandler(async (req, res) => {
    res.json(overview(req.user!.id));
  }),
);

analyticsRouter.get(
  '/platforms',
  asyncHandler(async (_req, res) => {
    res.json({ data: byPlatform() });
  }),
);

analyticsRouter.get(
  '/trend',
  asyncHandler(async (_req, res) => {
    res.json({ data: leadsTrend() });
  }),
);

analyticsRouter.get(
  '/scrape-runs',
  asyncHandler(async (_req, res) => {
    res.json({ data: recentScrapeRuns() });
  }),
);
