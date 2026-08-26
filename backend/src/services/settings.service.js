const { supabaseAdmin } = require('../config/supabase');
const config = require('../config/database');
const logger = require('../utils/logger');
const { DEFAULT_COMPANY_ID, settingsKey, parseSettingsKey } = require('../utils/tenant');

const CACHE_TTL_MS = 60 * 1000;

let cache = {
  loadedAt: 0,
  map: new Map(),
};

const loadAll = async () => {
  const { data, error } = await supabaseAdmin
    .from('system_settings')
    .select('key,value,updated_at');

  if (error) {
    logger.warn('Failed to load system settings', { error: error.message });
    return { ok: false, error };
  }

  const map = new Map();
  (data || []).forEach((row) => map.set(row.key, row.value));
  cache = { loadedAt: Date.now(), map };
  return { ok: true, map };
};

const ensureCache = async (force = false) => {
  const expired = Date.now() - cache.loadedAt > CACHE_TTL_MS;
  if (force || cache.loadedAt === 0 || expired) {
    await loadAll();
  }
};

const resolveKey = (key, companyId) => {
  if (!companyId) return key;
  return settingsKey(companyId, key);
};

/**
 * Read a setting for a company. Prefers t:{companyId}:{key}, then legacy bare key
 * (only as fallback — used by default company / older rows).
 */
const getSetting = async (key, defaultValue = null, companyId = null) => {
  await ensureCache(false);
  // Unscoped callers resolve against the default (legacy) company so existing
  // modules keep working; new workspaces must always pass their companyId.
  const cid = companyId || DEFAULT_COMPANY_ID;
  const tenantKey = resolveKey(key, cid);
  if (cache.map.has(tenantKey)) return cache.map.get(tenantKey);
  // Default company may still use unprefixed legacy keys
  if (cid === DEFAULT_COMPANY_ID && cache.map.has(key)) {
    return cache.map.get(key);
  }
  return defaultValue;
};

/**
 * Copy bare legacy settings into t:{DEFAULT}:* so company-scoped reads
 * match the Settings UI you already tested (single-tenant path).
 */
const migrateLegacySettingsToDefaultCompany = async () => {
  await ensureCache(true);
  const LEGACY_KEYS = [
    'leave_policy', 'leave_policy_meta', 'leave_allocations',
    'payroll_config', 'payroll_working_days', 'payroll_pf_rate',
    'payroll_professional_tax', 'payroll_tds_percent',
    'payroll_esi_employee_percent', 'payroll_esi_threshold',
    'payroll_halfday_before_goal_enabled',
    'expense_config', 'security_config', 'role_permissions',
    'company_profile', 'allow_remote_login', 'office_cidr', 'office_ip',
    'asset_config', 'helpdesk_config', 'training_config',
    'recruitment_config', 'announcement_config',
    'notification_config', 'document_types', 'integrations_config',
    'backup_config', 'attendance_config',
  ];
  let copied = 0;
  for (const key of LEGACY_KEYS) {
    if (!cache.map.has(key)) continue;
    const tenantKey = settingsKey(DEFAULT_COMPANY_ID, key);
    if (cache.map.has(tenantKey)) continue;
    const { error } = await supabaseAdmin.from('system_settings').upsert({
      key: tenantKey,
      value: cache.map.get(key),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'key' });
    if (!error) {
      cache.map.set(tenantKey, cache.map.get(key));
      copied += 1;
    }
  }
  if (copied) logger.info('Migrated legacy settings to default company', { copied });
};

const getBoolean = async (key, defaultValue = false, companyId = null) => {
  const v = await getSetting(key, defaultValue, companyId);
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase();
    if (['true', '1', 'yes', 'y', 'on'].includes(s)) return true;
    if (['false', '0', 'no', 'n', 'off', ''].includes(s)) return false;
  }
  return Boolean(v);
};

const getNumber = async (key, defaultValue = 0, companyId = null) => {
  const v = await getSetting(key, defaultValue, companyId);
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : defaultValue;
};

