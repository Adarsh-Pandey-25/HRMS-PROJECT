const { supabaseAdmin } = require('../config/supabase');

/** Subdomain labels a tenant may never claim — collide with real routes or look official. */
const RESERVED_SLUGS = new Set([
  'www', 'api', 'app', 'admin', 'hr', 'employee', 'employees', 'manager',
  'super-admin', 'superadmin', 'mail', 'smtp', 'ftp', 'cdn', 'static',
  'assets', 'dashboard', 'login', 'logout', 'signup', 'signin', 'auth',
  'status', 'docs', 'help', 'support', 'blog', 'staging', 'dev', 'test',
  'localhost', 'onboarding', 'billing', 'root', 'null', 'undefined',
  'employee-onboarding', 'pricing', 'features', 'about', 'contact', 'legal',
  'security', 'privacy', 'terms', 'status-page', 'marketing', 'public', 'www2',
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

/**
 * Suggests a subdomain from the company name: the first word
 * ("Spaxads Digital Media Pvt Ltd" → "spaxads"), then the first two words
 * ("spaxads-digital"), then "spaxads-2", "spaxads-3", ...
 */
const suggestUniqueSlug = async (companyName, opts = {}) => {
  const words = String(companyName || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const firstWord = slugify(words[0] || '') || 'company';
  const firstTwo = slugify(words.slice(0, 2).join('-'));

  for (const candidate of [...new Set([firstWord, firstTwo].filter(Boolean))]) {
    if (isValidSlugFormat(candidate) && !(await isSlugTaken(candidate, opts))) {
      return candidate;
    }
  }

  const seedBase = RESERVED_SLUGS.has(firstWord) ? `${firstWord}-hq` : firstWord;
  // Bounded — a runaway loop here would mean something is structurally wrong upstream.
  for (let n = 2; n < 200; n += 1) {
    const candidate = `${seedBase}-${n}`;
    if (isValidSlugFormat(candidate) && !(await isSlugTaken(candidate, opts))) {
      return candidate;
    }
  }
  return `${seedBase}-${Date.now()}`;
};

/**
 * Availability of a user-typed subdomain.
 * @returns {Promise<{ slug: string, status: 'available'|'taken'|'reserved'|'invalid' }>}
 */
const checkSlugAvailability = async (rawSlug, opts = {}) => {
  const slug = String(rawSlug || '').trim().toLowerCase();
  if (RESERVED_SLUGS.has(slug)) return { slug, status: 'reserved' };
  if (!isValidSlugFormat(slug) || slug.length > 48) return { slug, status: 'invalid' };
  if (await isSlugTaken(slug, opts)) return { slug, status: 'taken' };
  return { slug, status: 'available' };
};

module.exports = {
  RESERVED_SLUGS, slugify, isValidSlugFormat, isSlugTaken, suggestUniqueSlug, checkSlugAvailability,
};
