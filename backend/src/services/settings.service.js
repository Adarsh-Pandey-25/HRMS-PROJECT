const { supabaseAdmin } = require('../config/supabase');
const config = require('../config/database');
const logger = require('../utils/logger');

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

const getSetting = async (key, defaultValue = null) => {
  await ensureCache(false);
  if (cache.map.has(key)) return cache.map.get(key);
  return defaultValue;
};

const getBoolean = async (key, defaultValue = false) => {
  const v = await getSetting(key, defaultValue);
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase();
    if (['true', '1', 'yes', 'y', 'on'].includes(s)) return true;
    if (['false', '0', 'no', 'n', 'off', ''].includes(s)) return false;
  }
  return Boolean(v);
};

const getNumber = async (key, defaultValue = 0) => {
  const v = await getSetting(key, defaultValue);
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : defaultValue;
};

const getString = async (key, defaultValue = '') => {
  const v = await getSetting(key, defaultValue);
  return typeof v === 'string' ? v : (v == null ? defaultValue : String(v));
};

const setSetting = async (key, value, updatedBy = null) => {
  const payload = {
    key,
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
    cache.map.set(key, data.value);
    cache.loadedAt = Date.now();
  }

  return { data, error };
};

const getEffectiveOfficeConfig = async () => {
  // Env overrides DB (useful for local dev).
  const allowRemoteLogin = config.allowRemoteLogin || (await getBoolean('allow_remote_login', false));
  const officeCidr = await getString('office_cidr', config.officeCidr);
  const officeIp = await getString('office_ip', config.officeIp);

  return { allowRemoteLogin, officeCidr, officeIp };
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
};

