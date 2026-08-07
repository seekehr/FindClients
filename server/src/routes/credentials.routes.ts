import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, badRequest } from '../utils/http';
import { requireAuth } from '../middleware/auth';
import {
  CREDENTIAL_PLATFORMS,
  connectCredential,
  disconnectCredential,
  isCredentialPlatform,
  listCredentials,
} from '../services/credential.service';

export const credentialsRouter = Router();
credentialsRouter.use(requireAuth);

// List which platforms the user has connected (masked — no secrets).
credentialsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    res.json({
      platforms: CREDENTIAL_PLATFORMS,
      connections: await listCredentials(req.user!.id),
    });
  }),
);

const connectSchema = z.object({
  // The full cookie string copied from the browser's Cookie request header.
  cookies: z.string().min(1).max(20_000),
});

credentialsRouter.put(
  '/:platform',
  asyncHandler(async (req, res) => {
    const platform = req.params.platform;
    if (!isCredentialPlatform(platform)) throw badRequest(`Unsupported platform: ${platform}`);
    const { cookies } = connectSchema.parse(req.body);
    res.json({ connection: await connectCredential(req.user!.id, platform, cookies) });
  }),
);

credentialsRouter.delete(
  '/:platform',
  asyncHandler(async (req, res) => {
    const platform = req.params.platform;
    if (!isCredentialPlatform(platform)) throw badRequest(`Unsupported platform: ${platform}`);
    await disconnectCredential(req.user!.id, platform);
    res.json({ ok: true });
  }),
);
