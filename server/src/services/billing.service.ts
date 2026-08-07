import { supabase, unwrap } from '../db/supabase';
import { badRequest } from '../utils/http';
import { setPlan } from './user.service';
import type { Plan } from '../types';

/** Monthly lead-delivery limit per plan. */
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

function toDTO(row: SubscriptionRow) {
  return {
    plan: row.plan,
    status: row.status,
    currentPeriodEnd: row.current_period_end,
    usage: { used: row.leads_used, limit: row.leads_limit },
    planInfo: PLANS.find((p) => p.id === row.plan) ?? PLANS[0],
  };
}

export async function getSubscription(userId: string) {
  const { data } = await supabase
    .from('subscriptions')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();

  if (data) return toDTO(data as SubscriptionRow);

  // Defensive: the sign-up trigger should have created this row already.
  const created = unwrap(
    await supabase
      .from('subscriptions')
      .upsert(
        { user_id: userId, plan: 'free', status: 'active', leads_limit: PLAN_LIMITS.free },
        { onConflict: 'user_id' },
      )
      .select()
      .single(),
    'creating your subscription',
  ) as SubscriptionRow;
  return toDTO(created);
}

/**
 * Demo-only plan change. A real implementation would create a Stripe checkout
 * session and flip the plan on webhook confirmation — never trust the client.
 */
export async function changePlan(userId: string, plan: Plan) {
  if (!PLANS.some((p) => p.id === plan)) throw badRequest(`Unknown plan: ${plan}`);

  const periodEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

  unwrap(
    await supabase
      .from('subscriptions')
      .upsert(
        {
          user_id: userId,
          plan,
          status: 'active',
          leads_limit: PLAN_LIMITS[plan],
          current_period_end: periodEnd,
        },
        { onConflict: 'user_id' },
      )
      .select()
      .single(),
    'changing your plan',
  );

  await setPlan(userId, plan);
  return getSubscription(userId);
}
