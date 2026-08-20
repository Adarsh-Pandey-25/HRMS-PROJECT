import { useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Suspense } from 'react';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { NotificationDrawer } from './NotificationDrawer';
import { MobileNav } from './MobileNav';
import { ShortcutHelpModal } from './ShortcutHelpModal';
import { ForcePasswordChangeModal } from '../auth/ForcePasswordChangeModal';
import { ErrorBoundary } from './ErrorBoundary';
import { PageLoader } from './PageLoader';
import { useUIStore } from '../../store/uiStore';
import { useAuthStore } from '../../store/authStore';
import { useGlobalShortcuts } from '../../hooks/useGlobalShortcuts';
import { useAutoRunPayroll } from '../../hooks/useAutoRunPayroll';
import { useSettingsBootstrap } from '../../hooks/useSettings';
import { warmCriticalRoutes } from '../../lib/routePrefetch';

export function AppLayout() {
  const { pathname } = useLocation();
  const setMobileNav = useUIStore((s) => s.setMobileNav);
  const role = useAuthStore((s) => s.role);
  useGlobalShortcuts();
  useAutoRunPayroll();
  useSettingsBootstrap();

  // Close mobile nav + scroll to top on route change.
  useEffect(() => {
    setMobileNav(false);
    document.getElementById('main-scroll')?.scrollTo(0, 0);
  }, [pathname, setMobileNav]);

  // Prefetch common modules during idle time so first click isn't waiting on JS.
  useEffect(() => {
    warmCriticalRoutes(role);
  }, [role]);

  // Remount error boundary only when switching top-level modules (less churn).
  const moduleKey = pathname.split('/').filter(Boolean)[0] || 'app';

  return (
    <div className="flex h-screen overflow-hidden bg-page">
      <a
        href="#main-scroll"
        className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-[100] focus:rounded-lg focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-white focus:shadow-lg"
      >
        Skip to main content
      </a>
      <Sidebar />
      <div className="flex flex-1 flex-col min-w-0">
        <Topbar />
        <main id="main-scroll" className="flex-1 overflow-y-auto" tabIndex={-1}>
          <div className="mx-auto max-w-[1600px] px-4 sm:px-6 py-6">
            <ErrorBoundary key={moduleKey}>
              <Suspense fallback={<PageLoader />}>
                <Outlet />
              </Suspense>
            </ErrorBoundary>
          </div>
        </main>
      </div>
      <NotificationDrawer />
      <MobileNav />
      <ShortcutHelpModal />
      <ForcePasswordChangeModal />
    </div>
  );
}
