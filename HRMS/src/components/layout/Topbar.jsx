import { Link, useNavigate } from 'react-router-dom';
import { Bell, Megaphone, Moon, Sun, ChevronDown, ChevronsRight, ChevronsLeft, LogOut, User, Menu } from 'lucide-react';
import toast from 'react-hot-toast';
import { useUIStore } from '../../store/uiStore';
import { useAuthStore, useCurrentUser } from '../../store/authStore';
import { useNotificationStore } from '../../store/notificationStore';
import { useUnreadNotificationCount } from '../../hooks/useNotifications';
import { useActiveAnnouncements, useAnnouncementMutations } from '../../hooks/useAnnouncements';
import { useDropdown, handleMenuArrowKeys } from '../../hooks/useDropdown';
import { Avatar } from '../ui/Avatar';
import { GlobalSearch } from './GlobalSearch';
import { humanize, cn, timeAgo } from '../../lib/utils';
import { employeeProfilePath } from '../../lib/employeeRoutes';

const PRIORITY_DOT = { normal: 'bg-fg-subtle', important: 'bg-warning', urgent: 'bg-danger' };

export function Topbar() {
  const navigate = useNavigate();
  const { isDark, toggleDark, setMobileNav, topbarActionsCollapsed, toggleTopbarActions } = useUIStore();
  const user = useCurrentUser();
  const { role, logout } = useAuthStore();
  const { toggleDrawer } = useNotificationStore();
  const { data: unread = 0 } = useUnreadNotificationCount();

  const menu = useDropdown();
  const ann = useDropdown();

  const { data: activeAnnouncements = [] } = useActiveAnnouncements();
  const { acknowledge } = useAnnouncementMutations();
  const publishedFeed = activeAnnouncements.filter((a) => a.status === 'published');
  const annPreview = publishedFeed.slice(0, 5);

  const signOut = () => {
    logout();
    menu.close();
    toast.success('Signed out');
    navigate('/login');
  };

  return (
    <header className="h-16 shrink-0 bg-card/80 backdrop-blur-md border-b border-border/60 flex items-center gap-3 px-4 sm:px-6 sticky top-0 z-30">
      {/* Mobile nav toggle */}
      <button
        onClick={() => setMobileNav(true)}
        className="lg:hidden h-10 w-10 rounded-xl flex items-center justify-center text-fg-muted hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        <Menu className="h-5 w-5" />
      </button>

      {/* Global search */}
      <GlobalSearch />

      <div className="flex-1 sm:hidden" />

      {/* Actions */}
      <div className="flex items-center gap-1.5 ml-auto">
        {!topbarActionsCollapsed && (
        <>
        {/* Announcements */}
        <div className="relative" ref={ann.containerRef}>
          <button
            ref={ann.triggerRef}
            onClick={() => ann.setOpen((o) => !o)}
            aria-haspopup="menu"
            aria-expanded={ann.open}
            aria-controls="announcements-menu"
            aria-label="Announcements"
            className="relative h-10 w-10 rounded-xl flex items-center justify-center text-fg-muted hover:bg-muted hover:text-fg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            title="Announcements"
          >
            <Megaphone className="h-5 w-5" />
            {publishedFeed.length > 0 && (
              <span className="absolute top-1.5 right-1.5 h-4 min-w-4 px-1 rounded-full bg-primary text-white text-[10px] font-semibold flex items-center justify-center">
                {publishedFeed.length}
              </span>
            )}
          </button>

          {ann.open && (
            <div
              id="announcements-menu"
              role="menu"
              onKeyDown={(e) => handleMenuArrowKeys(e, ann.containerRef)}
              className="absolute right-0 mt-2 w-80 rounded-card bg-card border border-border shadow-card-hover animate-scale-in z-50 overflow-hidden"
            >
              <div className="px-4 py-3 border-b border-border/60">
                <p className="text-sm font-semibold text-fg">Announcements</p>
              </div>
              <div className="max-h-80 overflow-y-auto no-scrollbar">
                {annPreview.length === 0 ? (
                  <p className="px-4 py-6 text-sm text-fg-subtle text-center">No announcements yet.</p>
                ) : (
                  annPreview.map((a) => (
                    <Link
                      key={a.id}
                      to="/announcements"
                      role="menuitem"
                      onClick={() => { acknowledge.mutate(a.id); ann.close(); }}
                      className="block px-4 py-3 border-b border-border/40 last:border-0 hover:bg-muted/60 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <span className={cn('h-1.5 w-1.5 rounded-full shrink-0', PRIORITY_DOT[a.priority] || 'bg-fg-subtle')} />
                        <p className="text-sm font-medium text-fg truncate flex-1">{a.title}</p>
                      </div>
                      <p className="text-xs text-fg-subtle">{timeAgo(a.publishedAt)}</p>
                    </Link>
                  ))
                )}
              </div>
              <Link
                to="/announcements"
                role="menuitem"
                onClick={() => ann.close()}
                className="block text-center px-4 py-2.5 text-xs font-medium text-primary hover:bg-primary/5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
              >
                View all
              </Link>
            </div>
          )}
        </div>

        <button
          onClick={toggleDrawer}
          aria-label={`Notifications${unread > 0 ? ` (${unread} unread)` : ''}`}
          className="relative h-10 w-10 rounded-xl flex items-center justify-center text-fg-muted hover:bg-muted hover:text-fg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          title="Notifications"
        >
          <Bell className="h-5 w-5" />
          {unread > 0 && (
            <span className="absolute top-1.5 right-1.5 h-4 min-w-4 px-1 rounded-full bg-danger text-white text-[10px] font-semibold flex items-center justify-center">
              {unread}
            </span>
          )}
        </button>

        <button
          onClick={toggleDark}
          aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
          className="h-10 w-10 rounded-xl flex items-center justify-center text-fg-muted hover:bg-muted hover:text-fg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          title="Toggle theme"
        >
          {isDark ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
        </button>
        </>
        )}

        {/* Collapse/expand the action icons above */}
        <button
          onClick={toggleTopbarActions}
          aria-label={topbarActionsCollapsed ? 'Show topbar actions' : 'Collapse topbar actions'}
          className="h-10 w-10 rounded-xl flex items-center justify-center text-fg-muted hover:bg-muted hover:text-fg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          title={topbarActionsCollapsed ? 'Show topbar actions' : 'Collapse topbar actions'}
        >
          {topbarActionsCollapsed ? <ChevronsLeft className="h-4 w-4" /> : <ChevronsRight className="h-4 w-4" />}
        </button>

        {/* Avatar + name */}
        <div className="relative" ref={menu.containerRef}>
          <button
            ref={menu.triggerRef}
            onClick={() => menu.setOpen((o) => !o)}
            aria-haspopup="menu"
            aria-expanded={menu.open}
            aria-controls="account-menu"
            aria-label="Account menu"
            className="flex items-center gap-2 rounded-xl pl-1.5 pr-2 py-1.5 hover:bg-muted transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <Avatar name={user?.name} size="sm" />
            <div className="hidden md:block text-left">
              <p className="text-xs font-semibold text-fg leading-tight">{user?.firstName} {user?.lastName}</p>
              <p className="text-[10px] text-fg-subtle leading-tight">{humanize(role)}</p>
            </div>
            <ChevronDown className="h-4 w-4 text-fg-subtle hidden md:block" />
          </button>

          {menu.open && (
            <div
              id="account-menu"
              role="menu"
              onKeyDown={(e) => handleMenuArrowKeys(e, menu.containerRef)}
              className="absolute right-0 mt-2 w-56 rounded-card bg-card border border-border shadow-card-hover p-1.5 animate-scale-in z-50"
            >
              <div className="px-3 py-2.5 border-b border-border/60 mb-1">
                <p className="text-sm font-semibold text-fg">{user?.name}</p>
                <p className="text-xs text-fg-subtle">{user?.workEmail}</p>
              </div>
              <Link
                to={employeeProfilePath(user)}
                role="menuitem"
                onClick={() => menu.close()}
                className="flex items-center gap-2 w-full rounded-lg px-3 py-2 text-sm text-fg-muted hover:bg-muted transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
              >
                <User className="h-4 w-4" /> My Profile
              </Link>
              <div className="border-t border-border/60 mt-1 pt-1">
                <button role="menuitem" onClick={signOut} className="flex items-center gap-2 w-full rounded-lg px-3 py-2 text-sm text-fg-muted hover:bg-muted transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary">
                  <LogOut className="h-4 w-4" /> Sign out
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
