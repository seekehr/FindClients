import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, badRequest } from '../utils/http';
import {
  CREDENTIAL_PLATFORMS,
  connectCredential,
  disconnectCredential,
  isCredentialPlatform,
  listCredentials,
} from '../services/credential.service';

export const credentialsRouter = Router();

// Which platforms are connected (masked — never the cookies themselves).
credentialsRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    res.json({ platforms: CREDENTIAL_PLATFORMS, connections: listCredentials() });
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
    res.json({ connection: connectCredential(platform, cookies) });
  }),
);

credentialsRouter.delete(
  '/:platform',
  asyncHandler(async (req, res) => {
    const platform = req.params.platform;
    if (!isCredentialPlatform(platform)) throw badRequest(`Unsupported platform: ${platform}`);
    disconnectCredential(platform);
    res.json({ ok: true });
  }),
);
