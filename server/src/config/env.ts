import path from 'node:path';
import dotenv from 'dotenv';

/**
 * Environment loading.
 *
 * The single source of truth is the GLOBAL `.env` at the repository root, so
 * the server, the scrapers it loads, and the website all read the same values.
 * A `server/.env`, if present, is layered on top for local-only overrides.
 *
 * dotenv never overwrites variables that are already set, so real environment
 * variables (CI, Docker, hosting provider) still win over both files.
 */
const serverDir = path.resolve(__dirname, '..', '..');
const repoRoot = path.resolve(serverDir, '..');

dotenv.config({ path: path.join(serverDir, '.env') });
dotenv.config({ path: path.join(repoRoot, '.env') });

function bool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

/** Fail fast on a missing required variable rather than 500-ing on first use. */
function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `Missing required environment variable ${name}. ` +
        `Copy .env.example to .env at the repository root and fill it in.`,
    );
  }
  return value;
}

const supabaseUrl = process.env.SUPABASE_URL?.replace(/\/+$/, '');
// SUPABASE_KEY is the older name this project used; still accepted.
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY ?? process.env.SUPABASE_KEY;

export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  isProd: process.env.NODE_ENV === 'production',
  port: Number(process.env.PORT ?? 4000),

  corsOrigin: (process.env.CORS_ORIGIN ?? 'http://localhost:3000')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),

  // ── Supabase ──
  supabaseUrl: required('SUPABASE_URL', supabaseUrl),
  supabaseServiceKey: required('SUPABASE_SERVICE_KEY', supabaseServiceKey),
  supabaseAnonKey: process.env.SUPABASE_ANON_KEY ?? '',
  /** Create users pre-confirmed instead of sending a verification email. */
  autoConfirmEmails: bool(process.env.SUPABASE_AUTO_CONFIRM_EMAILS, true),

  // Key for encrypting stored session cookies at rest. CHANGE IN PRODUCTION.
  encryptionKey: process.env.ENCRYPTION_KEY ?? 'dev-insecure-encryption-key-change-me',

  /**
   * Shared secret for the service-to-service API under /api/internal, which the
   * scrapers call to fetch the config and session they should run with. Empty
   * disables those routes entirely rather than leaving them unauthenticated.
   */
  internalApiKey: process.env.INTERNAL_API_KEY ?? '',

  schedulerEnabled: bool(process.env.SCHEDULER_ENABLED, true),
  scrapeCron: process.env.SCRAPE_CRON ?? '*/2 * * * *',

  // Note: there are deliberately no scraper keyword/threshold settings here.
  // Those are per-user and live in public.user_config — see config.service.ts.

  repoRoot,
  serverDir,
} as const;
