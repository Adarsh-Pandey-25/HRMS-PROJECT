const { supabaseAdmin } = require('../config/supabase');
const logger = require('../utils/logger');

/**
 * Who receives a company's people-ops email — the attendance anomaly digest,
 * pending-approvals and joiners digests, offer accepted/rejected notices.
 *
 * These used to go to every active `hr` AND `admin`. The company admin is
 * the account owner, not the person acting on absences, and when the
 * platform owner runs their own company on SpaxSync the admin IS the
 * platform super admin — so absence digests landed in the super admin's
 * inbox. Rules now:
 *   1. HR only.
 *   2. Only when a company has no HR at all, its admins stand in — otherwise
 *      a small company where the admin does HR would silently get nothing.
 *   3. Never a platform super-admin address, whatever role it holds in the
 *      company. Platform operators run SpaxSync; they do not act on a
 *      tenant's attendance.
 *
 * Account-security notices (API keys, office beacons) deliberately do NOT
 * use this — they go to HR and admins so a compromised admin's actions stay
 * visible to peers.
 */

const PLATFORM_CACHE_TTL_MS = 5 * 60 * 1000;
let platformCache = { emails: null, expiresAt: 0 };

const normalizeEmail = (value) => String(value || '').trim().toLowerCase();

/** Every platform super-admin address: the super_admins table plus the
 *  bootstrap SUPER_ADMIN_EMAIL, which may not have a row yet. */
const getPlatformAdminEmails = async () => {
  if (platformCache.emails && Date.now() < platformCache.expiresAt) return platformCache.emails;
  const emails = new Set();
  const bootstrap = normalizeEmail(process.env.SUPER_ADMIN_EMAIL);
  if (bootstrap) emails.add(bootstrap);
  const { data, error } = await supabaseAdmin.from('super_admins').select('email');
  if (error) {
    // Fail towards excluding only the env address rather than excluding
    // nothing — and do not cache a partial answer.
    logger.warn('[emailRecipients] Could not load super_admins', { error: error.message });
    return emails;
  }
  for (const row of data || []) {
    const e = normalizeEmail(row.email);
    if (e) emails.add(e);
  }
  platformCache = { emails, expiresAt: Date.now() + PLATFORM_CACHE_TTL_MS };
  return emails;
};

/**
 * Active HR for the company (admins only if it has no HR), minus platform
 * super admins. Rows carry id, first_name, last_name, email, role.
 */
const getHrEmailRecipients = async (companyId) => {
  const { data, error } = await supabaseAdmin
    .from('employees')
    .select('id, first_name, last_name, email, role')
    .eq('company_id', companyId)
    .eq('is_active', true)
    .in('role', ['hr', 'admin']);
  if (error) throw new Error(error.message);

  const withEmail = (data || []).filter((r) => normalizeEmail(r.email));
  const hr = withEmail.filter((r) => r.role === 'hr');
  const pool = hr.length ? hr : withEmail.filter((r) => r.role === 'admin');

  const platform = await getPlatformAdminEmails();
  return pool.filter((r) => !platform.has(normalizeEmail(r.email)));
};

/**
 * The company's active admins, minus platform super admins — for notices the
 * account owner asked to see (e.g. a changed leave balance).
 */
const getAdminEmailRecipients = async (companyId) => {
  const { data, error } = await supabaseAdmin
    .from('employees')
    .select('id, first_name, last_name, email, role, company_id')
    .eq('company_id', companyId)
    .eq('is_active', true)
    .eq('role', 'admin');
  if (error) throw new Error(error.message);
  const platform = await getPlatformAdminEmails();
  return (data || []).filter((r) => normalizeEmail(r.email) && !platform.has(normalizeEmail(r.email)));
};

/**
 * Who receives platform alerts (failed scheduled jobs, biometric device
 * alerts, billing requests, new leads): the active super admins in the
 * database with one of `roles` — no .env needed. SUPER_ADMIN_EMAIL, if it is
 * still set, is included too so an existing setup keeps receiving them.
 * Returns a comma-separated "to" string, or '' when there is nobody.
 */
const getPlatformAlertTo = async (roles = ['full_admin']) => {
  const emails = new Set();
  const bootstrap = normalizeEmail(process.env.SUPER_ADMIN_EMAIL);
  if (bootstrap) emails.add(bootstrap);
  const { data, error } = await supabaseAdmin.from('super_admins').select('email, role').eq('is_active', true);
  if (error) {
    logger.warn('[emailRecipients] Could not load super admins for an alert', { error: error.message });
  } else {
    for (const row of data || []) {
      if (roles.includes(row.role || 'full_admin')) emails.add(normalizeEmail(row.email));
    }
  }
  return [...emails].filter(Boolean).join(', ');
};

module.exports = { getHrEmailRecipients, getAdminEmailRecipients, getPlatformAdminEmails, getPlatformAlertTo };
