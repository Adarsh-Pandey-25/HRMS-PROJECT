const { supabaseAdmin } = require('../config/supabase');
const logger = require('../utils/logger');

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
    // A subdomain must be one label — "acme.spaxads.net" not "acme.staging.spaxads.net".
    if (!slug || slug.includes('.')) return next();

    const { data: company, error } = await supabaseAdmin
      .from('companies')
      .select('id, name, slug, is_active')
      .eq('slug', slug)
      .maybeSingle();

    if (error) {
      logger.error('[tenantSubdomain] company lookup failed', { slug, error: error.message });
      return next();
    }
    if (company) req.tenantCompany = company;
    return next();
  } catch (err) {
    logger.error('[tenantSubdomain] unexpected failure', { error: err.message });
    return next();
  }
};

module.exports = { resolveTenantSubdomain };
