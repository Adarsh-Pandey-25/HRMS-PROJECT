const { supabaseAdmin } = require('../config/supabase');
const { isComingSoon } = require('../config/featureRegistry');
const { BadRequestError } = require('../utils/errors');
const { COMPANY_SWITCHABLE, sanitizeGroups } = require('./whatsappGroups');

/**
 * Who may get WhatsApp at all: the platform switch, the paid add-on per
 * company, the company's own on/off and groups, and the super-admin pause.
 * Reads are cached briefly — a notification burst (an announcement to 500
 * people) must not hit the database once per person.
 */

const FEATURE_KEY = 'whatsapp_notifications';
const ACTIVE_SUBSCRIPTION_STATUSES = ['trialing', 'active', 'past_due', 'grace_period', 'suspended'];
const CACHE_MS = 60 * 1000;
const PAUSE_CACHE_MS = 15 * 1000;

const cache = new Map();
const cached = async (key, ttl, load) => {
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value;
  const value = await load();
  cache.set(key, { value, expires: Date.now() + ttl });
  return value;
};
const forget = (key) => cache.delete(key);

/**
 * WhatsApp is a paid add-on: on only when a super admin switched it on for
 * the company, or the company's plan includes it. Unlike hasFeature(), a
 * company with no subscription does NOT get it by default. Everything is off
 * until WHATSAPP_ENABLED=true (the feature is "coming soon" until then).
 */
const isAddOnEnabled = (companyId) => cached(`addon:${companyId}`, CACHE_MS, async () => {
  if (!companyId || isComingSoon(FEATURE_KEY)) return false;
  const { data: override } = await supabaseAdmin
    .from('company_feature_overrides')
    .select('enabled')
    .eq('company_id', companyId)
    .eq('feature_key', FEATURE_KEY)
    .maybeSingle();
  if (override) return Boolean(override.enabled);
  const { data: subscription } = await supabaseAdmin
    .from('company_billing_subscriptions')
    .select('plans:subscription_plans(features)')
    .eq('company_id', companyId)
    .in('status', ACTIVE_SUBSCRIPTION_STATUSES)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return Boolean(subscription?.plans?.features?.[FEATURE_KEY]);
});

/** A company's own switch and groups. No row yet = on, every group on. */
const getCompanySettings = (companyId) => cached(`company:${companyId}`, CACHE_MS, async () => {
  const { data, error } = await supabaseAdmin
    .from('company_whatsapp_settings')
    .select('enabled, groups, updated_at')
    .eq('company_id', companyId)
    .maybeSingle();
  if (error) throw new BadRequestError(error.message);
  return { enabled: data ? data.enabled !== false : true, groups: data?.groups || {}, updatedAt: data?.updated_at || null };
});

const updateCompanySettings = async (companyId, { enabled, groups }, updatedBy) => {
  const current = await getCompanySettings(companyId);
  const row = {
    company_id: companyId,
    enabled: typeof enabled === 'boolean' ? enabled : current.enabled,
    groups: { ...current.groups, ...sanitizeGroups(groups, COMPANY_SWITCHABLE) },
    updated_by: updatedBy || null,
    updated_at: new Date().toISOString(),
  };
  const { error } = await supabaseAdmin.from('company_whatsapp_settings').upsert(row, { onConflict: 'company_id' });
  if (error) throw new BadRequestError(error.message);
  forget(`company:${companyId}`);
  return getCompanySettings(companyId);
};

/** The super-admin pause for one environment (production, or a developer's machine). */
const getPlatformState = (environment, { fresh = false } = {}) => {
  if (fresh) forget(`state:${environment}`);
  return cached(`state:${environment}`, PAUSE_CACHE_MS, async () => {
    const { data } = await supabaseAdmin
      .from('platform_whatsapp_state')
      .select('paused, paused_reason, paused_by, paused_at, last_webhook_at')
      .eq('environment', environment)
      .maybeSingle();
    return {
      paused: Boolean(data?.paused),
      pausedReason: data?.paused_reason || null,
      pausedBy: data?.paused_by || null,
      pausedAt: data?.paused_at || null,
      lastWebhookAt: data?.last_webhook_at || null,
    };
  });
};

const setPaused = async (environment, paused, { reason = null, by = null } = {}) => {
  const { error } = await supabaseAdmin.from('platform_whatsapp_state').upsert({
    environment,
    paused: Boolean(paused),
    paused_reason: paused ? String(reason || 'Paused').slice(0, 300) : null,
    paused_by: paused ? by : null,
    paused_at: paused ? new Date().toISOString() : null,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'environment' });
  if (error) throw new BadRequestError(error.message);
  return getPlatformState(environment, { fresh: true });
};

let lastWebhookTouch = 0;
/** Records that Meta reached us — at most once a minute. */
const touchWebhook = async (environment) => {
  if (Date.now() - lastWebhookTouch < 60 * 1000) return;
  lastWebhookTouch = Date.now();
  await supabaseAdmin.from('platform_whatsapp_state').upsert({
    environment,
    last_webhook_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }, { onConflict: 'environment' });
};

module.exports = {
  FEATURE_KEY,
  isAddOnEnabled,
  getCompanySettings,
  updateCompanySettings,
  getPlatformState,
  setPaused,
  touchWebhook,
  _forgetCache: () => cache.clear(),
};
