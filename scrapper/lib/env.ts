import fs from 'node:fs';
import path from 'node:path';

/**
 * Make the repository-wide `.env` available to the scrapers.
 *
 * When the server loads these scrapers in-process, `process.env` is already
 * populated and this is a no-op. When one runs standalone (the CLI, a smoke
 * test), it still needs the browser runtime settings — headless, user agent,
 * proxies — so parse the root `.env` ourselves rather than adding a dotenv
 * dependency to this workspace.
 *
 * Real environment variables always win over the file.
 */
let loaded = false;

export function loadRootEnv(): void {
  if (loaded) return;
  loaded = true;

  const rootEnv = path.resolve(__dirname, '..', '..', '.env');
  if (!fs.existsSync(rootEnv)) return;

  for (const line of fs.readFileSync(rootEnv, 'utf8').split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key] !== undefined) continue;
    process.env[key] = rawValue.trim().replace(/^(['"])(.*)\1$/, '$2');
  }
}
