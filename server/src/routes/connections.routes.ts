import { Router } from 'express';
import { asyncHandler, badRequest } from '../utils/http';
import { isScraping } from '../scrapers/runner';
import { browserStatus, invalidateBrowserStatus } from '../services/browser.service';
import { resumeWatcher, suspendWatcher, watcherStatus } from '../watcher';
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

/**
 * Take the browser profile off the Upwork watcher for the duration of `fn`.
 *
 * Only one process may hold a Chromium profile open. The watcher sits on the
 * Upwork tab indefinitely, so signing in or checking a session while it is
 * running fails with a lock error that reads like a bug. Pausing it first is
 * the difference between "sign in again" working and it never working while
 * alerts are on.
 *
 * Only resumes a watcher that was actually running: someone who pressed Pause
 * an hour ago should not find alerts switched back on because they re-checked
 * a session.
 */
async function withProfile<T>(fn: () => Promise<T>): Promise<T> {
  const paused = await suspendWatcher();
  try {
    return await fn();
  } finally {
    if (paused) resumeWatcher('browser profile handed back');
  }
}

connectionsRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    res.json({
      platforms: CONNECTABLE_PLATFORMS,
      connections: listConnections(),
      signIn: getSignInState(),
      browser: await browserStatus(),
      // So the Connections page can say why Upwork behaves differently from X.
      watcher: watcherStatus(),
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
    const platform = platformParam(req.params.platform);

    // Refuse up front rather than opening a browser window that cannot exist.
    invalidateBrowserStatus();
    const browser = await browserStatus();
    if (!browser.reachable) {
      res.status(409).json({ error: `Chrome is not running at ${browser.url}. ${browser.hint}` });
      return;
    }

    // Not `withProfile`: the window stays open for as long as the person needs
    // it, so the profile goes back from sign-in's own completion callback
    // rather than when this request returns a moment from now.
    const paused = await suspendWatcher();
    try {
      startSignIn(platform, () => {
        if (paused) resumeWatcher('sign-in finished');
      });
    } catch (err) {
      if (paused) resumeWatcher('sign-in could not start');
      throw err;
    }

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

    // Same guard as sign-in. Without it, checking a session with Chrome closed
    // surfaces a Playwright connect error as a 500, and — now that a check
    // borrows the browser profile — stops and restarts the watcher to do it.
    invalidateBrowserStatus();
    const browser = await browserStatus();
    if (!browser.reachable) {
      res.status(409).json({ error: `Chrome is not running at ${browser.url}. ${browser.hint}` });
      return;
    }

    const session = await withProfile(() => checkConnection(platform));
    res.json({ session, connections: listConnections() });
  }),
);

connectionsRouter.delete(
  '/:platform',
  asyncHandler(async (req, res) => {
    const platform = platformParam(req.params.platform);
    await withProfile(() => disconnect(platform));
    res.json({ ok: true, connections: listConnections() });
  }),
);
