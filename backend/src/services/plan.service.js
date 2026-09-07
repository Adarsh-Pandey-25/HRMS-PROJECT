const { supabaseAdmin } = require('../config/supabase');
const { BadRequestError, NotFoundError, ConflictError } = require('../utils/errors');

const PLAN_FIELDS = [
  'name', 'code', 'description',
  'base_price_monthly', 'base_price_quarterly', 'base_price_annual',
  'price_per_seat_monthly', 'price_per_seat_annual',
  'included_seats', 'max_seats', 'features', 'is_active',
];

const pickPlanFields = (body = {}) => {
  const out = {};
  for (const f of PLAN_FIELDS) if (body[f] !== undefined) out[f] = body[f];
  return out;
};

const listPlans = async ({ includeInactive = false } = {}) => {
  let query = supabaseAdmin.from('subscription_plans').select('*').order('base_price_monthly', { ascending: true });
  if (!includeInactive) query = query.eq('is_active', true);
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
};

const getPlan = async (id) => {
  const { data, error } = await supabaseAdmin.from('subscription_plans').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  if (!data) throw new NotFoundError('Plan not found');
  return data;
};

const createPlan = async (body) => {
  const fields = pickPlanFields(body);
  if (!fields.name || !fields.code) throw new BadRequestError('name and code are required');

  const { data, error } = await supabaseAdmin.from('subscription_plans').insert(fields).select('*').single();
  if (error) {
    if (error.code === '23505') throw new ConflictError('A plan with this code already exists');
    throw new BadRequestError(error.message);
  }
  return data;
};

const updatePlan = async (id, body) => {
  const fields = pickPlanFields(body);
  delete fields.code; // code is the stable identifier — never editable after creation
  delete fields.is_active; // deactivation goes through deactivatePlan() so the block-if-referenced check always runs

  const { data, error } = await supabaseAdmin.from('subscription_plans').update(fields).eq('id', id).select('*').maybeSingle();
  if (error) throw new BadRequestError(error.message);
  if (!data) throw new NotFoundError('Plan not found');
  return data;
};

/** Never hard-delete a plan with active subscriptions — deactivate only, and block even that with a clear error. */
const deactivatePlan = async (id) => {
  const { count, error: countError } = await supabaseAdmin
    .from('company_billing_subscriptions')
    .select('id', { count: 'exact', head: true })
    .eq('plan_id', id)
    .in('status', ['trialing', 'active', 'past_due', 'grace_period']);
  if (countError) throw countError;
  if (count > 0) {
    throw new ConflictError(`Cannot deactivate — ${count} active subscription(s) are on this plan. Migrate them to another plan first.`);
  }

  const { data, error } = await supabaseAdmin.from('subscription_plans').update({ is_active: false }).eq('id', id).select('*').maybeSingle();
  if (error) throw error;
  if (!data) throw new NotFoundError('Plan not found');
  return data;
};

module.exports = { listPlans, getPlan, createPlan, updatePlan, deactivatePlan };
