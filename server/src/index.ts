import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { RequestHandler } from 'express';
import { env } from './config/env';
import { logger } from './utils/logger';
import { createApp } from './app';
import { flushAll, initStore } from './store';
import { closeStaleRuns } from './services/analytics.service';
import { startScheduler, stopScheduler } from './scheduler';

/**
 * Load the built Next.js app and return its request handler, so the website
 * and the API are served by one process on one port.
 *
 * `next` is resolved from website/node_modules rather than the server's, which
 * is what lets the two workspaces keep their own dependency trees while still
 * running in the same process.
 */
async function loadWebsite(): Promise<RequestHandler | undefined> {
  if (!env.serveWebsite) {
    logger.info('SERVE_WEBSITE=false — API only. Run the website with `npm run dev` in website/.');
    return undefined;
  }

  if (!fs.existsSync(path.join(env.websiteDir, '.next', 'BUILD_ID'))) {
    logger.warn('The website has not been built yet — serving the API only.');
    logger.warn('Run `npm run build` in the project root, then start again.');
    return undefined;
  }

  const requireFromWebsite = createRequire(path.join(env.websiteDir, 'package.json'));
  const mod = requireFromWebsite('next') as unknown;
  const createNext = ((mod as { default?: unknown }).default ?? mod) as (opts: {
    dev: boolean;
    dir: string;
  }) => {
    prepare(): Promise<void>;
    // Next's own signature: two arguments, plus an optional third it treats as
    // an already-parsed URL. That third parameter is the trap handled below.
    getRequestHandler(): (req: IncomingMessage, res: ServerResponse) => Promise<void>;
  };

  const nextApp = createNext({ dev: false, dir: env.websiteDir });
  await nextApp.prepare();
  const handle = nextApp.getRequestHandler();

  // Deliberately called with two arguments. Express hands a middleware
  // (req, res, next), and Next reads its own third parameter as a pre-parsed
  // URL — so passing Express's `next` callback straight through makes every
  // page render "Invalid URL". Next parses req.url itself when it is omitted.
  return (req, res) => {
    void handle(req, res);
  };
}

async function main() {
  initStore();

  // Runs left open by a process that was killed mid-scrape. The browser they
  // were driving is gone, so nothing will ever close them, and leaving them
  // 'running' makes the UI show a scrape in progress forever.
  const stale = closeStaleRuns();
  if (stale) logger.warn(`Closed ${stale} scrape run(s) left open by a previous session`);

  const app = createApp(await loadWebsite());

  const server = app.listen(env.port, env.host, () => {
    logger.info(`FindClients is running at http://${env.host}:${env.port}`);
  });

  // Listen errors arrive on the emitter, not as a rejected promise, so without
  // this the common case — the port already taken, usually by a copy of this
  // app you forgot was running — surfaces as an uncaught exception and a stack
  // trace instead of a sentence telling you what to do.
  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      logger.error(
        `Port ${env.port} is already in use — FindClients may already be running.
` +
          `  Open http://${env.host}:${env.port} to check, stop the other copy, ` +
          `or set PORT to something else in .env.`,
      );
    } else {
      logger.error('Server error', err.message);
    }
    stopScheduler();
    flushAll();
    process.exit(1);
  });

  startScheduler();

  let closing = false;
  const shutdown = (signal: string) => {
    if (closing) return;
    closing = true;
    logger.info(`${signal} received — shutting down`);
    stopScheduler();
    // Write out anything still sitting in a debounce window. This is the last
    // chance to persist leads collected seconds before the user hit Ctrl-C.
    flushAll();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  logger.error('Fatal startup error', (err as Error).message);
  flushAll();
  // Set the code rather than calling process.exit(), so pending handles unwind
  // cleanly instead of tripping a libuv assertion on the way out.
  process.exitCode = 1;
});
