import { Router } from 'express';
import { asyncHandler, badRequest } from '../utils/http';
import { isScraping } from '../scrapers/runner';
import {
  CONNECTABLE_PLATFORMS,
  checkConnection,
  disconnect,
  getSignInState,
  isConnectablePlatform,
  listConnections,
  startSignIn,
} from '../services/connection.service';

export const connectionsRouter = Router();

function platformParam(value: string) {
  if (!isConnectablePlatform(value)) throw badRequest(`Unsupported platform: ${value}`);
  return value;
}

connectionsRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    res.json({
      platforms: CONNECTABLE_PLATFORMS,
      connections: listConnections(),
      signIn: getSignInState(),
    });
  }),
);

/**
 * Start signing in: opens a real browser window on the machine running the
 * server. Returns 202 immediately — the window stays open for as long as the
 * person needs, and the page polls GET / for progress.
 */
connectionsRouter.post(
  '/:platform/sign-in',
  asyncHandler(async (req, res) => {
    startSignIn(platformParam(req.params.platform));
    res.status(202).json({ ok: true, signIn: getSignInState() });
  }),
);

/** Re-check a saved session against the live site. */
connectionsRouter.post(
  '/:platform/check',
  asyncHandler(async (req, res) => {
    const platform = platformParam(req.params.platform);
    if (isScraping()) {
      res.status(409).json({ error: 'A scrape is running — try again once it finishes.' });
      return;
    }
    res.json({ session: await checkConnection(platform), connections: listConnections() });
  }),
);

connectionsRouter.delete(
  '/:platform',
  asyncHandler(async (req, res) => {
    await disconnect(platformParam(req.params.platform));
    res.json({ ok: true, connections: listConnections() });
  }),
);
