import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../utils/http';
import { listNotifications, markAllRead, markRead } from '../services/notification.service';

export const notificationsRouter = Router();

notificationsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { unread } = z.object({ unread: z.coerce.boolean().optional() }).parse(req.query);
    res.json(listNotifications(unread ?? false));
  }),
);

notificationsRouter.post(
  '/read-all',
  asyncHandler(async (_req, res) => {
    markAllRead();
    res.json({ ok: true });
  }),
);

notificationsRouter.post(
  '/:id/read',
  asyncHandler(async (req, res) => {
    markRead(req.params.id);
    res.json({ ok: true });
  }),
);
