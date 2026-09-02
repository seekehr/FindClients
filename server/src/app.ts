import express, { type RequestHandler } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { env } from './config/env';
import { asyncHandler } from './utils/http';
import { errorHandler, notFoundHandler } from './middleware/error';
import { leadsRouter } from './routes/leads.routes';
import { bookmarksRouter } from './routes/bookmarks.routes';
import { analyticsRouter } from './routes/analytics.routes';
import { configRouter } from './routes/config.routes';
import { notificationsRouter } from './routes/notifications.routes';
import { scrapeRouter } from './routes/scrape.routes';
import { credentialsRouter } from './routes/credentials.routes';
import { totalLeadCount } from './services/lead.service';

/**
 * The whole HTTP surface.
 *
 * There is no authentication anywhere in here, on purpose: this is your app,
 * on your machine, holding your leads. What stands in for a login is the bind
 * address — the server listens on 127.0.0.1 (see `env.host`), so nothing off
 * this machine can reach it in the first place.
 *
 * @param website Next.js request handler, mounted after the API so the site
 *   and the API share one port. Omitted when the site runs its own dev server.
 */
export function createApp(website?: RequestHandler) {
  const app = express();

  app.use(
    helmet({
      // Next.js ships inline bootstrap scripts and its own asset pipeline; a
      // default CSP blocks the app from rendering at all. Same-origin, local,
      // and serving only our own bundle, so there is nothing here to protect
      // against that the bind address does not already cover.
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
    }),
  );

  // Only matters when the website is running its own dev server on :3000.
  // In the single-port setup everything is same-origin and this never fires.
  app.use(cors({ origin: ['http://localhost:3000', 'http://127.0.0.1:3000'], credentials: true }));

  app.use(express.json({ limit: '1mb' }));

  app.get(
    '/api/health',
    asyncHandler(async (_req, res) => {
      res.json({
        status: 'ok',
        env: env.nodeEnv,
        uptime: process.uptime(),
        leads: totalLeadCount(),
        time: new Date().toISOString(),
      });
    }),
  );

  app.use('/api/leads', leadsRouter);
  app.use('/api/bookmarks', bookmarksRouter);
  app.use('/api/analytics', analyticsRouter);
  app.use('/api/config', configRouter);
  app.use('/api/notifications', notificationsRouter);
  app.use('/api/scrape', scrapeRouter);
  app.use('/api/credentials', credentialsRouter);

  // An unmatched /api/* path is a 404 from the API, never a page — otherwise a
  // typo in a fetch would render HTML into a JSON parser.
  app.use('/api', notFoundHandler);

  if (website) app.use(website);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
