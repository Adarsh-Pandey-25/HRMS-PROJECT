// Role-Based Access Control model: modules × 8 actions × 4 roles.
// Settings → User & Role Management matrix is authoritative for manager/employee/HR
// (Admin always has full access). Gates: ProtectedRoute, useCan, sidebar nav —
// and the server checks the same cells (backend/src/services/rolePermissions.service.js,
// keep the defaults in step). Only an Admin can change the matrix.

export const PERMISSION_MODULES = [
  'employees', 'attendance', 'leave', 'payroll', 'recruitment', 'performance',
  'training', 'assets', 'expenses', 'helpdesk', 'announcements', 'settings', 'reports', 'organizations',
];

export const MODULE_LABELS = {
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
  organizations: 'Organizations (companies & subsidiaries)',
};

export const PERMISSION_ACTIONS = ['view', 'create', 'edit', 'delete', 'approve', 'import', 'export', 'manage'];

export const ROLES = ['admin', 'hr', 'manager', 'employee'];

/** Only Admin bypasses the matrix. HR is configurable like other roles. */
export const PRIVILEGED_ROLES = ['admin'];

export function isPrivilegedRole(role) {
  return PRIVILEGED_ROLES.includes(role);
}

/**
 * Modules used only by some roles and actions; their other cells stay off.
 * Organizations: View = the page, Create = add subsidiaries, Edit = company
 * details and logos. Switching a subsidiary on or off stays with Admin.
 */
export const MODULE_SCOPE = {
  organizations: { roles: ['hr'], actions: ['view', 'create', 'edit'] },
};

/** Is this cell used for this role? */
export function cellApplies(role, module, action) {
  const scope = MODULE_SCOPE[module];
  if (!scope || isPrivilegedRole(role)) return true;
  return scope.roles.includes(role) && scope.actions.includes(action);
}

/** May someone signed in as `viewerRole` change the matrix? Only an Admin. */
export function canEditMatrix(viewerRole) {
  return isPrivilegedRole(viewerRole);
}

/**
 * Defaults match typical self-service + HR/manager powers.
 * Admin is always all-true in buildDefaultRolePermissions.
 * The server uses exactly the same defaults (ENFORCED in
 * backend/src/services/rolePermissions.service.js).
 */
const DEFAULT_GRANTS = {
  hr: [
    ['employees', 'view'], ['employees', 'create'], ['employees', 'edit'], ['employees', 'delete'], ['employees', 'import'],
    ['attendance', 'view'], ['attendance', 'manage'], ['attendance', 'approve'],
    ['leave', 'create'], ['leave', 'view'], ['leave', 'approve'],
    ['payroll', 'view'], ['payroll', 'manage'],
    ['recruitment', 'view'], ['recruitment', 'create'], ['recruitment', 'manage'],
    ['performance', 'view'], ['performance', 'approve'], ['performance', 'manage'],
    ['training', 'view'], ['training', 'manage'],
    ['assets', 'view'], ['assets', 'edit'], ['assets', 'manage'],
    ['expenses', 'approve'], ['expenses', 'view'],
    ['helpdesk', 'manage'], ['helpdesk', 'view'],
    ['announcements', 'view'], ['announcements', 'create'], ['announcements', 'manage'],
    ['settings', 'view'], ['settings', 'manage'],
    ['reports', 'view'],
    // Adding or editing companies (subsidiaries) only when an Admin ticks it.
    ['organizations', 'view'],
  ],
  manager: [
    ['employees', 'view'],
    ['attendance', 'view'], ['attendance', 'approve'],
    ['leave', 'create'], ['leave', 'view'], ['leave', 'approve'],
    ['payroll', 'view'],
    ['performance', 'view'], ['performance', 'approve'],
    ['training', 'view'],
    ['assets', 'view'],
    ['expenses', 'view'], ['expenses', 'create'], ['expenses', 'approve'],
    ['helpdesk', 'view'], ['helpdesk', 'create'],
    ['announcements', 'view'],
    ['reports', 'view'],
  ],
  employee: [
    ['attendance', 'view'],
    ['leave', 'create'], ['leave', 'view'],
    ['payroll', 'view'],
    ['training', 'view'],
    ['assets', 'view'], ['assets', 'create'],
    ['expenses', 'view'], ['expenses', 'create'],
    ['helpdesk', 'view'], ['helpdesk', 'create'],
    ['announcements', 'view'],
  ],
};

export function buildDefaultRolePermissions() {
  const matrix = {};
  for (const role of ROLES) {
    matrix[role] = {};
    for (const mod of PERMISSION_MODULES) {
      matrix[role][mod] = {};
      for (const action of PERMISSION_ACTIONS) {
        matrix[role][mod][action] = role === 'admin';
      }
    }
  }
  for (const [role, cells] of Object.entries(DEFAULT_GRANTS)) {
    cells.forEach(([mod, action]) => { matrix[role][mod][action] = true; });
  }
  return matrix;
}

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * One saved cell, as the server reads it: nothing saved for it → the default;
 * saved but not true/false where it should be → off.
 */
function savedCell(saved, role, mod, action, fallback) {
  if (!isPlainObject(saved)) return false;
  const row = saved[role];
  if (row === undefined) return fallback;
  if (!isPlainObject(row)) return false;
  const cells = row[mod];
  if (cells === undefined) return fallback;
  if (!isPlainObject(cells)) return false;
  const cell = cells[action];
  if (cell === undefined) return fallback;
  return cell === true;
}

/** Merge a server matrix onto defaults the way the server reads it. */
export function mergeRolePermissions(saved) {
  const base = buildDefaultRolePermissions();
  if (saved === null || saved === undefined) return base;
  for (const role of ROLES) {
    for (const mod of PERMISSION_MODULES) {
      for (const action of PERMISSION_ACTIONS) {
        base[role][mod][action] = savedCell(saved, role, mod, action, base[role][mod][action]);
      }
    }
  }
  // Cells a module doesn't use for a role stay off, whatever was saved.
  for (const role of ROLES) {
    for (const mod of Object.keys(MODULE_SCOPE)) {
      for (const action of PERMISSION_ACTIONS) {
        if (!cellApplies(role, mod, action)) base[role][mod][action] = false;
      }
    }
  }
  // Admin always full
  for (const mod of PERMISSION_MODULES) {
    for (const action of PERMISSION_ACTIONS) {
      base.admin[mod][action] = true;
    }
  }
  return base;
}

export function canRole(rolePermissions, role, module, action) {
  if (isPrivilegedRole(role)) return true;
  return Boolean(rolePermissions?.[role]?.[module]?.[action]);
}
