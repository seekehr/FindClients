import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../utils/http';
import { requireAuth } from '../middleware/auth';
import { listNotifications, markAllRead, markRead } from '../services/notification.service';

export const notificationsRouter = Router();
notificationsRouter.use(requireAuth);

notificationsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { unread } = z.object({ unread: z.coerce.boolean().optional() }).parse(req.query);
    res.json(await listNotifications(req.user!.id, unread ?? false));
  }),
);

notificationsRouter.post(
  '/read-all',
  asyncHandler(async (req, res) => {
    await markAllRead(req.user!.id);
    res.json({ ok: true });
  }),
);

notificationsRouter.post(
  '/:id/read',
  asyncHandler(async (req, res) => {
    await markRead(req.user!.id, req.params.id);
    res.json({ ok: true });
  }),
);
