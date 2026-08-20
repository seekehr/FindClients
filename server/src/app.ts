import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { env } from './config/env';
import { asyncHandler } from './utils/http';
import { errorHandler, notFoundHandler } from './middleware/error';
import { authRouter } from './routes/auth.routes';
import { leadsRouter } from './routes/leads.routes';
import { bookmarksRouter } from './routes/bookmarks.routes';
import { analyticsRouter } from './routes/analytics.routes';
import { configRouter } from './routes/config.routes';
import { notificationsRouter } from './routes/notifications.routes';
import { billingRouter } from './routes/billing.routes';
import { scrapeRouter } from './routes/scrape.routes';
import { credentialsRouter } from './routes/credentials.routes';
import { internalRouter } from './routes/internal.routes';
import { totalLeadCount } from './services/lead.service';

export function createApp() {
  const app = express();

  app.use(helmet());
  app.use(
    cors({
      origin: env.corsOrigin.length ? env.corsOrigin : true,
      credentials: true,
    }),
  );
  app.use(express.json({ limit: '1mb' }));

  // Health / readiness. Doubles as a Supabase connectivity check.
  app.get(
    '/api/health',
    asyncHandler(async (_req, res) => {
      res.json({
        status: 'ok',
        env: env.nodeEnv,
        uptime: process.uptime(),
        leads: await totalLeadCount(),
        time: new Date().toISOString(),
      });
    }),
  );

  // API v1.
  app.use('/api/auth', authRouter);
  app.use('/api/leads', leadsRouter);
  app.use('/api/bookmarks', bookmarksRouter);
  app.use('/api/analytics', analyticsRouter);
  app.use('/api/config', configRouter);
  app.use('/api/notifications', notificationsRouter);
  app.use('/api/billing', billingRouter);
  app.use('/api/scrape', scrapeRouter);
  app.use('/api/credentials', credentialsRouter);

  // Service-to-service (scrapers). Shared-secret auth, never a user token.
  app.use('/api/internal', internalRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
