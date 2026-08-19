import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../utils/http';
import { requireAuth } from '../middleware/auth';
import { getConfig, updateConfig } from '../services/config.service';
import { aiAvailable } from '../services/ai.service';
import { PLATFORMS } from '../types';

export const configRouter = Router();
configRouter.use(requireAuth);

const platform = z.enum(['upwork', 'twitter', 'discord', 'reddit', 'linkedin']);

/**
 * Models the qualifier may be pointed at. An allow-list rather than free text:
 * a typo here would fail on every lead of every scrape cycle, and the failure
 * would look like "the AI is broken", not "that model does not exist".
 */
const AI_MODELS = [
  'claude-opus-5',
  'claude-sonnet-5',
  'claude-haiku-4-5',
] as const;

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

    aiEnabled: z.boolean(),
    // Long enough for real criteria with examples, short enough that it can't
    // be used to smuggle a novel into every review call.
    aiPrompt: z.string().max(4000),
    aiModel: z.enum(AI_MODELS),
    aiMinScore: z.number().int().min(0).max(100),
    aiAutoArchive: z.boolean(),
  })
  .partial();

configRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    res.json({
      config: await getConfig(req.user!.id),
      platforms: PLATFORMS,
      // The Config page needs to distinguish "you switched this off" from
      // "this server has no API key", which no per-user setting can express.
      ai: { available: aiAvailable(), models: AI_MODELS },
    });
  }),
);

configRouter.put(
  '/',
  asyncHandler(async (req, res) => {
    const patch = patchSchema.parse(req.body);
    res.json({ config: await updateConfig(req.user!.id, patch) });
  }),
);
