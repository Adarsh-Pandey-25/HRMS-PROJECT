import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useLocation } from 'react-router-dom';
import { ChevronsLeft } from 'lucide-react';
import { visibleNav, visiblePinnedItems } from '../../lib/constants';
import { NavAccordion } from './NavAccordion';
import { useUIStore } from '../../store/uiStore';
import { useAuthStore } from '../../store/authStore';
import { SidebarBrand } from './CompanyBrandMark';
import { useSettingsStore } from '../../store/settingsStore';
import { handleMenuArrowKeys } from '../../hooks/useDropdown';
import { prefetchRoute } from '../../lib/routePrefetch';
import { cn } from '../../lib/utils';

const CLOSE_DELAY = 150;

/** Floating submenu for a collapsed-sidebar parent item that has children. */
function FlyoutPanel({ item, anchorRect, onKeepOpen, onScheduleClose, onClose, panelRef }) {
  const location = useLocation();
  return createPortal(
    <div
      ref={panelRef}
      role="menu"
      aria-label={item.label}
      onMouseEnter={onKeepOpen}
      onMouseLeave={onScheduleClose}
      onKeyDown={(e) => {
        handleMenuArrowKeys(e, panelRef);
        if (e.key === 'Escape') onClose();
      }}
      style={{ position: 'fixed', top: anchorRect.top, left: anchorRect.right + 10 }}
      className="w-[200px] rounded-xl border border-border bg-sidebar shadow-2xl py-3 z-[100] animate-flyout-in"
    >
      <p className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">{item.label}</p>
      <div className="px-1.5 space-y-0.5">
        {item.children.map((child) => {
          const active = location.pathname === child.path || location.pathname.startsWith(child.path + '/');
          return (
            <Link
              key={child.path}
              to={child.path}
              role="menuitem"
              onClick={onClose}
              onMouseEnter={() => prefetchRoute(child.path)}
              onFocus={() => prefetchRoute(child.path)}
              className={cn(
                'flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors',
                'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset',
                active ? 'bg-primary/10 text-primary font-medium' : 'text-fg-muted hover:bg-primary/8 hover:text-fg'
              )}
            >
              <span className={cn('h-1.5 w-1.5 rounded-full shrink-0', active ? 'bg-primary' : 'bg-fg-subtle/50')} />
              {child.label}
            </Link>
          );
        })}
      </div>
    </div>,
    document.body
  );
}

