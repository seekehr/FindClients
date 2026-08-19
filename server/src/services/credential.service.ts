import { supabase, unwrap } from '../db/supabase';
import { encryptSecret, decryptSecret } from '../utils/crypto';
import { badRequest } from '../utils/http';
import { logger } from '../utils/logger';
import type { SessionCookie } from '../types';

/** Platforms a user can connect a session for. */
export const CREDENTIAL_PLATFORMS = ['twitter', 'upwork'] as const;
export type CredentialPlatform = (typeof CREDENTIAL_PLATFORMS)[number];

export function isCredentialPlatform(p: string): p is CredentialPlatform {
  return (CREDENTIAL_PLATFORMS as readonly string[]).includes(p);
}

/** Cookie domain each platform's session cookies belong to. */
const DOMAINS: Record<CredentialPlatform, string> = {
  twitter: '.x.com',
  upwork: '.upwork.com',
};

/** Cookie names that must be present for a connection to be usable. */
const REQUIRED_COOKIES: Record<CredentialPlatform, string[]> = {
  twitter: ['auth_token'],
  upwork: [],
};

interface CredentialRow {
  user_id: string;
  platform: string;
  secret: string;
  status: string;
  last_error: string | null;
  created_at: string;
  updated_at: string;
  last_used_at: string | null;
}

/** Masked view returned to the client — never includes the secret. */
export interface CredentialStatus {
  platform: CredentialPlatform;
  status: string;
  cookieCount: number;
  connectedAt: string;
  updatedAt: string;
  lastUsedAt: string | null;
  lastError: string | null;
}

/**
 * Parse a raw cookie string (as copied from the browser's Cookie request
 * header, e.g. "auth_token=abc; ct0=def") into injectable cookies.
 */
export function parseCookieString(raw: string, platform: CredentialPlatform): SessionCookie[] {
  const domain = DOMAINS[platform];
  return raw
    .replace(/^cookie:/i, '')
    .split(/;|\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((pair) => {
      const i = pair.indexOf('=');
      const name = i >= 0 ? pair.slice(0, i).trim() : pair;
      const value = i >= 0 ? pair.slice(i + 1).trim() : '';
      return { name, value, domain, path: '/' };
    })
    .filter((c) => c.name && c.value);
}

function toStatus(row: CredentialRow): CredentialStatus {
  const platform = row.platform as CredentialPlatform;
  let cookieCount = 0;
  try {
    cookieCount = parseCookieString(decryptSecret(row.secret), platform).length;
  } catch {
    // Stored under a different ENCRYPTION_KEY — surface it instead of throwing,
    // so the user can see the connection and re-paste their cookies.
    logger.warn(`Could not decrypt ${platform} credential for ${row.user_id}`);
    return {
      platform,
      status: 'error',
      cookieCount: 0,
      connectedAt: row.created_at,
      updatedAt: row.updated_at,
      lastUsedAt: row.last_used_at,
      lastError: 'Stored session could not be decrypted — reconnect this account.',
    };
  }

  return {
    platform,
    status: row.status,
    cookieCount,
    connectedAt: row.created_at,
    updatedAt: row.updated_at,
    lastUsedAt: row.last_used_at,
    lastError: row.last_error,
  };
}

/** Store (or replace) a user's session for a platform. */
export async function connectCredential(
  userId: string,
  platform: CredentialPlatform,
  cookieString: string,
): Promise<CredentialStatus> {
  const cookies = parseCookieString(cookieString, platform);
  if (!cookies.length) {
    throw badRequest('No cookies found in the pasted value. Copy the full Cookie header.');
  }
  const missing = REQUIRED_COOKIES[platform].filter((name) => !cookies.some((c) => c.name === name));
  if (missing.length) {
    throw badRequest(`Missing required cookie(s): ${missing.join(', ')}`);
  }

  const row = unwrap(
    await supabase
      .from('credentials')
      .upsert(
        {
          user_id: userId,
          platform,
          secret: encryptSecret(cookieString),
          status: 'connected',
          last_error: null,
        },
        { onConflict: 'user_id,platform' },
      )
      .select()
      .single(),
    'saving your connection',
  ) as CredentialRow;

  return toStatus(row);
}

export async function getStatus(
  userId: string,
  platform: CredentialPlatform,
): Promise<CredentialStatus | null> {
  const { data } = await supabase
    .from('credentials')
    .select('*')
    .eq('user_id', userId)
    .eq('platform', platform)
    .maybeSingle();
  return data ? toStatus(data as CredentialRow) : null;
}

/** List every platform's connection status for a user (masked). */
export async function listCredentials(userId: string): Promise<CredentialStatus[]> {
  const rows = unwrap(
    await supabase.from('credentials').select('*').eq('user_id', userId),
    'loading your connections',
  ) as CredentialRow[];
  return rows.map(toStatus);
}

export async function disconnectCredential(
  userId: string,
  platform: CredentialPlatform,
): Promise<void> {
  unwrap(
    await supabase
      .from('credentials')
      .delete()
      .eq('user_id', userId)
      .eq('platform', platform)
      .select('user_id'),
    'disconnecting the account',
  );
}

/** Internal: every connected session for a platform, decrypted for scraping. */
export async function getConnectionsForPlatform(
  platform: string,
): Promise<{ userId: string; cookies: SessionCookie[] }[]> {
  if (!isCredentialPlatform(platform)) return [];

  // Errored connections are deliberately included. A failed run is often
  // transient (a challenge, a timeout, a blip), and excluding them meant one
  // bad cycle silently disabled a user's scraping for good with no way back
  // except reconnecting by hand. A successful run clears the flag via
  // markCredentialUsed, so this self-heals.
  const rows = unwrap(
    await supabase.from('credentials').select('*').eq('platform', platform),
    'loading connected accounts',
  ) as CredentialRow[];

  logger.debug(`[credentials] ${platform}: ${rows.length} row(s) from the credentials table`);

  const connections: { userId: string; cookies: SessionCookie[] }[] = [];
  for (const row of rows) {
    try {
      connections.push({
        userId: row.user_id,
        cookies: parseCookieString(decryptSecret(row.secret), platform),
      });
    } catch {
      logger.warn(`Skipping undecryptable ${platform} credential for ${row.user_id}`);
    }
  }
  return connections;
}

export async function markCredentialUsed(userId: string, platform: string): Promise<void> {
  const { error } = await supabase
    .from('credentials')
    .update({ last_used_at: new Date().toISOString(), status: 'connected', last_error: null })
    .eq('user_id', userId)
    .eq('platform', platform);
  if (error) logger.error(`Could not mark ${platform} credential used: ${error.message}`);
}

export async function markCredentialError(
  userId: string,
  platform: string,
  error: string,
): Promise<void> {
  const { error: updateError } = await supabase
    .from('credentials')
    .update({ status: 'error', last_error: error.slice(0, 300) })
    .eq('user_id', userId)
    .eq('platform', platform);
  if (updateError) {
    logger.error(`Could not mark ${platform} credential failed: ${updateError.message}`);
  }
}
