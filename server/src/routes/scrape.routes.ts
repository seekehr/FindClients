import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../utils/http';
import { logger } from '../utils/logger';
import { isScraping, runScrapeCycle } from '../scrapers/runner';
import { recentScrapeRuns, scrapeStatus } from '../services/analytics.service';
import {
  clickCaptcha,
  dismissCaptcha,
  getActiveCaptcha,
  refreshScreenshot,
} from '../services/captcha.service';

export const scrapeRouter = Router();

/**
 * Start a scrape now.
 *
 * A cycle drives a real browser and can take minutes, so this does not wait
 * for it: the run starts in the background and the UI follows it with
 * GET /scrape/status.
 */
scrapeRouter.post(
  '/run',
  asyncHandler(async (_req, res) => {
    if (isScraping()) {
      res.status(409).json({ ok: false, error: 'A scrape is already running.' });
      return;
    }

    void runScrapeCycle().catch((err) =>
      logger.error('Manual scrape crashed', (err as Error).message),
    );

    res.status(202).json({ ok: true, started: true });
  }),
);

// Is a scrape in flight right now? Polled by the UI, so it stays cheap.
scrapeRouter.get(
  '/status',
  asyncHandler(async (_req, res) => {
    res.json(scrapeStatus());
  }),
);

scrapeRouter.get(
  '/runs',
  asyncHandler(async (_req, res) => {
    res.json({ data: recentScrapeRuns() });
  }),
);

scrapeRouter.get(
  '/captcha',
  asyncHandler(async (_req, res) => {
    res.json({ challenge: getActiveCaptcha() });
  }),
);

scrapeRouter.post(
  '/captcha/click',
  asyncHandler(async (req, res) => {
    const { sessionId, x, y } = z
      .object({ sessionId: z.string(), x: z.number(), y: z.number() })
      .parse(req.body);
    const result = await clickCaptcha(sessionId, x, y);
    if (!result) {
      res.status(404).json({ error: 'Captcha session expired' });
      return;
    }
    res.json(result);
  }),
);

scrapeRouter.post(
  '/captcha/dismiss',
  asyncHandler(async (req, res) => {
    const { sessionId } = z.object({ sessionId: z.string() }).parse(req.body);
    dismissCaptcha(sessionId);
    res.json({ ok: true });
  }),
);

scrapeRouter.get(
  '/captcha/screenshot',
  asyncHandler(async (req, res) => {
    const sessionId = z.string().parse(req.query.sessionId);
    const screenshot = await refreshScreenshot(sessionId);
    if (!screenshot) {
      res.status(404).json({ error: 'Captcha session expired' });
      return;
    }
    res.json({ screenshot });
  }),
);