/** Icon-only rail shown when the sidebar is collapsed. */
function CollapsedRail({ items, pinned }) {
  const location = useLocation();
  // Portal-rendered tooltip (childless items) so the label is never clipped
  // by the nav's horizontal overflow (overflow-y-auto also clips overflow-x).
  const [tip, setTip] = useState(null);
  // Flyout submenu (items with children) — hover/focus opens it; leaving
  // both the trigger AND the panel (with a short grace period so crossing
  // the gap between them doesn't flicker-close it) closes it.
  const [flyout, setFlyout] = useState(null); // { item, anchorRect } | null
  const closeTimer = useRef(null);
  const panelRef = useRef(null);
  const triggerRefs = useRef({});
  // Guards against the .focus() call in closeNow() re-triggering the trigger
  // button's own onFocus handler, which would otherwise immediately reopen
  // the flyout we're in the middle of closing.
  const suppressFocusOpen = useRef(false);

  const cancelClose = () => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };
  const scheduleClose = () => {
    cancelClose();
    closeTimer.current = setTimeout(() => setFlyout(null), CLOSE_DELAY);
  };
  const closeNow = (label) => {
    cancelClose();
    setFlyout(null);
    suppressFocusOpen.current = true;
    triggerRefs.current[label]?.focus();
  };

  const openFlyout = (item, el) => {
    cancelClose();
    setFlyout({ item, anchorRect: el.getBoundingClientRect() });
  };

  const parentActive = (item) =>
    item.children.some((c) => location.pathname === c.path || location.pathname.startsWith(c.path + '/'));

  const link = (item) => {
    if (item.children) {
      const active = parentActive(item);
      const isOpen = flyout?.item.label === item.label;
      return (
        <button
          key={item.label}
          ref={(el) => { triggerRefs.current[item.label] = el; }}
          type="button"
          aria-haspopup="menu"
          aria-expanded={isOpen}
          onMouseEnter={(e) => openFlyout(item, e.currentTarget)}
          onMouseLeave={scheduleClose}
          onFocus={(e) => {
            if (suppressFocusOpen.current) { suppressFocusOpen.current = false; return; }
            openFlyout(item, e.currentTarget);
          }}
          onClick={(e) => (isOpen ? closeNow(item.label) : openFlyout(item, e.currentTarget))}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown' && isOpen) {
              e.preventDefault();
              panelRef.current?.querySelector('[role="menuitem"]')?.focus();
            }
            if (e.key === 'Escape') closeNow(item.label);
          }}
          className={cn(
            'flex items-center justify-center h-11 w-11 mx-auto rounded-xl transition-colors',
            'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary',
            active ? 'bg-primary/10 text-primary' : 'text-fg-muted hover:bg-primary/5 hover:text-fg'
          )}
        >
          <item.icon className="h-[18px] w-[18px]" />
        </button>
      );
    }

    const active = location.pathname === item.path || location.pathname.startsWith(item.path + '/');
    return (
      <Link
        key={item.label}
        to={item.path}
        onMouseEnter={(e) => {
          prefetchRoute(item.path);
          const rect = e.currentTarget.getBoundingClientRect();
          setTip({ label: item.label, top: rect.top + rect.height / 2, left: rect.right + 12 });
        }}
        onFocus={() => prefetchRoute(item.path)}
        onClick={() => prefetchRoute(item.path)}
        onMouseLeave={() => setTip(null)}
        className={cn(
          'flex items-center justify-center h-11 w-11 mx-auto rounded-xl transition-colors',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary',
          active ? 'bg-primary/10 text-primary' : 'text-fg-muted hover:bg-primary/5 hover:text-fg'
        )}
      >
        <item.icon className="h-[18px] w-[18px]" />
      </Link>
    );
  };

  return (
    <>
      <nav className="flex-1 overflow-y-auto no-scrollbar px-2 pb-4 space-y-1">{items.map(link)}</nav>
      <div className="px-2 pb-1 space-y-1 border-t border-border/60 pt-3">{pinned.map(link)}</div>

      {tip && createPortal(
        <span
          style={{ position: 'fixed', top: tip.top, left: tip.left, transform: 'translateY(-50%)' }}
          className="pointer-events-none whitespace-nowrap rounded-lg bg-fg text-card text-xs font-medium px-2.5 py-1.5 shadow-lg z-[100]"
        >
          {tip.label}
        </span>,
        document.body
      )}

      {flyout && (
        <FlyoutPanel
          item={flyout.item}
          anchorRect={flyout.anchorRect}
          panelRef={panelRef}
          onKeepOpen={cancelClose}
          onScheduleClose={scheduleClose}
          onClose={() => closeNow(flyout.item.label)}
        />
      )}
    </>
  );
}

export function Sidebar() {
  const collapsed = useUIStore((s) => s.sidebarCollapsed);
  const toggle = useUIStore((s) => s.toggleSidebar);
  const role = useAuthStore((s) => s.role);
  const rolePermissions = useSettingsStore((s) => s.rolePermissions);
  const navItems = visibleNav(role, rolePermissions);
  const pinnedItems = visiblePinnedItems(role, rolePermissions);

  return (
    <aside
      className={cn(
        'hidden lg:flex flex-col shrink-0 bg-sidebar border-r border-border/60 transition-all duration-200',
        collapsed ? 'w-[76px]' : 'w-64'
      )}
    >
      <SidebarBrand collapsed={collapsed} />

      {collapsed ? (
        <CollapsedRail items={navItems} pinned={pinnedItems} />
      ) : (
        <>
          <nav className="flex-1 overflow-y-auto no-scrollbar px-3 pb-4">
            <NavAccordion items={navItems} />
          </nav>

          <div className="px-3 pb-1 space-y-0.5 border-t border-border/60 pt-3">
            {pinnedItems.map((item) => (
              <PinnedLink key={item.label} item={item} />
            ))}
          </div>
        </>
      )}

      {/* Collapse toggle */}
      <button
        onClick={toggle}
        className="flex items-center gap-2 mx-3 mb-3 px-3 py-2 rounded-xl text-xs text-fg-subtle hover:bg-muted hover:text-fg transition-colors"
      >
        <ChevronsLeft className={cn('h-4 w-4 transition-transform', collapsed && 'rotate-180')} />
        {!collapsed && 'Collapse'}
      </button>
    </aside>
  );
}

function PinnedLink({ item }) {
  const location = useLocation();
  const active = location.pathname === item.path || location.pathname.startsWith(item.path + '/');
  return (
    <Link
      to={item.path}
      onMouseEnter={() => prefetchRoute(item.path)}
      onFocus={() => prefetchRoute(item.path)}
      className={cn(
        'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors duration-150',
        active ? 'bg-primary/10 text-primary font-medium' : 'text-fg-muted hover:bg-primary/5 hover:text-fg'
      )}
    >
      <item.icon className={cn('h-[18px] w-[18px] shrink-0', active && 'text-primary')} />
      <span className="truncate">{item.label}</span>
    </Link>
  );
}
