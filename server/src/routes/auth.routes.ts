import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../utils/http';
import { signToken } from '../utils/auth';
import { requireAuth } from '../middleware/auth';
import { rateLimit } from '../middleware/rateLimit';
import {
  authenticate,
  changePassword,
  getPublicUser,
  registerUser,
  updateProfile,
} from '../services/user.service';

export const authRouter = Router();

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  fullName: z.string().max(120).optional(),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const authThrottle = rateLimit({ windowMs: 60_000, max: 20, bucket: 'auth' });

authRouter.post(
  '/register',
  authThrottle,
  asyncHandler(async (req, res) => {
    const body = registerSchema.parse(req.body);
    const user = await registerUser(body);
    const token = signToken({ id: user.id, email: user.email, plan: user.plan });
    res.status(201).json({ user, token });
  }),
);

authRouter.post(
  '/login',
  authThrottle,
  asyncHandler(async (req, res) => {
    const { email, password } = loginSchema.parse(req.body);
    const user = await authenticate(email, password);
    const token = signToken({ id: user.id, email: user.email, plan: user.plan });
    res.json({ user, token });
  }),
);

authRouter.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = getPublicUser(req.user!.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ user });
  }),
);

authRouter.patch(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const body = z
      .object({ fullName: z.string().max(120).optional(), email: z.string().email().optional() })
      .parse(req.body);
    res.json({ user: updateProfile(req.user!.id, body) });
  }),
);

authRouter.post(
  '/change-password',
  requireAuth,
  asyncHandler(async (req, res) => {
    const body = z
      .object({ currentPassword: z.string().min(1), newPassword: z.string().min(8) })
      .parse(req.body);
    await changePassword(req.user!.id, body.currentPassword, body.newPassword);
    res.json({ ok: true });
  }),
);

// Stateless JWT — logout is a client-side token discard. Provided for symmetry.
authRouter.post('/logout', (_req, res) => res.json({ ok: true }));
