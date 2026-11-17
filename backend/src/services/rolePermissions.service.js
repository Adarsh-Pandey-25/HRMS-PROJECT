const settingsService = require('./settings.service');
const { getCompanyId } = require('../utils/tenant');
const { BadRequestError } = require('../utils/errors');

/**
 * Settings → User & Role Management, enforced on the server
 * (middleware/requirePermission.js). Only an Admin can save the matrix
 * (settings.controller.js); Admin itself always may.
 *
 * For each module: the roles the matrix applies to, and the actions each may
 * do when the company never saved that cell — what each role could do before
 * the server checked the matrix. They match DEFAULT_GRANTS in
 * HRMS/src/lib/permissions.js (keep them in step), except the two manager
 * cells marked below. A role not listed for a module may never
 * (Organizations is HR-only).
 */
const ENFORCED = {
  employees: { hr: ['view', 'create', 'edit', 'delete', 'import'], manager: ['view'], employee: [] },
  attendance: { hr: ['view', 'manage', 'approve'], manager: ['view', 'approve'], employee: ['view'] },
  leave: { hr: ['create', 'view', 'approve'], manager: ['create', 'view', 'approve'], employee: ['create', 'view'] },
  payroll: { hr: ['view', 'manage'], manager: ['view'], employee: ['view'] },
  // Managers could always read the job, candidate and interview lists, so
  // the server keeps allowing it until an Admin saves the matrix (the screen
  // shows Recruitment → View off for managers).
  recruitment: { hr: ['view', 'create', 'manage'], manager: ['view'], employee: [] },
  performance: { hr: ['view', 'approve', 'manage'], manager: ['view', 'approve'], employee: [] },
  // Managers could always manage courses; as above, until an Admin saves
  // the matrix (the screen shows Training → Manage off for managers).
  training: { hr: ['view', 'manage'], manager: ['view', 'manage'], employee: ['view'] },
  assets: { hr: ['view', 'edit', 'manage'], manager: ['view'], employee: ['view', 'create'] },
  expenses: { hr: ['approve', 'view'], manager: ['view', 'create', 'approve'], employee: ['view', 'create'] },
  helpdesk: { hr: ['manage', 'view'], manager: ['view', 'create'], employee: ['view', 'create'] },
  announcements: { hr: ['view', 'create', 'manage'], manager: ['view'], employee: ['view'] },
  settings: { hr: ['view', 'manage'], manager: [], employee: [] },
  reports: { hr: ['view'], manager: ['view'], employee: [] },
  // Organizations: View = the page, Create = add subsidiaries, Edit = company
  // details and logos. HR may add or edit companies only when an Admin ticks it.
  organizations: { hr: ['view'] },
};

const ROLES = ['admin', 'hr', 'manager', 'employee'];
const MODULES = Object.keys(ENFORCED);
const ACTIONS = ['view', 'create', 'edit', 'delete', 'approve', 'import', 'export', 'manage'];
/** Modules that use only some actions (MODULE_SCOPE in HRMS/src/lib/permissions.js). */
const MODULE_ACTIONS = { organizations: ['view', 'create', 'edit'] };

const MODULE_LABELS = {
  employees: 'Employee Management',
  attendance: 'Attendance Tracking',
  leave: 'Leave Management',
  payroll: 'Payroll Processing',
  recruitment: 'Recruitment',
  performance: 'Performance Reviews',
  training: 'Training',
  assets: 'Asset Management',
  expenses: 'Expense Claims',
  helpdesk: 'Helpdesk Support',
  announcements: 'Announcements',
  settings: 'Settings',
  reports: 'Reports',
  organizations: 'Organizations',
};

const companyOf = (user) => user.company_id || getCompanyId(user);
const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * One cell of a saved matrix. Nothing saved for it (no matrix yet, or a role,
 * module or action added since it was saved) gives the default; anything
 * saved that isn't true or false where it should be gives no.
 */
const savedCell = (saved, role, module, action, fallback) => {
  if (saved === null || saved === undefined) return fallback;
  if (!isPlainObject(saved)) return false;
  const row = saved[role];
  if (row === undefined) return fallback;
  if (!isPlainObject(row)) return false;
  const cells = row[module];
  if (cells === undefined) return fallback;
  if (!isPlainObject(cells)) return false;
  const cell = cells[action];
  if (cell === undefined) return fallback;
  return cell === true;
};

/** May this user do `action` in `module`? */
const can = async (user, module, action) => {
  if (!user) return false;
  if (user.role === 'admin') return true;
  const defaults = ENFORCED[module]?.[user.role];
  if (!defaults || !ACTIONS.includes(action)) return false;
  if (MODULE_ACTIONS[module] && !MODULE_ACTIONS[module].includes(action)) return false;
  const saved = await settingsService.getSetting('role_permissions', null, companyOf(user));
  return savedCell(saved, user.role, module, action, defaults.includes(action));
};

/**
 * The matrix an Admin saves: { role: { module: { action: true|false } } },
 * only known roles, modules and actions. Anything else is refused.
 */
const assertValidMatrix = (value) => {
  const bad = (why) => new BadRequestError(`The permissions couldn't be saved: ${why}.`);
  if (!isPlainObject(value)) throw bad('send each role with its modules');
  for (const [role, row] of Object.entries(value)) {
    if (!ROLES.includes(role)) throw bad(`"${role}" isn't a role`);
    if (!isPlainObject(row)) throw bad(`send ${role}'s modules`);
    for (const [module, cells] of Object.entries(row)) {
      if (!MODULES.includes(module)) throw bad(`"${module}" isn't a module`);
      if (!isPlainObject(cells)) throw bad(`send ${role} → ${module} as a list of actions`);
      for (const [action, on] of Object.entries(cells)) {
        if (!ACTIONS.includes(action)) throw bad(`"${action}" isn't an action`);
        if (typeof on !== 'boolean') throw bad(`${role} → ${module} → ${action} must be on or off`);
      }
    }
  }
  return value;
};

module.exports = {
  ENFORCED, ROLES, MODULES, ACTIONS, MODULE_LABELS, can, savedCell, assertValidMatrix,
};
