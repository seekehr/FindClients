import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../utils/http';
import { requireAuth } from '../middleware/auth';
import { getSettings, updateSettings } from '../services/settings.service';

export const settingsRouter = Router();
settingsRouter.use(requireAuth);

const platform = z.enum(['upwork', 'twitter', 'discord', 'reddit', 'linkedin']);

const patchSchema = z.object({
  emailNotifications: z.boolean().optional(),
  pushNotifications: z.boolean().optional(),
  newLeadsNotification: z.boolean().optional(),
  platforms: z.array(platform).optional(),
  keywords: z.array(z.string().max(50)).max(50).optional(),
});

settingsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    res.json({ settings: getSettings(req.user!.id) });
  }),
);

settingsRouter.put(
  '/',
  asyncHandler(async (req, res) => {
    const patch = patchSchema.parse(req.body);
    res.json({ settings: updateSettings(req.user!.id, patch) });
  }),
);
