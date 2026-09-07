const moment = require('moment-timezone');
const { supabaseAdmin } = require('../config/supabase');
const analyticsService = require('./subscriptionAnalytics.service');

const summary = async () => {
  const startOfThisMonth = moment().startOf('month').toISOString();
  const startOfLastMonth = moment().subtract(1, 'month').startOf('month').toISOString();

  const [
    { count: totalCompanies },
    { count: activeCompanies },
    { count: totalEmployees },
    revenue,
    churnData,
    { count: signupsThisMonth },
    { count: signupsLastMonth },
  ] = await Promise.all([
    supabaseAdmin.from('companies').select('id', { count: 'exact', head: true }),
    supabaseAdmin.from('companies').select('id', { count: 'exact', head: true }).eq('is_active', true),
    supabaseAdmin.from('employees').select('id', { count: 'exact', head: true }).eq('is_active', true),
    analyticsService.revenueSummary(),
    analyticsService.churn(30),
    supabaseAdmin.from('companies').select('id', { count: 'exact', head: true }).gte('created_at', startOfThisMonth),
    supabaseAdmin.from('companies').select('id', { count: 'exact', head: true }).gte('created_at', startOfLastMonth).lt('created_at', startOfThisMonth),
  ]);

  const signupChangePct = signupsLastMonth > 0
    ? Math.round(((signupsThisMonth - signupsLastMonth) / signupsLastMonth) * 1000) / 10
    : null;

  return {
    totalCompanies: totalCompanies || 0,
    activeCompanies: activeCompanies || 0,
    inactiveCompanies: (totalCompanies || 0) - (activeCompanies || 0),
    totalEmployees: totalEmployees || 0,
    mrr: revenue.mrr,
    arr: revenue.arr,
    churnRate: churnData.churnRate,
    signupsThisMonth: signupsThisMonth || 0,
    signupsLastMonth: signupsLastMonth || 0,
    signupChangePct,
  };
};

const growth = async (period = '6m') => {
  const months = period === '12m' ? 12 : 6;
  const since = moment().subtract(months - 1, 'months').startOf('month').toISOString();

  const [{ data: companies }, revenueTrend] = await Promise.all([
    supabaseAdmin.from('companies').select('created_at').gte('created_at', since),
    analyticsService.revenueTrend(months),
  ]);

  const buckets = new Map();
  for (let i = months - 1; i >= 0; i -= 1) {
    buckets.set(moment().subtract(i, 'months').format('YYYY-MM'), 0);
  }
  for (const c of companies || []) {
    const key = moment(c.created_at).format('YYYY-MM');
    if (buckets.has(key)) buckets.set(key, buckets.get(key) + 1);
  }

  const signups = [...buckets.entries()].map(([month, count]) => ({ month, count }));
  return { signups, revenue: revenueTrend };
};

/**
 * Unified attention feed: subscriptions past_due/grace_period, renewals due
 * within 7 days, inactive companies whose employees are still logging in
 * (a genuine red flag — is_active=false should mean nobody can reach the
 * app, so any recent login on one means either a stale token still working
 * or the deactivation didn't take effect), and recent failed payments.
 */
const attentionFeed = async (limit = 20) => {
  const since24h = moment().subtract(1, 'day').toISOString();
  const in7Days = moment().add(7, 'days').toISOString();
  const now = new Date().toISOString();

  const [
    { data: atRiskSubs },
    { data: renewingSoon },
    { data: failedPayments },
    { data: inactiveCompanies },
  ] = await Promise.all([
    supabaseAdmin
      .from('company_billing_subscriptions')
      .select('id, company_id, status, past_due_since, companies(id, name)')
      .in('status', ['past_due', 'grace_period'])
      .order('past_due_since', { ascending: true })
      .limit(limit),
    supabaseAdmin
      .from('company_billing_subscriptions')
      .select('id, company_id, next_renewal_date, companies(id, name)')
      .in('status', ['active', 'past_due', 'grace_period'])
      .gte('next_renewal_date', now)
      .lte('next_renewal_date', in7Days)
      .order('next_renewal_date', { ascending: true })
      .limit(limit),
    supabaseAdmin
      .from('subscription_payment_attempts')
      .select('id, attempted_at, failure_reason, subscription_invoices(id, company_id, companies(id, name))')
      .eq('status', 'failed')
      .gte('attempted_at', since24h)
      .order('attempted_at', { ascending: false })
      .limit(limit),
    supabaseAdmin.from('companies').select('id, name').eq('is_active', false),
  ]);

  const items = [];
  for (const s of atRiskSubs || []) {
    items.push({
      type: 'subscription_at_risk', urgency: s.status === 'past_due' ? 'high' : 'medium',
      companyId: s.company_id, companyName: s.companies?.name,
      message: `Subscription is ${s.status.replace('_', ' ')}`, at: s.past_due_since,
      link: `/super-admin/subscriptions/${s.id}`,
    });
  }
  for (const s of renewingSoon || []) {
    items.push({
      type: 'renewal_due', urgency: 'low',
      companyId: s.company_id, companyName: s.companies?.name,
      message: `Renews ${moment(s.next_renewal_date).fromNow()}`, at: s.next_renewal_date,
      link: `/super-admin/subscriptions/${s.id}`,
    });
  }
  for (const p of failedPayments || []) {
    const inv = p.subscription_invoices;
    items.push({
      type: 'payment_failed', urgency: 'high',
      companyId: inv?.company_id, companyName: inv?.companies?.name,
      message: p.failure_reason || 'Payment attempt failed', at: p.attempted_at,
      link: `/super-admin/companies/${inv?.company_id}`,
    });
  }

  if ((inactiveCompanies || []).length > 0) {
    const inactiveIds = inactiveCompanies.map((c) => c.id);
    const { data: recentLoginEmployees } = await supabaseAdmin
      .from('employees')
      .select('id, company_id')
      .in('company_id', inactiveIds);
    const empByCompany = new Map();
    for (const e of recentLoginEmployees || []) {
      if (!empByCompany.has(e.company_id)) empByCompany.set(e.company_id, []);
      empByCompany.get(e.company_id).push(e.id);
    }
    for (const [companyId, empIds] of empByCompany) {
      const { count } = await supabaseAdmin
        .from('refresh_tokens')
        .select('id', { count: 'exact', head: true })
        .in('employee_id', empIds)
        .gte('created_at', since24h);
      if (count > 0) {
        const company = inactiveCompanies.find((c) => c.id === companyId);
        items.push({
          type: 'inactive_company_still_active', urgency: 'high',
          companyId, companyName: company?.name,
          message: `Marked inactive but had ${count} login(s) in the last 24h`, at: now,
          link: `/super-admin/companies/${companyId}`,
        });
      }
    }
  }

  const urgencyRank = { high: 0, medium: 1, low: 2 };
  items.sort((a, b) => (urgencyRank[a.urgency] - urgencyRank[b.urgency]) || (new Date(b.at) - new Date(a.at)));
  return items.slice(0, limit);
};

module.exports = { summary, growth, attentionFeed };
