import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../utils/http';
import { getConfig, resetConfig, updateConfig } from '../services/config.service';
import { AI_MODELS, PLATFORMS } from '../types';

export const configRouter = Router();

const platform = z.enum(['upwork', 'twitter', 'discord', 'reddit', 'linkedin']);

/**
 * Bounds are enforced here because nothing downstream will. There is no
 * database with CHECK constraints any more — this schema is the only thing
 * standing between a typo on the Config page and a scraper looping 100,000
 * times, so it is deliberately strict.
 */
const patchSchema = z
  .object({
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
    // Long enough for real criteria with examples, short enough that it cannot
    // be used to smuggle a novel into every review call.
    aiPrompt: z.string().max(4000),
    aiModel: z.enum(AI_MODELS),
    aiMinScore: z.number().int().min(0).max(100),
    aiAutoArchive: z.boolean(),
    /**
     * Your Google Gemini key. Write-only: the client gets `aiApiKeySet` and a
     * masked hint back, never the key. '' clears it. The character class
     * rejects the most common paste mistakes (a trailing newline, a copied
     * "key=" prefix, a whole URL) before they turn into a 400 from Google on
     * every single lead.
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
  asyncHandler(async (_req, res) => {
    const config = getConfig();
    res.json({
      config,
      platforms: PLATFORMS,
      // The Config page needs to distinguish "you switched this off" from
      // "you have not saved a key yet", which `aiEnabled` alone cannot say.
      ai: { available: config.aiApiKeySet, models: AI_MODELS },
    });
  }),
);

configRouter.put(
  '/',
  asyncHandler(async (req, res) => {
    res.json({ config: updateConfig(patchSchema.parse(req.body)) });
  }),
);

configRouter.post(
  '/reset',
  asyncHandler(async (_req, res) => {
    res.json({ config: resetConfig() });
  }),
);
