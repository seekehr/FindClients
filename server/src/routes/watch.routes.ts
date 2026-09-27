import { Router } from 'express';
import { asyncHandler, badRequest } from '../utils/http';
import { browserStatus } from '../services/browser.service';
import {
  checkNow,
  isWatchedPlatform,
  startWatcher,
  stopWatcher,
  watcherStatus,
  watcherStatuses,
} from '../watcher';

/**
 * The job watchers — Upwork and LinkedIn — as the UI sees them.
 *
 * Note what is missing: there is no endpoint here that collects. `check`
 * reloads the one page a watcher already has open — the same thing pressing
 * F5 does — and every job it finds still waits out its human delay before it
 * reaches you. Nothing in this router can be used to pull a jobs feed in bulk,
 * which is the entire point of the watchers existing.
 */
export const watchRouter = Router();

function platformParam(value: string) {
  if (!isWatchedPlatform(value)) throw badRequest(`${value} has no job alerts`);
  return value;
}

watchRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    res.json({ watchers: watcherStatuses(), browser: await browserStatus() });
  }),
);

watchRouter.post(
  '/:platform/start',
  asyncHandler(async (req, res) => {
    const platform = platformParam(req.params.platform);
    const current = watcherStatus(platform);
    if (!current.enabled) {
      res.status(409).json({
        error: `${current.name} are switched off. Turn them on in Config first.`,
      });
      return;
    }
    res.json({ watcher: startWatcher(platform, 'started from the app') });
  }),
);

watchRouter.post(
  '/:platform/stop',
  asyncHandler(async (req, res) => {
    const platform = platformParam(req.params.platform);
    res.json({ watcher: await stopWatcher(platform, 'paused from the app') });
  }),
);

/** Reload the open tab now instead of waiting out the interval. */
watchRouter.post(
  '/:platform/check',
  asyncHandler(async (req, res) => {
    const platform = platformParam(req.params.platform);
    const watcher = checkNow(platform);
    if (!watcher) {
      res.status(409).json({
        error: 'The watcher is not running. Start it first.',
        watcher: watcherStatus(platform),
      });
      return;
    }
    res.json({ watcher });
  }),
);
