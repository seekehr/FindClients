// Silence the "ExperimentalWarning: SQLite is an experimental feature" noise
// from node:sqlite — the API is stable enough for this demo.
process.removeAllListeners('warning');
process.on('warning', (w) => {
  if (w.name === 'ExperimentalWarning' && /SQLite/.test(w.message)) return;
  console.warn(w);
});

import { env } from './config/env';
import { logger } from './utils/logger';
import { createApp } from './app';
import { ensureSeed } from './db/seed';
import { startScheduler, stopScheduler } from './scheduler';

async function main() {
  // Seed a demo account + starter leads on first boot so the app isn't empty.
  await ensureSeed();

  const app = createApp();
  const server = app.listen(env.port, () => {
    logger.info(`FindClients API listening on http://localhost:${env.port}`);
    logger.info(`Health:  http://localhost:${env.port}/api/health`);
  });

  startScheduler();

  const shutdown = (signal: string) => {
    logger.info(`${signal} received — shutting down`);
    stopScheduler();
    server.close(() => process.exit(0));
    // Force-exit if connections linger.
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  logger.error('Fatal startup error', err);
  process.exit(1);
});
