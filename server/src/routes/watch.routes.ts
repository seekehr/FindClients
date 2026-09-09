import { Router } from 'express';
import { asyncHandler } from '../utils/http';
import { browserStatus } from '../services/browser.service';
import { getConfig } from '../services/config.service';
import { checkNow, startWatcher, stopWatcher, watcherStatus } from '../watcher';

/**
 * The Upwork job watcher, as the UI sees it.
 *
 * Note what is missing: there is no endpoint here that collects. `check-now`
 * reloads the one page the watcher already has open — the same thing pressing
 * F5 does — and every job it finds still waits out its human delay before it
 * reaches you. Nothing in this router can be used to pull the Upwork feed in
 * bulk, which is the entire point of the watcher existing.
 */
export const watchRouter = Router();

watchRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    res.json({ watcher: watcherStatus(), browser: await browserStatus() });
  }),
);

watchRouter.post(
  '/start',
  asyncHandler(async (_req, res) => {
    if (!getConfig().upworkWatchEnabled) {
      res.status(409).json({
        error: 'Upwork job alerts are switched off. Turn them on in Config first.',
      });
      return;
    }
    res.json({ watcher: startWatcher('started from the app') });
  }),
);

watchRouter.post(
  '/stop',
  asyncHandler(async (_req, res) => {
    res.json({ watcher: await stopWatcher('paused from the app') });
  }),
);

/** Reload the open tab now instead of waiting out the interval. */
watchRouter.post(
  '/check',
  asyncHandler(async (_req, res) => {
    const watcher = checkNow();
    if (!watcher) {
      res.status(409).json({
        error: 'The watcher is not running. Start it first.',
        watcher: watcherStatus(),
      });
      return;
    }
    res.json({ watcher });
  }),
);
