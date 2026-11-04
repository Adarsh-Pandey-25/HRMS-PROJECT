const settingsService = require('./settings.service');
const { getCompanyId } = require('../utils/tenant');

/**
 * The rows of the role permission matrix (Settings → User & Role
 * Management) that the server enforces too. Elsewhere the matrix only shapes
 * the website; these rows guard real actions, so they are checked here and
 * only an Admin can change them (keepAdminOnlyCells).
 *
 * Admin may always. The roles listed may when their cell allows it — or, if
 * the company never saved that cell, by the default. Any other role may not.
 * Keep in step with MODULE_SCOPE and DEFAULT_GRANTS in HRMS/src/lib/permissions.js.
 */
const ENFORCED = {
  // Organizations: see the companies, add subsidiaries, edit company details.
  organizations: { roles: ['hr'], defaults: { view: true, create: true, edit: true } },
};

const companyOf = (user) => user.company_id || getCompanyId(user);

/** May this user do `action` in `module`? */
const can = async (user, module, action) => {
  if (!user) return false;
  if (user.role === 'admin') return true;
  const rule = ENFORCED[module];
  if (!rule || !rule.roles.includes(user.role)) return false;
  const saved = await settingsService.getSetting('role_permissions', null, companyOf(user));
  const cell = saved?.[user.role]?.[module]?.[action];
  return typeof cell === 'boolean' ? cell : Boolean(rule.defaults[action]);
};

/**
 * A matrix saved by someone who isn't an Admin keeps the enforced rows as
 * they were, so HR can't change its own access to them.
 */
const keepAdminOnlyCells = (next, before) => {
  if (!next || typeof next !== 'object' || Array.isArray(next)) return next;
  const prior = before && typeof before === 'object' && !Array.isArray(before) ? before : {};
  const out = { ...next };
  for (const role of new Set([...Object.keys(out), ...Object.keys(prior)])) {
    const current = out[role] && typeof out[role] === 'object' && !Array.isArray(out[role]) ? { ...out[role] } : {};
    for (const module of Object.keys(ENFORCED)) {
      const kept = prior[role]?.[module];
      if (kept && typeof kept === 'object') current[module] = kept;
      else delete current[module];
    }
    if (Object.keys(current).length || out[role] !== undefined) out[role] = current;
  }
  return out;
};

module.exports = { ENFORCED, can, keepAdminOnlyCells };
