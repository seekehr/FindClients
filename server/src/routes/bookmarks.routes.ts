import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../utils/http';
import { listLeads } from '../services/lead.service';

export const bookmarksRouter = Router();

const query = z.object({
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
});

// Bookmarks are just the leads you have flagged.
bookmarksRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { page, limit } = query.parse(req.query);
    res.json(listLeads({ bookmarked: true, page, limit }));
  }),
);
