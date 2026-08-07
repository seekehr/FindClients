import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../utils/http';
import { invalidateAuthCache, requireAuth } from '../middleware/auth';
import { PLANS, changePlan, getSubscription } from '../services/billing.service';

export const billingRouter = Router();

// Public: anyone can view the pricing table.
billingRouter.get('/plans', (_req, res) => res.json({ plans: PLANS }));

billingRouter.use(requireAuth);

billingRouter.get(
  '/subscription',
  asyncHandler(async (req, res) => {
    res.json({ subscription: await getSubscription(req.user!.id) });
  }),
);

// Demo-only. A real flow would create a Stripe Checkout session and confirm via webhook.
billingRouter.post(
  '/subscribe',
  asyncHandler(async (req, res) => {
    const { plan } = z.object({ plan: z.enum(['free', 'pro', 'agency']) }).parse(req.body);
    const subscription = await changePlan(req.user!.id, plan);
    // The cached auth lookup carries the old plan — drop it.
    invalidateAuthCache(req.accessToken!);
    res.json({ subscription });
  }),
);
