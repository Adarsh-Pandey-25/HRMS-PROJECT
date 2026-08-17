import { useAuthStore } from '../store/authStore';
import { useSettingsStore } from '../store/settingsStore';
import { isPrivilegedRole } from '../lib/permissions';

/** Checks the live, configurable permission matrix for the logged-in role. */
export function useCan(module, action) {
  const role = useAuthStore((s) => s.role);
  const allowed = useSettingsStore((s) => !!s.rolePermissions[role]?.[module]?.[action]);
  if (isPrivilegedRole(role)) return true;
  return allowed;
}
