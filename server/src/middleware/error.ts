import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { HttpError } from '../utils/http';
import { logger } from '../utils/logger';

export function notFoundHandler(_req: Request, res: Response) {
  res.status(404).json({ error: 'Not found' });
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ZodError) {
    // Name the field. "Validation failed" alone leaves you hunting through a
    // whole form for the one value that was refused.
    const problems = err.issues
      .slice(0, 3)
      .map((issue) => (issue.path.length ? `${issue.path.join('.')}: ${issue.message}` : issue.message));
    return res
      .status(400)
      .json({ error: `Validation failed — ${problems.join('; ')}`, details: err.flatten() });
  }
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message, details: err.details });
  }
  logger.error('Unhandled error', err);
  return res.status(500).json({ error: 'Internal server error' });
}
