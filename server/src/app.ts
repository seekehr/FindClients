import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { env } from './config/env';
import { errorHandler, notFoundHandler } from './middleware/error';
import { authRouter } from './routes/auth.routes';
import { leadsRouter } from './routes/leads.routes';
import { bookmarksRouter } from './routes/bookmarks.routes';
import { analyticsRouter } from './routes/analytics.routes';
import { settingsRouter } from './routes/settings.routes';
import { notificationsRouter } from './routes/notifications.routes';
import { billingRouter } from './routes/billing.routes';
import { scrapeRouter } from './routes/scrape.routes';
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
  if (!env.isProd) app.use(morgan('dev'));

  // Health / readiness.
  app.get('/api/health', (_req, res) => {
    res.json({
      status: 'ok',
      env: env.nodeEnv,
      uptime: process.uptime(),
      leads: totalLeadCount(),
      time: new Date().toISOString(),
    });
  });

  // API v1.
  app.use('/api/auth', authRouter);
  app.use('/api/leads', leadsRouter);
  app.use('/api/bookmarks', bookmarksRouter);
  app.use('/api/analytics', analyticsRouter);
  app.use('/api/settings', settingsRouter);
  app.use('/api/notifications', notificationsRouter);
  app.use('/api/billing', billingRouter);
  app.use('/api/scrape', scrapeRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
