import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, notFound } from '../utils/http';
import {
  clearLeads,
  getLead,
  listLeads,
  restoreClearedLeads,
  setBookmark,
  setLeadStatus,
} from '../services/lead.service';
import type { LeadStatus } from '../types';

export const leadsRouter = Router();

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
    res.json(listLeads(listQuery.parse(req.query)));
  }),
);

leadsRouter.delete(
  '/',
  asyncHandler(async (_req, res) => {
    res.json({ ok: true, removed: clearLeads() });
  }),
);

/**
 * Forget every dismissal, so previously cleared leads can be found again.
 *
 * Clearing suppresses a lead for 30 days by source hash. That is usually what
 * you want, but it also means clearing right after a scrape hides everything
 * that scrape found — this is the way back.
 */
leadsRouter.post(
  '/restore-cleared',
  asyncHandler(async (_req, res) => {
    res.json({ ok: true, restored: restoreClearedLeads() });
  }),
);

leadsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const lead = getLead(req.params.id);
    if (!lead) throw notFound('Lead not found');
    res.json({ lead });
  }),
);

leadsRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const { status } = z.object({ status: statusEnum }).parse(req.body);
    const result = setLeadStatus(req.params.id, status as LeadStatus);
    if (!result) throw notFound('Lead not found');
    res.json({ ok: true, ...result });
  }),
);

leadsRouter.put(
  '/:id/bookmark',
  asyncHandler(async (req, res) => {
    const result = setBookmark(req.params.id, true);
    if (!result) throw notFound('Lead not found');
    res.json({ ok: true, ...result });
  }),
);

leadsRouter.delete(
  '/:id/bookmark',
  asyncHandler(async (req, res) => {
    const result = setBookmark(req.params.id, false);
    if (!result) throw notFound('Lead not found');
    res.json({ ok: true, ...result });
  }),
);
