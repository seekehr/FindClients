import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../utils/http';
import { byPlatform, leadsTrend, overview, recentScrapeRuns } from '../services/analytics.service';

export const analyticsRouter = Router();

analyticsRouter.get(
  '/overview',
  asyncHandler(async (_req, res) => {
    res.json(overview());
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
  asyncHandler(async (req, res) => {
    const { days } = z
      .object({ days: z.coerce.number().int().min(1).max(365).optional() })
      .parse(req.query);
    res.json({ data: leadsTrend(days ?? 14) });
  }),
);

analyticsRouter.get(
  '/scrape-runs',
  asyncHandler(async (_req, res) => {
    res.json({ data: recentScrapeRuns() });
  }),
);
