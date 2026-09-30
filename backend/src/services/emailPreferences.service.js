const { supabaseAdmin } = require('../config/supabase');
const auditLogService = require('./auditLog.service');
const logger = require('../utils/logger');
const { AppError, BadRequestError } = require('../utils/errors');

const { PREFERENCE_KEYS, PREFERENCES, EMAIL_TYPES, AUDIENCE } = require('./emailCatalog');

// Derived from the catalogue rather than listed here, so a switch added to
// emailCatalog.js is accepted everywhere at once. The DB CHECK on
// company_email_preferences.category is the one other place that lists them.
const ALLOWED_CATEGORIES = new Set(PREFERENCE_KEYS);

const CACHE_TTL_MS = 5 * 60 * 1000;

// Per-company preference cache: Map<companyId, { prefs: Map<category, enabled>, expiresAt }>
const prefCache = new Map();

const cacheKey = (companyId) => String(companyId);

const getCached = (companyId) => {
  const entry = prefCache.get(cacheKey(companyId));
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    prefCache.delete(cacheKey(companyId));
    return null;
  }
  return entry.prefs;
};

const setCached = (companyId, prefs) => {
  prefCache.set(cacheKey(companyId), {
    prefs,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
};

const invalidateCache = (companyId) => {
  prefCache.delete(cacheKey(companyId));
};

/**
 * Returns true if the email category is enabled for this company.
 * Missing row = true (default-enabled).
 */
const isEmailEnabled = async (companyId, category) => {
  if (!ALLOWED_CATEGORIES.has(category)) {
    logger.warn('[EmailPrefs] Unknown category requested', { companyId, category });
    return true;
  }

  const cached = getCached(companyId);
  if (cached && cached.has(category)) {
    return cached.get(category);
  }

  // Cache miss or stale — load the full set for this company
  const { data, error } = await supabaseAdmin
    .from('company_email_preferences')
    .select('category, enabled')
    .eq('company_id', companyId);

  if (error) {
    logger.error('[EmailPrefs] Query failed', { companyId, error: error.message });
    return true;
  }

  const prefs = new Map();
  for (const row of (data || [])) {
    prefs.set(row.category, row.enabled);
  }
  setCached(companyId, prefs);

  return prefs.has(category) ? prefs.get(category) : true;
};

/**
 * Returns all preference rows for a company, defaulting to true for
 * any category not yet in the DB (backfill-safe).
 */
const getCompanyEmailPreferences = async (companyId) => {
  const { data, error } = await supabaseAdmin
    .from('company_email_preferences')
    .select('category, enabled')
    .eq('company_id', companyId)
    .order('category');

  if (error) {
    logger.error('[EmailPrefs] getCompany failed', { companyId, error: error.message });
    throw error;
  }

  // Every switch in catalogue order, defaulting to enabled when no row
  // exists (a missing row means "never changed"), with the labels and the
  // emails each one governs so the screen needs no copy of its own.
  const saved = new Map((data || []).map((r) => [r.category, r.enabled]));
  return PREFERENCE_KEYS.map((category) => ({
    category,
    enabled: saved.has(category) ? saved.get(category) : true,
    group: PREFERENCES[category].group,
    label: PREFERENCES[category].label,
    description: PREFERENCES[category].description,
    emails: EMAIL_TYPES
      .filter((t) => t.preference === category)
      // audienceLabel is resolved here, not by the client: the client
      // camelCases object keys, so a lookup map keyed 'hr_admin' would
      // arrive keyed 'hrAdmin' and miss.
      .map((t) => ({
        key: t.key,
        label: t.label,
        audience: t.audience,
        audienceLabel: AUDIENCE[t.audience] || t.audience,
        live: t.live !== false,
      })),
  }));
};

/**
 * Upsert a single preference, clear cache, and audit-log the change.
 */
const setEmailPreference = async (companyId, category, enabled, updatedBy) => {
  if (!ALLOWED_CATEGORIES.has(category)) {
    throw new BadRequestError(`Unknown email switch: ${category}`);
  }

  // Read current value for audit
  const { data: existing } = await supabaseAdmin
    .from('company_email_preferences')
    .select('enabled')
    .eq('company_id', companyId)
    .eq('category', category)
    .maybeSingle();

  const oldValue = existing?.enabled ?? true;
  if (oldValue === enabled) return { changed: false, oldValue, newValue: enabled };

  const { error } = await supabaseAdmin
    .from('company_email_preferences')
    .upsert(
      { company_id: companyId, category, enabled, updated_by: updatedBy, updated_at: new Date().toISOString() },
      { onConflict: 'company_id,category' },
    );

  if (error) {
    logger.error('[EmailPrefs] Upsert failed', { companyId, category, code: error.code, error: error.message });
    // A raw Supabase error has no statusCode, so it surfaced as a bare
    // "Internal server error" with the cause only in the server log. The two
    // realistic causes are a migration not yet run; name it. Worded without
    // Postgres's own phrasing so the error handler's DB-leak mask leaves it.
    if (error.code === '23514') {
      // CHECK on category: the switch is newer than the database — the
      // 13 switches added with the email log need the widened CHECK.
      throw new AppError(
        'This email switch needs a database update first: run migration 20260930_email_log_and_preferences.sql in Supabase, then try again.',
        409,
        'MIGRATION_REQUIRED',
      );
    }
    if (error.code === '42P01') {
      throw new AppError(
        'Email switches are not set up in the database yet: run migration 20260928_company_email_preferences.sql in Supabase, then try again.',
        409,
        'MIGRATION_REQUIRED',
      );
    }
    throw new AppError(`Could not save the email switch (${error.code || 'unknown error'}).`, 500);
  }

  invalidateCache(companyId);

  // logSuperAdminAudit, not logAudit: logAudit writes the actor into
  // actor_id, a foreign key to employees, so a super-admin id failed that
  // key and every change here went unaudited (logAudit only logs its own
  // failure). This one records the super admin in super_admin_actor_id.
  await auditLogService.logSuperAdminAudit({
    companyId,
    superAdminId: updatedBy,
    actionType: 'email_preference_updated',
    targetType: 'email_preference',
    targetId: `${companyId}:${category}`,
    beforeState: { category, enabled: oldValue },
    afterState: { category, enabled },
  });

  return { changed: true, oldValue, newValue: enabled };
};

/**
 * Bulk set — calls setEmailPreference for each entry.
 */
const setBulkEmailPreferences = async (companyId, preferences, updatedBy) => {
  const results = [];
  for (const pref of preferences) {
    const result = await setEmailPreference(companyId, pref.category, pref.enabled, updatedBy);
    results.push(result);
  }
  return results;
};

module.exports = {
  isEmailEnabled,
  getCompanyEmailPreferences,
  setEmailPreference,
  setBulkEmailPreferences,
  ALLOWED_CATEGORIES,
};
