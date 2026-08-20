import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, notFound } from '../utils/http';
import { requireAuth } from '../middleware/auth';
import { cache } from '../cache';
import { clearLeads, getLead, listLeads, setBookmark, setLeadStatus } from '../services/lead.service';
import type { LeadStatus } from '../types';

export const leadsRouter = Router();
leadsRouter.use(requireAuth);

const statusEnum = z.enum(['new', 'viewed', 'contacted', 'won', 'archived']);

const listQuery = z.object({
  platform: z.enum(['upwork', 'twitter', 'discord', 'reddit', 'linkedin']).optional(),
  q: z.string().max(200).optional(),
  status: statusEnum.optional(),
  bookmarked: z.coerce.boolean().optional(),
  ai: z.enum(['qualified', 'rejected', 'unchecked']).optional(),
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

    const result = await listLeads({ userId, ...params });
    cache.set(cacheKey, result, 15_000);
    res.json(result);
  }),
);

leadsRouter.delete(
  '/',
  asyncHandler(async (req, res) => {
    const removed = await clearLeads(req.user!.id);
    res.json({ ok: true, removed });
  }),
);

leadsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const lead = await getLead(req.user!.id, req.params.id);
    if (!lead) throw notFound('Lead not found');
    res.json({ lead });
  }),
);

leadsRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const { status } = z.object({ status: statusEnum }).parse(req.body);
    if (!(await getLead(req.user!.id, req.params.id))) throw notFound('Lead not found');
    const result = await setLeadStatus(req.user!.id, req.params.id, status as LeadStatus);
    res.json({ ok: true, ...result });
  }),
);

leadsRouter.put(
  '/:id/bookmark',
  asyncHandler(async (req, res) => {
    if (!(await getLead(req.user!.id, req.params.id))) throw notFound('Lead not found');
    const result = await setBookmark(req.user!.id, req.params.id, true);
    res.json({ ok: true, ...result });
  }),
);

leadsRouter.delete(
  '/:id/bookmark',
  asyncHandler(async (req, res) => {
    if (!(await getLead(req.user!.id, req.params.id))) throw notFound('Lead not found');
    const result = await setBookmark(req.user!.id, req.params.id, false);
    res.json({ ok: true, ...result });
  }),
);
