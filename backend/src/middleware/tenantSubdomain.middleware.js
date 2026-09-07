const { supabaseAdmin } = require('../config/supabase');
const logger = require('../utils/logger');

/** Short-TTL cache so every request on a tenant subdomain doesn't hit the DB
 *  just to resolve its own host — this middleware runs on literally every
 *  request once BASE_DOMAIN is live. A stale hit for up to 30s (e.g. a
 *  company just deactivated) is an acceptable tradeoff; deactivation is
 *  still enforced again at login/session-checks downstream regardless. */
const SLUG_CACHE_TTL_MS = 30 * 1000;
const slugCache = new Map();

const getCachedCompany = (slug) => {
  const hit = slugCache.get(slug);
  if (!hit) return undefined;
  if (hit.expiresAt <= Date.now()) {
    slugCache.delete(slug);
    return undefined;
  }
  return hit.company;
};

const setCachedCompany = (slug, company) => {
  slugCache.set(slug, { company, expiresAt: Date.now() + SLUG_CACHE_TTL_MS });
};

/**
 * Resolves which company a request belongs to from its subdomain
 * ({slug}.{BASE_DOMAIN}) and attaches it as `req.tenantCompany`.
 *
 * Deliberately tolerant: if BASE_DOMAIN isn't configured, or the request's
 * host doesn't look like a tenant subdomain (bare domain, www, localhost,
 * an IP, a Vercel/ngrok preview host, etc.), `req.tenantCompany` is simply
 * left `null` and the request proceeds unscoped — callers that care (the
 * portal-specific login endpoints) check for its presence themselves. This
 * lets local dev and any not-yet-DNS-migrated deployment keep working
 * exactly as before.
 */
const resolveTenantSubdomain = async (req, res, next) => {
  try {
    req.tenantCompany = null;

    const baseDomain = String(process.env.BASE_DOMAIN || '').toLowerCase().trim();
    if (!baseDomain) return next();

    const host = String(req.hostname || '').toLowerCase();
    if (!host || host === baseDomain || host === `www.${baseDomain}`) return next();
    if (!host.endsWith(`.${baseDomain}`)) return next();

    const slug = host.slice(0, -(`.${baseDomain}`.length));
    // A subdomain must be one label — "acme.example.com" not "acme.staging.example.com".
    if (!slug || slug.includes('.')) return next();

    const cached = getCachedCompany(slug);
    if (cached !== undefined) {
      if (cached) req.tenantCompany = cached;
      return next();
    }

    const { data: company, error } = await supabaseAdmin
      .from('companies')
      .select('id, name, slug, is_active')
      .eq('slug', slug)
      .maybeSingle();

    if (error) {
      logger.error('[tenantSubdomain] company lookup failed', { slug, error: error.message });
      return next();
    }
    setCachedCompany(slug, company || null);
    if (company) req.tenantCompany = company;
    return next();
  } catch (err) {
    logger.error('[tenantSubdomain] unexpected failure', { error: err.message });
    return next();
  }
};

module.exports = { resolveTenantSubdomain };
