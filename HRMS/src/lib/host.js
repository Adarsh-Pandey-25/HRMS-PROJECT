/**
 * Which "world" this page is running in, decided by hostname:
 *
 * - apex   — spaxsync.com (and www): marketing site, /super-admin, /onboarding
 * - tenant — {slug}.spaxsync.com: that company's HRMS app
 * - other  — localhost, previews, or VITE_BASE_DOMAIN unset: dev mode, where
 *            everything stays reachable. Set VITE_DEV_TENANT_SLUG (or
 *            ?tenant=slug) to exercise the tenant app, or ?site=marketing to
 *            view the marketing site, on localhost.
 *
 * Mirrors backend/src/utils/host.js. The backend enforces the same split on
 * the API; this only decides what the UI renders.
 */

export const BASE_DOMAIN = String(import.meta.env.VITE_BASE_DOMAIN || '').toLowerCase().trim();

const APEX_ALIASES = ['www', 'api'];

const readHostname = () => (typeof window === 'undefined' ? '' : window.location.hostname.toLowerCase());

const devOverride = () => {
  if (typeof window === 'undefined') return {};
  const params = new URLSearchParams(window.location.search);
  return {
    tenant: params.get('tenant') || import.meta.env.VITE_DEV_TENANT_SLUG || '',
    marketing: params.get('site') === 'marketing',
  };
};

/** @returns {{ kind: 'apex'|'tenant'|'other', slug: string|null }} */
export function getHostInfo(hostname = readHostname()) {
  if (BASE_DOMAIN && hostname) {
    if (hostname === BASE_DOMAIN) return { kind: 'apex', slug: null };
    if (hostname.endsWith(`.${BASE_DOMAIN}`)) {
      const label = hostname.slice(0, -(BASE_DOMAIN.length + 1));
      if (APEX_ALIASES.includes(label)) return { kind: 'apex', slug: null };
      if (label && !label.includes('.')) return { kind: 'tenant', slug: label };
      return { kind: 'tenant', slug: null };
    }
  }
  const dev = devOverride();
  if (dev.marketing) return { kind: 'apex', slug: null };
  if (dev.tenant) return { kind: 'tenant', slug: dev.tenant };
  return { kind: 'other', slug: null };
}

export const isApexHost = () => getHostInfo().kind === 'apex';
export const isTenantHost = () => getHostInfo().kind === 'tenant';

/** https://spaxsync.com — the platform/marketing site. */
export const platformUrl = () => (BASE_DOMAIN ? `https://${BASE_DOMAIN}` : '/');

/** Workspace URL for a slug, e.g. https://acme.spaxsync.com */
export const workspaceUrl = (slug) => (BASE_DOMAIN && slug ? `https://${slug}.${BASE_DOMAIN}` : '');

/** Login page for a role inside the tenant app: admins → /admin, HR → /hr, everyone else → /. */
export function loginPathForRole(role) {
  const r = String(role || '').toLowerCase();
  if (r === 'admin') return '/admin';
  if (r === 'hr') return '/hr';
  return '/';
}

const LAST_PORTAL_KEY = 'spaxsync_last_portal';

/** Remembers which portal the user signed in through, so logout/expiry can send them back there. */
export function rememberPortalForRole(role) {
  try { localStorage.setItem(LAST_PORTAL_KEY, loginPathForRole(role)); } catch { /* storage blocked */ }
}

export function lastLoginPath() {
  try {
    const saved = localStorage.getItem(LAST_PORTAL_KEY);
    if (saved === '/admin' || saved === '/hr' || saved === '/') return saved;
  } catch { /* storage blocked */ }
  return '/';
}
