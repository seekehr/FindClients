import type { NextFunction, Request, Response } from 'express';
import { supabase } from '../db/supabase';
import { cache } from '../cache';
import { unauthorized } from '../utils/http';
import type { AuthedRequestUser, Plan } from '../types';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthedRequestUser;
      /** The raw Supabase access token this request authenticated with. */
      accessToken?: string;
    }
  }
}

/** Pull an access token off the request: Authorization header first, then cookie. */
function extractToken(req: Request): string | undefined {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice(7);
  return req.cookies?.fc_token as string | undefined;
}

/**
 * Resolve a Supabase access token to a user.
 *
 * Verification is delegated to Supabase (`auth.getUser`) rather than decoded
 * locally, so a revoked or rotated token stops working right away. That is a
 * network hop per request, so successful lookups are cached briefly — well
 * under the token's own lifetime.
 */
async function resolveUser(token: string): Promise<AuthedRequestUser | null> {
  const cacheKey = `auth:${token.slice(-32)}`;
  const hit = cache.get<AuthedRequestUser>(cacheKey);
  if (hit) return hit;

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) return null;

  // The plan lives on the profile; it drives limits, so read it fresh-ish.
  const { data: profile } = await supabase
    .from('profiles')
    .select('plan')
    .eq('id', data.user.id)
    .maybeSingle();

  const user: AuthedRequestUser = {
    id: data.user.id,
    email: data.user.email ?? '',
    plan: ((profile as { plan?: Plan } | null)?.plan ?? 'free') as Plan,
  };
  cache.set(cacheKey, user, 60_000);
  return user;
}

/** Require a valid Supabase access token; attaches req.user or throws 401. */
export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const token = extractToken(req);
  if (!token) return next(unauthorized('Missing authorization token'));

  try {
    const user = await resolveUser(token);
    if (!user) return next(unauthorized('Invalid or expired token'));
    req.user = user;
    req.accessToken = token;
    next();
  } catch (err) {
    next(err);
  }
}

/** Attach req.user when a valid token is present, but never reject. */
export async function optionalAuth(req: Request, _res: Response, next: NextFunction) {
  const token = extractToken(req);
  if (!token) return next();
  try {
    const user = await resolveUser(token);
    if (user) {
      req.user = user;
      req.accessToken = token;
    }
  } catch {
    /* ignore — the route treats this as anonymous */
  }
  next();
}

/** Drop a cached token resolution (after a plan change or sign-out). */
export function invalidateAuthCache(token: string): void {
  cache.invalidatePrefix(`auth:${token.slice(-32)}`);
}
