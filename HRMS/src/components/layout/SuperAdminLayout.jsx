import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { Building2, Link2, LogOut, Shield } from 'lucide-react';
import { useSuperAdminStore } from '../../store/superAdminStore';
import { cn } from '../../lib/utils';

const NAV = [
  { to: '/super-admin/companies', label: 'Companies', icon: Building2 },
  { to: '/super-admin/invites', label: 'Onboarding links', icon: Link2 },
];

export function SuperAdminLayout() {
  const admin = useSuperAdminStore((s) => s.admin);
  const logout = useSuperAdminStore((s) => s.logout);
  const navigate = useNavigate();

  const onLogout = async () => {
    await logout();
    navigate('/super-admin/login', { replace: true });
  };

  return (
    <div className="min-h-screen bg-page flex">
      <aside className="w-56 shrink-0 border-r border-border bg-card flex flex-col">
        <div className="p-4 border-b border-border flex items-center gap-2.5">
          <div className="h-9 w-9 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
            <Shield className="h-4.5 w-4.5" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-fg truncate">Super Admin</p>
            <p className="text-[11px] text-fg-subtle truncate">{admin?.email}</p>
          </div>
        </div>
        <nav className="p-2 space-y-0.5 flex-1">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) => cn(
                'flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm transition-colors',
                isActive ? 'bg-primary/10 text-primary font-medium' : 'text-fg-muted hover:bg-muted hover:text-fg',
              )}
            >
              <item.icon className="h-4 w-4 shrink-0" />
              {item.label}
            </NavLink>
          ))}
        </nav>
        <button
          type="button"
          onClick={onLogout}
          className="m-2 flex items-center gap-2 rounded-xl px-3 py-2.5 text-sm text-fg-muted hover:bg-muted hover:text-fg"
        >
          <LogOut className="h-4 w-4" /> Sign out
        </button>
      </aside>
      <main className="flex-1 min-w-0 overflow-y-auto p-6 lg:p-8">
        <Outlet />
      </main>
    </div>
  );
}
