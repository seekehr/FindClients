import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, notFound } from '../utils/http';
import { invalidateAuthCache, requireAuth } from '../middleware/auth';
import { rateLimit } from '../middleware/rateLimit';
import {
  changePassword,
  deleteAccount,
  getPublicUser,
  refreshSession,
  registerUser,
  signIn,
  signOut,
  updateProfile,
  type Session,
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

/**
 * Flatten a Supabase session onto the response. `token` is kept as the name of
 * the access token so existing clients keep working; `refreshToken` lets them
 * stay signed in past the access token's one-hour life.
 */
function sessionBody(session: Session | null) {
  if (!session) return {};
  return {
    token: session.accessToken,
    refreshToken: session.refreshToken,
    expiresAt: session.expiresAt,
  };
}

authRouter.post(
  '/register',
  authThrottle,
  asyncHandler(async (req, res) => {
    const body = registerSchema.parse(req.body);
    const { user, session } = await registerUser(body);
    res.status(201).json({
      user,
      ...sessionBody(session),
      // No session means Supabase is set to require email confirmation.
      needsEmailConfirmation: !session,
    });
  }),
);

authRouter.post(
  '/login',
  authThrottle,
  asyncHandler(async (req, res) => {
    const { email, password } = loginSchema.parse(req.body);
    const { user, session } = await signIn(email, password);
    res.json({ user, ...sessionBody(session) });
  }),
);

authRouter.post(
  '/refresh',
  authThrottle,
  asyncHandler(async (req, res) => {
    const { refreshToken } = z.object({ refreshToken: z.string().min(1) }).parse(req.body);
    const { user, session } = await refreshSession(refreshToken);
    res.json({ user, ...sessionBody(session) });
  }),
);

authRouter.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = await getPublicUser(req.user!.id);
    if (!user) throw notFound('User not found');
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
    const user = await updateProfile(req.user!.id, body);
    invalidateAuthCache(req.accessToken!);
    res.json({ user });
  }),
);

authRouter.post(
  '/change-password',
  requireAuth,
  authThrottle,
  asyncHandler(async (req, res) => {
    const body = z
      .object({ currentPassword: z.string().min(1), newPassword: z.string().min(8) })
      .parse(req.body);
    await changePassword(
      req.user!.id,
      req.user!.email,
      body.currentPassword,
      body.newPassword,
    );
    res.json({ ok: true });
  }),
);

authRouter.post(
  '/logout',
  requireAuth,
  asyncHandler(async (req, res) => {
    await signOut(req.accessToken!);
    invalidateAuthCache(req.accessToken!);
    res.json({ ok: true });
  }),
);

// Irreversible: removes the auth user, and every row that cascades from it.
authRouter.delete(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    await deleteAccount(req.user!.id);
    invalidateAuthCache(req.accessToken!);
    res.json({ ok: true });
  }),
);
