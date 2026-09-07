/**
 * Section B: the feature registry, extended. Single source of truth for
 * every company_feature_overrides/plans.features key's metadata — reused
 * by featureOverride.service.js (enforcement + merge), the super-admin
 * Plans/Company Detail UI, and Section F's billing page (which needs to
 * know self-serve-unlockable vs request-only from the BACKEND, not just
 * cosmetically on the frontend).
 *
 * comingSoon keys (app_checkin, ip_based_app) are a hard platform-wide
 * override: regardless of plan default or any company_feature_overrides
 * row, `effective` is forced false and any attempt to toggle one on is
 * rejected — see featureOverride.service.js's setFeatureOverride. Flipping
 * requires literally changing requiresPlatformFlag's env var, not a
 * database toggle, precisely so "no company or super-admin override" can
 * ever turn it on early.
 */
const FEATURE_REGISTRY = {
  payroll: { label: 'Payroll module', category: 'core', selfServeUnlockable: true, comingSoon: false },
  biometric_adms: { label: 'Biometric attendance (ADMS)', category: 'attendance', selfServeUnlockable: false, comingSoon: false },
  advanced_reports: { label: 'Advanced reports', category: 'core', selfServeUnlockable: true, comingSoon: false },
  api_access: { label: 'API access', category: 'core', selfServeUnlockable: false, comingSoon: false },
  training: { label: 'Training / LMS', category: 'core', selfServeUnlockable: true, comingSoon: false },
  assets: { label: 'Asset management', category: 'core', selfServeUnlockable: true, comingSoon: false },
  helpdesk: { label: 'Helpdesk', category: 'core', selfServeUnlockable: true, comingSoon: false },
  recruitment: { label: 'Recruitment (ATS)', category: 'core', selfServeUnlockable: true, comingSoon: false },

  // ── Section B: check-in methods — baseline, TRUE on every plan ─────────
  web_checkin: { label: 'Web check-in', category: 'checkin', selfServeUnlockable: true, comingSoon: false, baseline: true },
  ip_based_web: { label: 'IP-based web check-in', category: 'checkin', selfServeUnlockable: true, comingSoon: false, baseline: true },
  gps_geofence: { label: 'GPS geofencing', category: 'checkin', selfServeUnlockable: true, comingSoon: false, baseline: true },
  // Paused platform-wide — see comingSoon handling above.
  app_checkin: {
    label: 'App check-in', category: 'checkin', selfServeUnlockable: false, comingSoon: true,
    requiresPlatformFlag: 'MOBILE_APP_AVAILABLE',
  },
  ip_based_app: {
    label: 'IP-based app check-in', category: 'checkin', selfServeUnlockable: false, comingSoon: true,
    requiresPlatformFlag: 'MOBILE_APP_AVAILABLE',
  },
};

/** True only once the named env var is explicitly set to 'true' — default false. */
const isPlatformFlagOn = (flagName) => String(process.env[flagName] || '').toLowerCase() === 'true';

/** A comingSoon feature is inert until its platform flag is flipped, full stop. */
const isComingSoon = (featureKey) => {
  const meta = FEATURE_REGISTRY[featureKey];
  if (!meta?.comingSoon) return false;
  return !isPlatformFlagOn(meta.requiresPlatformFlag);
};

const getFeatureMeta = (featureKey) => FEATURE_REGISTRY[featureKey] || null;

module.exports = { FEATURE_REGISTRY, isComingSoon, isPlatformFlagOn, getFeatureMeta };
