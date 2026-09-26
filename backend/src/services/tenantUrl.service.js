const { supabaseAdmin } = require('../config/supabase');
const logger = require('../utils/logger');
const { getBaseDomain } = require('../utils/host');

/**
 * Builds links into a company's own workspace ({slug}.BASE_DOMAIN). Every
 * email and generated link that points into the HRMS app must use these —
 * the apex (FRONTEND_URL) no longer serves the app.
 */

const SLUG_CACHE_TTL_MS = 5 * 60 * 1000;
const slugCache = new Map();

const getFallbackOrigin = () => (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '');

const getCompanySlug = async (companyId) => {
  if (!companyId) return null;
  const key = String(companyId);
  const hit = slugCache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.slug;

  const { data, error } = await supabaseAdmin
    .from('companies')
    .select('slug')
    .eq('id', key)
    .maybeSingle();
  if (error) {
    logger.warn('[tenantUrl] company slug lookup failed', { companyId: key, error: error.message });
    return null;
  }
  const slug = data?.slug || null;
  slugCache.set(key, { slug, expiresAt: Date.now() + SLUG_CACHE_TTL_MS });
  return slug;
};

/** https://{slug}.{BASE_DOMAIN}, or FRONTEND_URL when BASE_DOMAIN is unset (local dev). */
const getTenantOriginForSlug = (slug) => {
  const base = getBaseDomain();
  if (!base || !slug) return getFallbackOrigin();
  return `https://${slug}.${base}`;
};

const getTenantOrigin = async (companyId) => getTenantOriginForSlug(await getCompanySlug(companyId));

/** Login path per portal: admins → /admin, HR → /hr, everyone else → / (employee login). */
const getPortalPath = (role) => {
  const r = String(role || '').toLowerCase();
  if (r === 'admin') return '/admin';
  if (r === 'hr') return '/hr';
  return '/';
};

const getPortalUrl = async ({ companyId, role } = {}) => {
  const origin = await getTenantOrigin(companyId);
  const path = getPortalPath(role);
  return path === '/' ? `${origin}/` : `${origin}${path}`;
};

module.exports = {
  getCompanySlug,
  getTenantOrigin,
  getTenantOriginForSlug,
  getPortalPath,
  getPortalUrl,
};
