import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, badRequest, notFound } from '../utils/http';
import { requireInternalKey } from '../middleware/internalAuth';
import { getConfig } from '../services/config.service';
import { getPublicUser } from '../services/user.service';
import {
  CREDENTIAL_PLATFORMS,
  getConnectionsForPlatform,
  isCredentialPlatform,
} from '../services/credential.service';

/**
 * Service-to-service API for the scrapers.
 *
 * The scrapers in ../../scrapper are their own workspace: rather than reaching
 * into the database, they ask the server over HTTP for the configuration and
 * session they should run with. That keeps Supabase credentials in one process
 * and lets a scraper run out-of-process without any code change.
 *
 * Every route here requires the INTERNAL_API_KEY shared secret. Nothing under
 * this router is reachable with an end-user access token.
 */
export const internalRouter = Router();
internalRouter.use(requireInternalKey);

const uuid = z.string().uuid('Expected a user id');

/** The running user's saved configuration — keywords, thresholds, limits. */
internalRouter.get(
  '/users/:userId/config',
  asyncHandler(async (req, res) => {
    const parsed = uuid.safeParse(req.params.userId);
    if (!parsed.success) throw badRequest('Invalid user id');

    const user = await getPublicUser(parsed.data);
    if (!user) throw notFound('User not found');

    res.json({ userId: parsed.data, config: await getConfig(parsed.data) });
  }),
);

/**
 * Every connected session for a platform, with cookies decrypted and ready to
 * inject. This is the most sensitive payload the server produces — it is why
 * this router is key-gated and must never be exposed publicly.
 */
internalRouter.get(
  '/platforms/:platform/connections',
  asyncHandler(async (req, res) => {
    const platform = req.params.platform;
    if (!isCredentialPlatform(platform)) throw badRequest(`Unsupported platform: ${platform}`);

    const connections = await getConnectionsForPlatform(platform);

    // Attach each user's config so a worker can start scraping from one call.
    const withConfig = await Promise.all(
      connections.map(async (conn) => ({
        userId: conn.userId,
        cookies: conn.cookies,
        config: await getConfig(conn.userId),
      })),
    );

    res.json({ platform, connections: withConfig });
  }),
);

/** Which platforms can hold a connected session at all. */
internalRouter.get('/platforms', (_req, res) => {
  res.json({ platforms: CREDENTIAL_PLATFORMS });
});
