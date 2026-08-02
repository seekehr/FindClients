import { db } from '../db';
import { nowIso } from '../utils/time';
import { badRequest, notFound } from '../utils/http';
import type { Plan } from '../types';

/** Monthly lead-delivery limit per plan (usage cap in the demo). */
export const PLAN_LIMITS: Record<Plan, number> = {
  free: 50,
  pro: 1000,
  agency: 10000,
};

export interface PlanInfo {
  id: Plan;
  name: string;
  priceMonthly: number;
  leadsLimit: number;
  features: string[];
}

export const PLANS: PlanInfo[] = [
  {
    id: 'free',
    name: 'Free',
    priceMonthly: 0,
    leadsLimit: PLAN_LIMITS.free,
    features: ['50 leads / month', '1 platform', 'Email notifications'],
  },
  {
    id: 'pro',
    name: 'Pro',
    priceMonthly: 29,
    leadsLimit: PLAN_LIMITS.pro,
    features: ['1,000 leads / month', 'All platforms', 'Email + Discord + Push', 'Analytics'],
  },
  {
    id: 'agency',
    name: 'Agency',
    priceMonthly: 99,
    leadsLimit: PLAN_LIMITS.agency,
    features: [
      '10,000 leads / month',
      'All platforms',
      'Priority scraping',
      'Team seats',
      'Export & API access',
    ],
  },
];

interface SubscriptionRow {
  user_id: string;
  plan: Plan;
  status: string;
  current_period_end: string | null;
  leads_used: number;
  leads_limit: number;
  updated_at: string;
}

export function getSubscription(userId: string) {
  const row = db.prepare('SELECT * FROM subscriptions WHERE user_id = ?').get(userId) as
    | SubscriptionRow
    | undefined;
  if (!row) {
    // Lazily create a free subscription if one is somehow missing.
    db.prepare(
      `INSERT INTO subscriptions (user_id, plan, status, leads_limit, updated_at)
       VALUES (?, 'free', 'active', ?, ?)`,
    ).run(userId, PLAN_LIMITS.free, nowIso());
    return getSubscription(userId);
  }
  return {
    plan: row.plan,
    status: row.status,
    currentPeriodEnd: row.current_period_end,
    usage: { used: row.leads_used, limit: row.leads_limit },
    planInfo: PLANS.find((p) => p.id === row.plan) ?? PLANS[0],
  };
}

/**
 * Demo-only plan change. A real implementation would create a Stripe checkout
 * session and flip the plan on webhook confirmation — never trust the client.
 */
export function changePlan(userId: string, plan: Plan) {
  if (!PLANS.some((p) => p.id === plan)) throw badRequest(`Unknown plan: ${plan}`);
  const exists = db.prepare('SELECT 1 FROM subscriptions WHERE user_id = ?').get(userId);
  if (!exists) throw notFound('Subscription not found');

  const periodEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  db.prepare(
    `UPDATE subscriptions
     SET plan = ?, leads_limit = ?, current_period_end = ?, status = 'active', updated_at = ?
     WHERE user_id = ?`,
  ).run(plan, PLAN_LIMITS[plan], periodEnd, nowIso(), userId);
  db.prepare('UPDATE users SET plan = ? WHERE id = ?').run(plan, userId);

  return getSubscription(userId);
}
