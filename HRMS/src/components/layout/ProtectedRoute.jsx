import { ShieldAlert } from 'lucide-react';
import { useParams } from 'react-router-dom';
import { useAuthStore } from '../../store/authStore';
import { useSettingsStore } from '../../store/settingsStore';
import { EmptyState } from '../ui/EmptyState';
import { humanize } from '../../lib/utils';
import { MODULE_LABELS, isPrivilegedRole } from '../../lib/permissions';
import { isOwnEmployeeProfileSlug } from '../../lib/employeeRoutes';

/**
 * Gate content by role (`allowedRoles`) or by the configurable RBAC matrix
 * (`permission={ module, action }`, checked against Settings -> User & Role
 * Management). If the logged-in role isn't allowed, shows an access-denied
 * state instead of the page.
 *
 * `allowSelfEmployeeProfile`: employees may open `/employees/:id` when it is
 * their own profile, without needing Employee Management → View.
 */
export function ProtectedRoute({ allowedRoles, permission, allowSelfEmployeeProfile, children }) {
  const role = useAuthStore((s) => s.role);
  const user = useAuthStore((s) => s.user);
  const rolePermissions = useSettingsStore((s) => s.rolePermissions);
  const { id: profileSlug } = useParams();

  let allowed = true;
  let message = '';

  if (allowedRoles) {
    allowed = allowedRoles.includes(role);
    message = `This area is available to ${allowedRoles.map(humanize).join(', ')}.`;
  } else if (permission) {
    allowed = isPrivilegedRole(role) || !!rolePermissions[role]?.[permission.module]?.[permission.action];
    if (!allowed && allowSelfEmployeeProfile && isOwnEmployeeProfileSlug(profileSlug, user)) {
      allowed = true;
    }
    message = `Your role (${humanize(role)}) doesn't have "${humanize(permission.action)}" access to ${MODULE_LABELS[permission.module] || humanize(permission.module)}. An Admin can grant this from Settings → User & Role Management.`;
  }

  if (!allowed) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <EmptyState
          icon={ShieldAlert}
          title="Access restricted"
          message={message}
        />
      </div>
    );
  }
  return children;
}
