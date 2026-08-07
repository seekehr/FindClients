import { env } from './config/env';
import { logger } from './utils/logger';
import { createApp } from './app';
import { assertSchemaReady } from './db/supabase';
import { startScheduler, stopScheduler } from './scheduler';

async function main() {
  // Fail fast and legibly if Supabase is unreachable or the migration in
  // supabase/migrations/ has not been applied yet.
  await assertSchemaReady();

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
  logger.error('Fatal startup error', (err as Error).message);
  // Set the code rather than calling process.exit(), so pending handles unwind
  // cleanly instead of tripping a libuv assertion on the way out.
  process.exitCode = 1;
});
