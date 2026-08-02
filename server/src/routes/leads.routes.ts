import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, notFound } from '../utils/http';
import { requireAuth } from '../middleware/auth';
import { cache } from '../cache';
import {
  getLead,
  listLeads,
  setBookmark,
  setLeadStatus,
} from '../services/lead.service';
import type { LeadStatus } from '../types';

export const leadsRouter = Router();
leadsRouter.use(requireAuth);

const listQuery = z.object({
  platform: z.enum(['upwork', 'twitter', 'discord', 'reddit', 'linkedin']).optional(),
  q: z.string().max(200).optional(),
  status: z.enum(['new', 'viewed', 'contacted', 'won', 'archived']).optional(),
  bookmarked: z.coerce.boolean().optional(),
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
});

leadsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const params = listQuery.parse(req.query);
    const userId = req.user!.id;

    const cacheKey = `leads:${userId}:${JSON.stringify(params)}`;
    const cached = cache.get(cacheKey);
    if (cached) return res.json(cached);

    const result = listLeads({ userId, ...params });
    cache.set(cacheKey, result, 15_000);
    res.json(result);
  }),
);

leadsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const lead = getLead(req.user!.id, req.params.id);
    if (!lead) throw notFound('Lead not found');
    res.json({ lead });
  }),
);

leadsRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const { status } = z
      .object({ status: z.enum(['new', 'viewed', 'contacted', 'won', 'archived']) })
      .parse(req.body);
    if (!getLead(req.user!.id, req.params.id)) throw notFound('Lead not found');
    const result = setLeadStatus(req.user!.id, req.params.id, status as LeadStatus);
    res.json({ ok: true, ...result });
  }),
);

leadsRouter.put(
  '/:id/bookmark',
  asyncHandler(async (req, res) => {
    if (!getLead(req.user!.id, req.params.id)) throw notFound('Lead not found');
    const result = setBookmark(req.user!.id, req.params.id, true);
    res.json({ ok: true, ...result });
  }),
);

leadsRouter.delete(
  '/:id/bookmark',
  asyncHandler(async (req, res) => {
    if (!getLead(req.user!.id, req.params.id)) throw notFound('Lead not found');
    const result = setBookmark(req.user!.id, req.params.id, false);
    res.json({ ok: true, ...result });
  }),
);
