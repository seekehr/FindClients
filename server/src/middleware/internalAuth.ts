import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { env } from '../config/env';
import { HttpError, unauthorized } from '../utils/http';

/**
 * Guards the service-to-service routes under /api/internal.
 *
 * These routes hand out user configuration and decrypted platform session
 * cookies, so they are strictly machine-to-machine: no end-user token grants
 * access, and an unset INTERNAL_API_KEY disables them outright instead of
 * leaving them open.
 */
export function requireInternalKey(req: Request, _res: Response, next: NextFunction) {
  if (!env.internalApiKey) {
    return next(
      new HttpError(503, 'Internal API is disabled — set INTERNAL_API_KEY to enable it'),
    );
  }

  const provided = req.header('x-internal-key') ?? '';
  const expected = env.internalApiKey;

  // Compare over fixed-length digests so the check is constant-time and does
  // not leak the key's length.
  const a = crypto.createHash('sha256').update(provided).digest();
  const b = crypto.createHash('sha256').update(expected).digest();
  if (!crypto.timingSafeEqual(a, b)) {
    return next(unauthorized('Invalid internal API key'));
  }

  next();
}
