const { supabaseAdmin } = require('../config/supabase');
const { BadRequestError, NotFoundError } = require('../utils/errors');

/**
 * KNOWN LIMITATION: This gate blocks the dedicated ExportButton component's
 * action, the only sanctioned export path in the UI. The underlying
 * list/view endpoints this data is drawn from (e.g. /employees/all,
 * attendance, payroll list endpoints) remain open for normal viewing, by
 * design — blocking them would break regular app usage. A technically
 * sophisticated user could theoretically replay these same view-endpoint
 * API calls directly (e.g. via browser dev tools) to reconstruct
 * exportable data outside this gate. This is a known, accepted trade-off:
 * the gate prevents casual/one-click bulk export, not a deliberate
 * technical bypass attempt. Revisit if this risk profile changes (e.g.
 * becomes a contractual concern with a real customer).
 */

const GOOD_STANDING_STATUSES = ['active', 'trialing'];

/**
 * Item 6: a hard rule tied to subscription STATUS alone — never to whether
 * a manual credit exists (credit only ever adjusts amount owed, per the
 * explicit "keep these concerns separate" instruction). export_override_enabled
 * is the one and only way around this rule, and it's a distinct, explicit,
 * separately-logged super-admin action (see setExportOverride below) —
 * never a side effect of credit or subscription-extend.
 *
 * FAIL CLOSED for "no subscription row" (item 4's explicit product
 * decision, applied here for consistency — this REVERSES the original
 * fail-open choice made when this gate was first built). Safe to do now:
 * item 3 makes onboarding always create a trialing subscription, so "no
 * subscription row" is an anomalous/bug state, not the normal state for a
 * legitimate company — unlike assertSeatAvailable/featureOverride.hasFeature,
 * which stay fail-open since those gates were never asked to change.
 */
const getExportAuthorization = async (companyId) => {
  const { data: company, error: companyError } = await supabaseAdmin
    .from('companies')
    .select('export_override_enabled')
    .eq('id', companyId)
    .maybeSingle();
  if (companyError) throw new BadRequestError(companyError.message);
  if (!company) throw new NotFoundError('Company not found');

  if (company.export_override_enabled) {
    return { allowed: true, reason: 'override', status: null };
  }

  const { data: subscription } = await supabaseAdmin
    .from('company_billing_subscriptions')
    .select('status')
    .eq('company_id', companyId)
    .in('status', ['trialing', 'active', 'past_due', 'grace_period', 'suspended', 'cancelled', 'expired'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!subscription) {
    return { allowed: false, reason: 'no_subscription', status: null };
  }

  const allowed = GOOD_STANDING_STATUSES.includes(subscription.status);
  return { allowed, reason: allowed ? 'good_standing' : 'bad_standing', status: subscription.status };
};

const setExportOverride = async (companyId, enabled, reason, superAdminId) => {
  if (!reason || !String(reason).trim()) throw new BadRequestError('A reason is required to change the export override');
  const { data, error } = await supabaseAdmin
    .from('companies')
    .update({ export_override_enabled: Boolean(enabled), updated_at: new Date().toISOString() })
    .eq('id', companyId)
    .select('id, name, export_override_enabled')
    .maybeSingle();
  if (error) throw new BadRequestError(error.message);
  if (!data) throw new NotFoundError('Company not found');
  return data;
};

module.exports = { getExportAuthorization, setExportOverride, GOOD_STANDING_STATUSES };
