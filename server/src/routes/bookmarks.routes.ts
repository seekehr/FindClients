import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../utils/http';
import { requireAuth } from '../middleware/auth';
import { listLeads } from '../services/lead.service';

export const bookmarksRouter = Router();
bookmarksRouter.use(requireAuth);

const query = z.object({
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
});

// Bookmarks are just the leads the user has flagged.
bookmarksRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { page, limit } = query.parse(req.query);
    res.json(await listLeads({ userId: req.user!.id, bookmarked: true, page, limit }));
  }),
);
