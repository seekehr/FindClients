import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../utils/http';
import {
  clearOpportunities,
  listOpportunities,
  markAllOpportunitiesSeen,
  markOpportunitySeen,
} from '../services/opportunity.service';

export const opportunitiesRouter = Router();

const listQuery = z.object({
  unseen: z.coerce.boolean().optional(),
  rejected: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

opportunitiesRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { unseen, rejected, limit } = listQuery.parse(req.query);
    res.json(listOpportunities({ unseenOnly: unseen ?? false, rejected: rejected ?? false, limit }));
  }),
);

opportunitiesRouter.post(
  '/seen',
  asyncHandler(async (_req, res) => {
    res.json({ ok: true, marked: markAllOpportunitiesSeen() });
  }),
);

opportunitiesRouter.post(
  '/:id/seen',
  asyncHandler(async (req, res) => {
    markOpportunitySeen(req.params.id);
    res.json({ ok: true });
  }),
);

/**
 * Empty the panel.
 *
 * Only the alerts go. The leads behind them stay on the Leads page, so
 * clearing the feed can never lose you a job you had not read yet.
 */
opportunitiesRouter.delete(
  '/',
  asyncHandler(async (_req, res) => {
    res.json({ ok: true, removed: clearOpportunities() });
  }),
);
