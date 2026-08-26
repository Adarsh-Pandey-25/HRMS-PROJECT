// Role-Based Access Control model: 12 modules × 8 actions × 4 roles.
// Settings → User & Role Management matrix is authoritative for manager/employee/HR
// (Admin always has full access). Gates: ProtectedRoute, useCan, sidebar nav.

export const PERMISSION_MODULES = [
  'employees', 'attendance', 'leave', 'payroll', 'recruitment', 'performance',
  'training', 'assets', 'expenses', 'helpdesk', 'announcements', 'settings', 'reports',
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
};

export const PERMISSION_ACTIONS = ['view', 'create', 'edit', 'delete', 'approve', 'import', 'export', 'manage'];

export const ROLES = ['admin', 'hr', 'manager', 'employee'];

/** Only Admin bypasses the matrix. HR is configurable like other roles. */
export const PRIVILEGED_ROLES = ['admin'];

export function isPrivilegedRole(role) {
  return PRIVILEGED_ROLES.includes(role);
}

/**
 * Defaults match typical self-service + HR/manager powers.
 * Admin is always all-true in buildDefaultRolePermissions.
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

/** Deep-merge a server matrix onto defaults so missing cells stay sensible. */
export function mergeRolePermissions(saved) {
  const base = buildDefaultRolePermissions();
  if (!saved || typeof saved !== 'object') return base;
  for (const role of ROLES) {
    if (!saved[role] || typeof saved[role] !== 'object') continue;
    for (const mod of PERMISSION_MODULES) {
      if (!saved[role][mod] || typeof saved[role][mod] !== 'object') continue;
      for (const action of PERMISSION_ACTIONS) {
        if (typeof saved[role][mod][action] === 'boolean') {
          base[role][mod][action] = saved[role][mod][action];
        }
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
