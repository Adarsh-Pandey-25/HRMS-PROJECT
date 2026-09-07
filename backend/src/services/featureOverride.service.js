const { supabaseAdmin } = require('../config/supabase');
const { BadRequestError, NotFoundError, ForbiddenError } = require('../utils/errors');
const { FEATURE_REGISTRY, isComingSoon, getFeatureMeta } = require('../config/featureRegistry');

/**
 * Bugfix: this used to build its key set from `[...Object.keys(planFeatures),
 * ...overrideMap.keys()]` — any registry key genuinely absent from a plan's
 * saved features jsonb (no override row either) was silently OMITTED from
 * the response entirely, not returned as false. Two ways that bit:
 *   1. A company with NO active subscription got planFeatures = {} — the
 *      ENTIRE features array came back empty. hasFeature() below (the real
 *      backend enforcement every requireFeature('x') route uses) already
 *      treats that same case as "no gate configured yet, allow it" — so
 *      every gated backend endpoint kept working while the UI silently
 *      hid every entitlement-gated section (biometric device management,
 *      IP whitelist/beacons, GPS geofencing, ...) because
 *      Boolean(enabledFeatures.biometric_adms) on a MISSING key is false.
 *      Reproduced directly: getEffectiveFeatures(companyWithNoSub) -> [],
 *      hasFeature(companyWithNoSub, 'biometric_adms') -> true.
 *   2. Even with a subscription, a plan whose features jsonb predates a
 *      newer registry key (e.g. one added after the plan row was last
 *      saved) would omit that key the same way.
 * Fixed by iterating FEATURE_REGISTRY itself as the authoritative key set
 * (so every key always appears) and mirroring hasFeature's exact "no
 * subscription" fallback (permissive, not empty) so the two functions can
 * never again disagree about what a company can actually do.
 */
