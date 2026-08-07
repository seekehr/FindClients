import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../utils/http';
import { requireAuth } from '../middleware/auth';
import { byPlatform, leadsTrend, overview, recentScrapeRuns } from '../services/analytics.service';

export const analyticsRouter = Router();
analyticsRouter.use(requireAuth);

analyticsRouter.get(
  '/overview',
  asyncHandler(async (req, res) => {
    res.json(await overview(req.user!.id));
  }),
);

analyticsRouter.get(
  '/platforms',
  asyncHandler(async (_req, res) => {
    res.json({ data: await byPlatform() });
  }),
);

analyticsRouter.get(
  '/trend',
  asyncHandler(async (req, res) => {
    const { days } = z
      .object({ days: z.coerce.number().int().min(1).max(365).optional() })
      .parse(req.query);
    res.json({ data: await leadsTrend(days ?? 14) });
  }),
);

analyticsRouter.get(
  '/scrape-runs',
  asyncHandler(async (req, res) => {
    res.json({ data: await recentScrapeRuns(req.user!.id) });
  }),
);
