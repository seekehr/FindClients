import { credentialsStore, type StoredCredential } from '../store';
import { badRequest } from '../utils/http';
import type { SessionCookie } from '../types';

/** Platforms you can connect a session for. */
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

/** Masked view for the UI — never includes the cookies themselves. */
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

function toStatus(row: StoredCredential): CredentialStatus {
  const platform = row.platform as CredentialPlatform;
  return {
    platform,
    status: row.status,
    cookieCount: parseCookieString(row.cookies, platform).length,
    connectedAt: row.createdAt,
    updatedAt: row.updatedAt,
    lastUsedAt: row.lastUsedAt,
    lastError: row.lastError,
  };
}

/** Save (or replace) the session for a platform. */
export function connectCredential(
  platform: CredentialPlatform,
  cookieString: string,
): CredentialStatus {
  const cookies = parseCookieString(cookieString, platform);
  if (!cookies.length) {
    throw badRequest('No cookies found in the pasted value. Copy the full Cookie header.');
  }
  const missing = REQUIRED_COOKIES[platform].filter((name) => !cookies.some((c) => c.name === name));
  if (missing.length) {
    throw badRequest(`Missing required cookie(s): ${missing.join(', ')}`);
  }

  const now = new Date().toISOString();
  const existing = credentialsStore.data[platform];

  const row: StoredCredential = {
    platform,
    cookies: cookieString,
    status: 'connected',
    lastError: null,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    lastUsedAt: existing?.lastUsedAt ?? null,
  };

  credentialsStore.data[platform] = row;
  credentialsStore.save();
  return toStatus(row);
}

export function getStatus(platform: CredentialPlatform): CredentialStatus | null {
  const row = credentialsStore.data[platform];
  return row ? toStatus(row) : null;
}

/** Every platform's connection status (masked). */
export function listCredentials(): CredentialStatus[] {
  return Object.values(credentialsStore.data)
    .filter((row) => isCredentialPlatform(row.platform))
    .map(toStatus);
}

export function disconnectCredential(platform: CredentialPlatform): void {
  delete credentialsStore.data[platform];
  credentialsStore.save();
}

/** The saved session for a platform, parsed and ready to inject. */
export function getConnection(platform: string): SessionCookie[] | null {
  if (!isCredentialPlatform(platform)) return null;
  const row = credentialsStore.data[platform];
  if (!row) return null;

  // An errored connection is deliberately still returned. A failed run is
  // often transient (a challenge, a timeout, a blip), and skipping it meant
  // one bad cycle silently disabled scraping for good. A successful run clears
  // the flag via markCredentialUsed, so this self-heals.
  return parseCookieString(row.cookies, platform);
}

export function markCredentialUsed(platform: string): void {
  const row = credentialsStore.data[platform];
  if (!row) return;
  row.lastUsedAt = new Date().toISOString();
  row.status = 'connected';
  row.lastError = null;
  credentialsStore.save();
}

export function markCredentialError(platform: string, error: string): void {
  const row = credentialsStore.data[platform];
  if (!row) return;
  row.status = 'error';
  row.lastError = error.slice(0, 300);
  credentialsStore.save();
}