const getEffectiveFeatures = async (companyId) => {
  const { data: subscription } = await supabaseAdmin
    .from('company_billing_subscriptions')
    .select('plan_id, plans:subscription_plans(features)')
    .eq('company_id', companyId)
    .in('status', ['trialing', 'active', 'past_due', 'grace_period', 'suspended'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const hasSubscription = Boolean(subscription);
  const planFeatures = subscription?.plans?.features || {};

  const { data: overrides, error } = await supabaseAdmin
    .from('company_feature_overrides')
    .select('*')
    .eq('company_id', companyId);
  if (error) throw new BadRequestError(error.message);

  const overrideMap = new Map((overrides || []).map((o) => [o.feature_key, o]));
  // Registry is authoritative — every key it defines is always present in
  // the result, plus any override row for a key the registry itself no
  // longer knows about (stale row from a removed feature), so an existing
  // override never silently disappears either.
  const allKeys = new Set([...Object.keys(FEATURE_REGISTRY), ...overrideMap.keys()]);

  const features = [...allKeys].map((key) => {
    const override = overrideMap.get(key);
    // Same fallback subscription.service.js/hasFeature already uses: a key
    // truly absent from the plan's saved jsonb reads as the plan simply not
    // having been updated for it yet — not "off". Only matters when a
    // subscription exists at all; with none, planDefault mirrors hasFeature's
    // permissive no-subscription behavior below via `effective`.
    const planDefault = Boolean(planFeatures[key]);
    const comingSoon = isComingSoon(key);
    const effective = comingSoon
      ? false
      : override
        ? override.enabled
        : hasSubscription ? planDefault : true;
    return {
      key,
      planDefault,
      effective,
      isOverridden: Boolean(override),
      overrideReason: override?.reason || null,
      overrideSetBy: override?.set_by || null,
      overrideSetAt: override?.created_at || null,
      comingSoon,
      selfServeUnlockable: getFeatureMeta(key)?.selfServeUnlockable ?? true,
      // Section G: independent of visibility — defaults to 'continue' when
      // no override row exists yet (the common case).
      dataCollectionMode: override?.data_collection_mode || 'continue',
    };
  });

  return { features, maxSeatsOverride: null };
};

const hasFeature = async (companyId, featureKey) => {
  // Section B: absolute — no company/override ever bypasses this.
  if (isComingSoon(featureKey)) return false;

  const { data: override } = await supabaseAdmin
    .from('company_feature_overrides')
    .select('enabled')
    .eq('company_id', companyId)
    .eq('feature_key', featureKey)
    .maybeSingle();
  if (override) return override.enabled;

  const { data: subscription } = await supabaseAdmin
    .from('company_billing_subscriptions')
    .select('plans:subscription_plans(features)')
    .eq('company_id', companyId)
    .in('status', ['trialing', 'active', 'past_due', 'grace_period', 'suspended'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  // Same fail-open convention as subscription.service.js's assertSeatAvailable:
  // a company with no subscription wired up at all (dev/legacy/pre-billing)
  // isn't blocked — only a company that HAS a subscription whose plan
  // explicitly omits the feature is. Without this, turning on a new gate
  // would silently lock every not-yet-subscribed company out of the module.
  if (!subscription) return true;
  return Boolean(subscription.plans?.features?.[featureKey]);
};

const setFeatureOverride = async (companyId, featureKey, enabled, reason, setBy) => {
  const cleanKey = String(featureKey || '').trim();
  if (!cleanKey) throw new BadRequestError('feature key is required');
  // Section B: "never toggleable by any company or super-admin override
  // until that flag is manually flipped" — enforced here, not just hidden
  // in the UI, so a direct API call can't bypass it either.
  if (enabled && isComingSoon(cleanKey)) {
    throw new ForbiddenError(`${cleanKey} is a "Coming soon" feature and cannot be enabled yet.`);
  }
  const { data, error } = await supabaseAdmin
    .from('company_feature_overrides')
    .upsert(
      { company_id: companyId, feature_key: cleanKey, enabled: Boolean(enabled), reason: reason || null, set_by: setBy },
      { onConflict: 'company_id,feature_key' },
    )
    .select('*')
    .single();
  if (error) throw new BadRequestError(error.message);
  return data;
};

/**
 * Section G2: independent of setFeatureOverride's `enabled` column — same
 * row (UNIQUE company_id,feature_key), two orthogonal dimensions. Upserts
 * so a company that has never had a visibility override yet still gets a
 * row (enabled defaults to the plan's own default so setting a data mode
 * never silently ALSO changes visibility).
 */
const setDataCollectionMode = async (companyId, featureKey, mode, reason, setBy) => {
  const cleanKey = String(featureKey || '').trim();
  if (!cleanKey) throw new BadRequestError('feature key is required');
  if (!['continue', 'stop'].includes(mode)) throw new BadRequestError('mode must be continue or stop');
  if (mode === 'stop' && (!reason || !String(reason).trim())) {
    throw new BadRequestError('A reason is required to stop data collection');
  }

  const { data: existing } = await supabaseAdmin
    .from('company_feature_overrides')
    .select('*')
    .eq('company_id', companyId)
    .eq('feature_key', cleanKey)
    .maybeSingle();

  const effectiveEnabled = existing ? existing.enabled : await hasFeature(companyId, cleanKey);

  const { data, error } = await supabaseAdmin
    .from('company_feature_overrides')
    .upsert(
      {
        company_id: companyId, feature_key: cleanKey, enabled: effectiveEnabled,
        reason: existing?.reason ?? null, set_by: existing?.set_by ?? setBy,
        data_collection_mode: mode,
      },
      { onConflict: 'company_id,feature_key' },
    )
    .select('*')
    .single();
  if (error) throw new BadRequestError(error.message);
  return data;
};

const clearFeatureOverride = async (companyId, featureKey) => {
  const { error } = await supabaseAdmin
    .from('company_feature_overrides')
    .delete()
    .eq('company_id', companyId)
    .eq('feature_key', featureKey);
  if (error) throw new BadRequestError(error.message);
  return { cleared: true };
};

const setSeatOverride = async (companyId, maxSeatsOverride) => {
  const { data: subscription, error: findError } = await supabaseAdmin
    .from('company_billing_subscriptions')
    .select('id')
    .eq('company_id', companyId)
    .in('status', ['trialing', 'active', 'past_due', 'grace_period', 'suspended'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (findError) throw new BadRequestError(findError.message);
  if (!subscription) throw new NotFoundError('This company has no subscription to apply a seat override to');

  const value = maxSeatsOverride === null || maxSeatsOverride === '' ? null : Number(maxSeatsOverride);
  if (value !== null && (!Number.isInteger(value) || value < 0)) {
    throw new BadRequestError('max_seats_override must be a non-negative integer or null');
  }

  const { data, error } = await supabaseAdmin
    .from('company_billing_subscriptions')
    .update({ max_seats_override: value, updated_at: new Date().toISOString() })
    .eq('id', subscription.id)
    .select('*')
    .single();
  if (error) throw new BadRequestError(error.message);
  return data;
};

/** Reader used by autoPayroll.cron.js and adms.service.js — see Section G2. */
const getDataCollectionMode = async (companyId, featureKey) => {
  const { data } = await supabaseAdmin
    .from('company_feature_overrides')
    .select('data_collection_mode')
    .eq('company_id', companyId)
    .eq('feature_key', featureKey)
    .maybeSingle();
  return data?.data_collection_mode || 'continue';
};

module.exports = {
  getEffectiveFeatures, hasFeature, setFeatureOverride, clearFeatureOverride, setSeatOverride,
  setDataCollectionMode, getDataCollectionMode,
};
