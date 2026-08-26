const { supabaseAdmin } = require('../config/supabase');

/** Subdomain labels a tenant may never claim — collide with real routes or look official. */
const RESERVED_SLUGS = new Set([
  'www', 'api', 'app', 'admin', 'hr', 'employee', 'employees', 'manager',
  'super-admin', 'superadmin', 'mail', 'smtp', 'ftp', 'cdn', 'static',
  'assets', 'dashboard', 'login', 'logout', 'signup', 'signin', 'auth',
  'status', 'docs', 'help', 'support', 'blog', 'staging', 'dev', 'test',
  'localhost', 'onboarding', 'billing', 'root', 'null', 'undefined',
]);

/** Lowercase, hyphenated, DNS-label-safe. Leaves room for a numeric suffix. */
const slugify = (value) => String(value || '')
  .toLowerCase()
  .trim()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 48);

/** True if `slug` is a syntactically valid, non-reserved subdomain label. */
const isValidSlugFormat = (slug) => {
  const s = String(slug || '');
  return /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(s) && !RESERVED_SLUGS.has(s);
};

/** Checks both live companies and other still-usable invites for a collision. */
const isSlugTaken = async (slug, { excludeInviteId = null } = {}) => {
  const { data: company } = await supabaseAdmin
    .from('companies')
    .select('id')
    .eq('slug', slug)
    .maybeSingle();
  if (company) return true;

  let query = supabaseAdmin
    .from('onboarding_invites')
    .select('id')
    .eq('company_slug', slug)
    .is('used_at', null)
    .is('revoked_at', null)
    .gt('expires_at', new Date().toISOString());
  if (excludeInviteId) query = query.neq('id', excludeInviteId);
  const { data: invite } = await query.maybeSingle();
  return Boolean(invite);
};

/** Suggests the first free `base`, `base-2`, `base-3`, ... slug for a company name. */
const suggestUniqueSlug = async (companyName, opts = {}) => {
  const base = slugify(companyName) || 'company';
  const seedBase = RESERVED_SLUGS.has(base) ? `${base}-hq` : base;
  let candidate = seedBase;
  let n = 2;
  // Bounded — a runaway loop here would mean something is structurally wrong upstream.
  while (n < 200) {
    if (isValidSlugFormat(candidate) && !(await isSlugTaken(candidate, opts))) {
      return candidate;
    }
    candidate = `${seedBase}-${n}`;
    n += 1;
  }
  return `${seedBase}-${Date.now()}`;
};

module.exports = {
  RESERVED_SLUGS, slugify, isValidSlugFormat, isSlugTaken, suggestUniqueSlug,
};