const getString = async (key, defaultValue = '', companyId = null) => {
  const v = await getSetting(key, defaultValue, companyId);
  return typeof v === 'string' ? v : (v == null ? defaultValue : String(v));
};

const setSetting = async (key, value, updatedBy = null, companyId = null) => {
  const storageKey = companyId ? resolveKey(key, companyId) : key;
  const payload = {
    key: storageKey,
    value,
    updated_by: updatedBy,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabaseAdmin
    .from('system_settings')
    .upsert(payload, { onConflict: 'key' })
    .select()
    .single();

  if (!error) {
    cache.map.set(storageKey, data.value);
    cache.loadedAt = Date.now();
  }

  return { data, error };
};

/** List settings for one company as { key, value, ... } with logical (unprefixed) keys. */
const listSettingsForCompany = async (companyId) => {
  await ensureCache(true);
  const prefix = `t:${companyId}:`;
  const byLogical = new Map();

  // Only this tenant's prefixed rows — filtered at the DB level, not fetched-then-filtered.
  const { data: prefixed, error: prefixedError } = await supabaseAdmin
    .from('system_settings')
    .select('key,value,updated_at,updated_by')
    .like('key', `${prefix}%`)
    .order('key', { ascending: true });

  if (prefixedError) return { data: null, error: prefixedError };

  for (const row of prefixed || []) {
    const parsed = parseSettingsKey(row.key);
    if (parsed.companyId === companyId) {
      byLogical.set(parsed.key, { ...row, key: parsed.key });
    }
  }

  if (companyId === DEFAULT_COMPANY_ID) {
    // Legacy unprefixed rows only apply to the default company.
    const { data: legacy, error: legacyError } = await supabaseAdmin
      .from('system_settings')
      .select('key,value,updated_at,updated_by')
      .not('key', 'like', 't:%')
      .order('key', { ascending: true });

    if (legacyError) return { data: null, error: legacyError };

    for (const row of legacy || []) {
      if (!byLogical.has(row.key)) byLogical.set(row.key, row);
    }
  }

  return { data: Array.from(byLogical.values()), error: null };
};

const getEffectiveOfficeConfig = async (companyId = null) => {
  const allowRemoteLogin = await getBoolean('allow_remote_login', config.allowRemoteLogin, companyId);
  const officeCidr = (await getString('office_cidr', '', companyId)) || config.officeCidr;
  const officeIp = (await getString('office_ip', '', companyId)) || config.officeIp;
  return { allowRemoteLogin, officeCidr, officeIp };
};

/** Seed essential settings for a brand-new company workspace. */
const seedCompanySettings = async (companyId, companyProfile, updatedBy = null, fromCompanyId = null) => {
  const sourceId = fromCompanyId || DEFAULT_COMPANY_ID;
  const defaults = {
    company_profile: companyProfile || {},
    allow_remote_login: false,
  };

  const copyKeys = [
    'role_permissions', 'leave_policy', 'leave_policy_meta', 'leave_allocations',
    'payroll_config', 'payroll_working_days', 'payroll_pf_rate',
    'payroll_professional_tax', 'payroll_tds_percent',
    'payroll_esi_employee_percent', 'payroll_esi_threshold',
    'payroll_halfday_before_goal_enabled',
    'expense_config', 'security_config',
    'asset_config', 'helpdesk_config', 'training_config',
    'recruitment_config', 'announcement_config',
    'notification_config', 'document_types', 'integrations_config',
    'backup_config', 'attendance_config',
  ];
  for (const key of copyKeys) {
    const v = await getSetting(key, null, sourceId);
    if (v != null) defaults[key] = v;
  }

  for (const [key, value] of Object.entries(defaults)) {
    await setSetting(key, value, updatedBy, companyId);
  }
};

module.exports = {
  loadAll,
  ensureCache,
  getSetting,
  getBoolean,
  getNumber,
  getString,
  setSetting,
  getEffectiveOfficeConfig,
  listSettingsForCompany,
  seedCompanySettings,
  migrateLegacySettingsToDefaultCompany,
};
