import type { NextFunction, Request, Response } from 'express';
import { cache } from '../cache';
import { HttpError } from '../utils/http';

/**
 * Simple fixed-window rate limiter backed by the in-memory cache.
 * Keyed by client IP + route bucket.
 */
export function rateLimit(opts: { windowMs: number; max: number; bucket: string }) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const ip = req.ip ?? req.socket.remoteAddress ?? 'unknown';
    const key = `rl:${opts.bucket}:${ip}`;
    const count = cache.incr(key, opts.windowMs);
    if (count > opts.max) {
      return next(new HttpError(429, 'Too many requests, please slow down'));
    }
    next();
  };
}
