import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../utils/http';
import { requireAuth } from '../middleware/auth';
import { getConfig, updateConfig } from '../services/config.service';
import { PLATFORMS } from '../types';

export const configRouter = Router();
configRouter.use(requireAuth);

const platform = z.enum(['upwork', 'twitter', 'discord', 'reddit', 'linkedin']);

/**
 * Bounds mirror the CHECK constraints in supabase/migrations/0001_init.sql, so
 * a bad value is rejected with a readable 400 instead of a Postgres error.
 */
const patchSchema = z
  .object({
    emailNotifications: z.boolean(),
    pushNotifications: z.boolean(),
    newLeadsNotification: z.boolean(),
    discordWebhookUrl: z.union([z.literal(''), z.string().url().max(500)]),

    platforms: z.array(platform).max(PLATFORMS.length),
    keywords: z.array(z.string().trim().min(1).max(80)).max(50),
    excludedKeywords: z.array(z.string().trim().min(1).max(80)).max(50),
    minBudget: z.number().int().min(0).max(1_000_000),

    scrapeEnabled: z.boolean(),
    leadsPerRun: z.number().int().min(1).max(100),
    maxPostAgeHours: z.number().int().min(1).max(720),

    twitterMinLikes: z.number().int().min(0).max(1_000_000),
    twitterMinViews: z.number().int().min(0).max(100_000_000),
    twitterLimitPerKeyword: z.number().int().min(1).max(100),

    upworkJobsUrl: z.string().url().max(500),
    upworkFetchDetails: z.boolean(),
    upworkMaxAgeHours: z.number().int().min(1).max(720),
  })
  .partial();

configRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    res.json({ config: await getConfig(req.user!.id), platforms: PLATFORMS });
  }),
);

configRouter.put(
  '/',
  asyncHandler(async (req, res) => {
    const patch = patchSchema.parse(req.body);
    res.json({ config: await updateConfig(req.user!.id, patch) });
  }),
);
