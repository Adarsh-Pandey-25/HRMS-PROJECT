const moment = require('moment-timezone');
const { supabaseAdmin } = require('../config/supabase');

/** Subscriptions counted as "revenue-generating" for MRR/ARR/seat totals — trialing (no payment yet) and terminal states excluded. */
const REVENUE_STATUSES = ['active', 'past_due', 'grace_period'];

const CYCLE_MONTHS = { monthly: 1, quarterly: 3, annual: 12 };

const monthlyEquivalent = (amount, billingCycle) => Number(amount) / (CYCLE_MONTHS[billingCycle] || 1);

const revenueSummary = async () => {
  const { data, error } = await supabaseAdmin
    .from('company_billing_subscriptions')
    .select('id, billing_cycle, seat_count, price_locked_at_signup, status')
    .in('status', REVENUE_STATUSES);
  if (error) throw error;

  const mrr = (data || []).reduce((sum, s) => sum + monthlyEquivalent(s.price_locked_at_signup, s.billing_cycle), 0);
  const totalSeats = (data || []).reduce((sum, s) => sum + Number(s.seat_count || 0), 0);

  return {
    mrr: Math.round(mrr * 100) / 100,
    arr: Math.round(mrr * 12 * 100) / 100,
    activeSubscriptions: (data || []).length,
    totalSeatsSold: totalSeats,
  };
};

/**
 * MRR/ARR recognized per month, derived from paid invoices' paid_at dates
 * (as specified) — each paid invoice's amount is normalized to its monthly
 * equivalent (amount / cycle-months) and bucketed into the month it was
 * paid, rather than summing raw invoice totals (which would spike months
 * with more annual renewals rather than reflecting steady-state MRR).
 */
const revenueTrend = async (months = 12) => {
  const since = moment().subtract(months - 1, 'months').startOf('month').toISOString();
  const { data, error } = await supabaseAdmin
    .from('subscription_invoices')
    .select('amount, billing_cycle, paid_at')
    .eq('status', 'paid')
    .gte('paid_at', since)
    .not('paid_at', 'is', null);
  if (error) throw error;

  const buckets = new Map();
  for (let i = months - 1; i >= 0; i -= 1) {
    const key = moment().subtract(i, 'months').format('YYYY-MM');
    buckets.set(key, 0);
  }
  for (const inv of data || []) {
    const key = moment(inv.paid_at).format('YYYY-MM');
    if (!buckets.has(key)) continue;
    buckets.set(key, buckets.get(key) + monthlyEquivalent(inv.amount, inv.billing_cycle));
  }

  return [...buckets.entries()].map(([month, mrr]) => ({
    month,
    mrr: Math.round(mrr * 100) / 100,
    arr: Math.round(mrr * 12 * 100) / 100,
  }));
};

const revenueByPlan = async () => {
  const { data, error } = await supabaseAdmin
    .from('company_billing_subscriptions')
    .select('billing_cycle, price_locked_at_signup, plans:subscription_plans(id, name, code)')
    .in('status', REVENUE_STATUSES);
  if (error) throw error;

  const byPlan = new Map();
  for (const s of data || []) {
    const plan = s.plans;
    if (!plan) continue;
    const entry = byPlan.get(plan.id) || { planId: plan.id, planName: plan.name, planCode: plan.code, mrr: 0, subscriptions: 0 };
    entry.mrr += monthlyEquivalent(s.price_locked_at_signup, s.billing_cycle);
    entry.subscriptions += 1;
    byPlan.set(plan.id, entry);
  }

  return [...byPlan.values()]
    .map((e) => ({ ...e, mrr: Math.round(e.mrr * 100) / 100, arr: Math.round(e.mrr * 12 * 100) / 100 }))
    .sort((a, b) => b.mrr - a.mrr);
};

/**
 * Approximation, flagged: no subscription-state-snapshot history exists, so
 * "active at period start" is approximated as every subscription created
 * before the window began (regardless of current status), and "churned"
 * is counted from subscription_events (event_type cancelled/expired) within
 * the window — an immutable audit trail, more reliable here than reading
 * the mutable current row. Good enough for a directional churn-rate figure;
 * a proper cohort snapshot table would be needed for point-in-time accuracy.
 */
const churn = async (days = 30) => {
  const periodStart = moment().subtract(days, 'days').toISOString();

  const [{ count: activeAtStart, error: activeError }, { data: churnEvents, error: churnError }] = await Promise.all([
    supabaseAdmin.from('company_billing_subscriptions').select('id', { count: 'exact', head: true }).lt('created_at', periodStart),
    supabaseAdmin
      .from('subscription_events')
      .select('company_subscription_id')
      .in('event_type', ['cancelled', 'expired'])
      .gte('created_at', periodStart),
  ]);
  if (activeError) throw activeError;
  if (churnError) throw churnError;

  const churnedCount = new Set((churnEvents || []).map((e) => e.company_subscription_id)).size;
  const churnRate = activeAtStart > 0 ? churnedCount / activeAtStart : 0;

  const { data: atRisk, error: atRiskError } = await supabaseAdmin
    .from('company_billing_subscriptions')
    .select('id, status, next_renewal_date, past_due_since, companies(id, name), plans:subscription_plans(id, name)')
    .in('status', ['past_due', 'grace_period'])
    .order('past_due_since', { ascending: true });
  if (atRiskError) throw atRiskError;

  return {
    periodDays: days,
    activeAtStart: activeAtStart || 0,
    churnedCount,
    churnRate: Math.round(churnRate * 10000) / 10000,
    atRisk: atRisk || [],
  };
};

const expiringSubscriptions = async (days = 30) => {
  const now = new Date().toISOString();
  const until = moment().add(days, 'days').toISOString();
  const { data, error } = await supabaseAdmin
    .from('company_billing_subscriptions')
    .select('id, status, billing_cycle, seat_count, next_renewal_date, auto_renew, companies(id, name), plans:subscription_plans(id, name)')
    .in('status', ['active', 'past_due', 'grace_period'])
    .gte('next_renewal_date', now)
    .lte('next_renewal_date', until)
    .order('next_renewal_date', { ascending: true });
  if (error) throw error;
  return data || [];
};

module.exports = { REVENUE_STATUSES, monthlyEquivalent, revenueSummary, revenueTrend, revenueByPlan, churn, expiringSubscriptions };
