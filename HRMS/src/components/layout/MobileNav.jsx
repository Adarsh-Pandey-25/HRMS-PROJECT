import { createPortal } from 'react-dom';
import { Link, useLocation } from 'react-router-dom';
import { X } from 'lucide-react';
import { visibleNav, visiblePinnedItems } from '../../lib/constants';
import { NavAccordion } from './NavAccordion';
import { useUIStore } from '../../store/uiStore';
import { useAuthStore } from '../../store/authStore';
import { useCompanyStore } from '../../store/companyStore';
import { CompanyBrandMark } from './CompanyBrandMark';
import { useSettingsStore } from '../../store/settingsStore';
import { cn } from '../../lib/utils';

export function MobileNav() {
  const open = useUIStore((s) => s.mobileNavOpen);
  const setMobileNav = useUIStore((s) => s.setMobileNav);
  const role = useAuthStore((s) => s.role);
  const rolePermissions = useSettingsStore((s) => s.rolePermissions);
  const companyName = useCompanyStore((s) => s.company.name);
  const logoUrl = useCompanyStore((s) => s.company.logoUrl);
  const location = useLocation();
  const navItems = visibleNav(role, rolePermissions);
  const pinnedItems = visiblePinnedItems(role, rolePermissions);
  if (!open) return null;

  const close = () => setMobileNav(false);

  return createPortal(
    <div className="fixed inset-0 z-50 lg:hidden">
      <div className="absolute inset-0 bg-fg/40 backdrop-blur-sm animate-fade-in" onClick={close} />
      <div className="absolute left-0 top-0 h-full w-[260px] bg-sidebar shadow-drawer flex flex-col animate-slide-in-right">
        <div className="flex items-center justify-between h-16 px-5">
          <Link to="/dashboard" onClick={close} className="flex items-center gap-2.5 min-w-0 hover:opacity-90 transition-opacity">
            <CompanyBrandMark name={companyName} logoUrl={logoUrl} />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-fg leading-tight truncate">{companyName}</p>
              <p className="text-[10px] text-fg-subtle leading-tight">HR Suite</p>
            </div>
          </Link>
          <button onClick={close} className="text-fg-subtle hover:text-fg p-1">
            <X className="h-5 w-5" />
          </button>
        </div>
        <nav className="flex-1 overflow-y-auto px-3 pb-4">
          <NavAccordion items={navItems} onNavigate={close} />

          <div className="space-y-0.5 border-t border-border/60 pt-3 mt-3">
            {pinnedItems.map((item) => {
              const active = location.pathname === item.path || location.pathname.startsWith(item.path + '/');
              return (
                <Link
                  key={item.label}
                  to={item.path}
                  onClick={close}
                  className={cn(
                    'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors',
                    active ? 'bg-primary/10 text-primary font-medium' : 'text-fg-muted hover:bg-primary/5'
                  )}
                >
                  <item.icon className="h-[18px] w-[18px]" />
                  {item.label}
                </Link>
              );
            })}
          </div>
        </nav>
      </div>
    </div>,
    document.body
  );
}
