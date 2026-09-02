import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../utils/http';
import { requireAuth } from '../middleware/auth';
import { getConfig, updateConfig } from '../services/config.service';
import { AI_MODELS, PLATFORMS } from '../types';

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

    aiEnabled: z.boolean(),
    // Long enough for real criteria with examples, short enough that it can't
    // be used to smuggle a novel into every review call.
    aiPrompt: z.string().max(4000),
    aiModel: z.enum(AI_MODELS),
    aiMinScore: z.number().int().min(0).max(100),
    aiAutoArchive: z.boolean(),
    /**
     * The user's own Google Gemini key. Write-only: it is stored encrypted and
     * never returned — the client gets `aiApiKeySet` and a masked hint back.
     * '' clears the stored key. The character class rejects the most common
     * paste mistakes (a trailing newline, a copied "key=" prefix, a whole URL)
     * before they turn into a 400 from Google on every lead.
     */
    aiApiKey: z.union([
      z.literal(''),
      z
        .string()
        .trim()
        .min(20, 'That does not look like a Gemini API key.')
        .max(200)
        .regex(/^[A-Za-z0-9_-]+$/, 'A Gemini API key contains only letters, digits, - and _.'),
    ]),
  })
  .partial();

configRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const config = await getConfig(req.user!.id);
    res.json({
      config,
      platforms: PLATFORMS,
      // The Config page needs to distinguish "you switched this off" from
      // "you have not given us a key yet", which `aiEnabled` alone cannot say.
      ai: { available: config.aiApiKeySet, models: AI_MODELS },
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
