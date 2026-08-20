import { createClient } from '@supabase/supabase-js';
import type { PostgrestError } from '@supabase/supabase-js';
import { env } from '../config/env';
import { logger } from '../utils/logger';
import { HttpError } from '../utils/http';

/**
 * The one Supabase client the API server uses.
 *
 * It is created with the SERVICE key, so it bypasses Row Level Security and
 * can act on behalf of any user (the scheduler scrapes for everyone, and
 * notifications fan out across accounts). Because RLS is bypassed, every query
 * in this codebase must scope itself by user id explicitly — see the services.
 *
 * `persistSession: false` matters: this is a stateless server process, and we
 * never want one request's session leaking into another's client state. User
 * tokens are verified per request in middleware/auth.ts instead.
 */
export const supabase = createClient(env.supabaseUrl, env.supabaseServiceKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
  global: {
    headers: {
      'X-Client-Info': 'findclients-api',
      Authorization: `Bearer ${env.supabaseServiceKey}`,
    },
  },
});

/**
 * Unwrap a PostgREST result, turning an error into a 500 with the underlying
 * message logged. Keeps call sites free of repetitive `if (error) throw`.
 */
export function unwrap<T>(
  result: { data: T; error: PostgrestError | null },
  context: string,
): T {
  if (result.error) {
    logger.error(`Supabase query failed (${context}): ${result.error.message}`, result.error.details);
    throw new HttpError(500, `Database error while ${context}`);
  }
  return result.data;
}

/** Postgres unique-violation, e.g. an email or source_hash that already exists. */
export const isUniqueViolation = (error: PostgrestError | null): boolean =>
  error?.code === '23505';

/**
 * Verify at boot that the schema from supabase/migrations has actually been
 * applied. Failing here — loudly, once — beats every request 500-ing with an
 * opaque PostgREST error.
 */
export async function assertSchemaReady(): Promise<void> {
  const { error } = await supabase.from('user_config').select('user_id').limit(1);
  if (!error) {
    logger.info(`Supabase ready at ${env.supabaseUrl}`);
    return;
  }

  // 42P01 = undefined_table; PostgREST also reports PGRST205 for unknown tables.
  if (error.code === '42P01' || error.code === 'PGRST205') {
    throw new Error(
      'Supabase schema is missing. Open your project → SQL Editor and run ' +
        'supabase/migrations/0001_init.sql, then start the server again.',
    );
  }
  throw new Error(`Could not reach Supabase: ${error.message}`);
}
