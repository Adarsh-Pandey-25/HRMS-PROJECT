/**
 * Host classification for the apex-vs-tenant split.
 *
 * Reads the raw Host header (nginx sets it to $host) instead of
 * req.hostname: with app.set('trust proxy', 1) Express derives req.hostname
 * from X-Forwarded-Host, which a client can send straight through nginx to
 * pose as another company's subdomain.
 */

/** Hosts on the apex that are aliases of the platform site, never tenants. */
const APEX_ALIASES = ['www', 'api'];

const getBaseDomain = () => String(process.env.BASE_DOMAIN || '').toLowerCase().trim();

const getRequestHost = (req) => String(req.headers?.host || '')
  .toLowerCase()
  .trim()
  .replace(/:\d+$/, '')
  .replace(/\.$/, '');

/**
 * @returns {{ kind: 'other'|'apex'|'subdomain'|'invalid-subdomain', slug: string|null }}
 */
const classifyHost = (host) => {
  const base = getBaseDomain();
  if (!base || !host) return { kind: 'other', slug: null };
  if (host === base) return { kind: 'apex', slug: null };
  if (!host.endsWith(`.${base}`)) return { kind: 'other', slug: null };

  const label = host.slice(0, -(base.length + 1));
  if (APEX_ALIASES.includes(label)) return { kind: 'apex', slug: null };
  if (!label || label.includes('.')) return { kind: 'invalid-subdomain', slug: null };
  return { kind: 'subdomain', slug: label };
};

module.exports = { getBaseDomain, getRequestHost, classifyHost, APEX_ALIASES };
