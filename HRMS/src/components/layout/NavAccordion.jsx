import { memo, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { useUIStore } from '../../store/uiStore';
import { prefetchRoute } from '../../lib/routePrefetch';
import { cn } from '../../lib/utils';

const parentBase =
  'flex items-center gap-3 w-full rounded-xl px-3 py-2.5 text-sm transition-colors duration-150 text-left ' +
  'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset';

/**
 * Accordion navigation shared by the desktop Sidebar and the MobileNav drawer.
 * Prefetches the target chunk on hover/focus so clicks feel instant.
 */
export const NavAccordion = memo(function NavAccordion({ items, onNavigate }) {
  const location = useLocation();
  const openGroup = useUIStore((s) => s.openNavGroup);
  const setOpenGroup = useUIStore((s) => s.setOpenNavGroup);

  const childActive = (childPath) => location.pathname === childPath;

  const parentActive = (item) =>
    !!item.children && item.children.some((c) => location.pathname === c.path || location.pathname.startsWith(c.path + '/'));

  const activeParent = items.find((i) => parentActive(i))?.label ?? null;
  useEffect(() => {
    if (activeParent) setOpenGroup(activeParent);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeParent]);

  const warm = (path) => () => prefetchRoute(path);

  return (
    <div className="space-y-0.5">
      {items.map((item) => {
        if (!item.children) {
          const active = location.pathname === item.path;
          return (
            <Link
              key={item.label}
              to={item.path}
              onClick={onNavigate}
              onMouseEnter={warm(item.path)}
              onFocus={warm(item.path)}
              aria-current={active ? 'page' : undefined}
              className={cn(
                parentBase,
                active ? 'bg-primary/10 text-primary font-medium' : 'text-fg-muted hover:bg-primary/5 hover:text-fg'
              )}
            >
              <item.icon className={cn('h-[18px] w-[18px] shrink-0', active && 'text-primary')} />
              <span className="truncate flex-1">{item.label}</span>
            </Link>
          );
        }

        const isOpen = openGroup === item.label;
        const hasActiveChild = parentActive(item);
        const groupId = `nav-group-${item.label.replace(/\s+/g, '-').toLowerCase()}`;
        return (
          <div key={item.label}>
            <button
              type="button"
              aria-expanded={isOpen}
              aria-controls={groupId}
              onMouseEnter={() => item.children?.forEach((c) => prefetchRoute(c.path))}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setOpenGroup(isOpen ? null : item.label);
                item.children?.forEach((c) => prefetchRoute(c.path));
              }}
              className={cn(
                parentBase,
                hasActiveChild ? 'text-primary bg-primary/5 font-medium' : 'text-fg-muted hover:bg-primary/5 hover:text-fg'
              )}
            >
              <item.icon className={cn('h-[18px] w-[18px] shrink-0', hasActiveChild && 'text-primary')} />
              <span className="truncate flex-1">{item.label}</span>
              <ChevronRight
                className={cn('h-3.5 w-3.5 shrink-0 transition-transform duration-200', isOpen && 'rotate-90')}
              />
            </button>

            <div id={groupId} className={cn('overflow-hidden transition-all duration-200 ease-in-out', isOpen ? 'max-h-96' : 'max-h-0')}>
              <div className="mt-0.5 ml-[26px] border-l border-border/70 pl-2.5 py-0.5 space-y-0.5">
                {item.children.map((child) => {
                  const active = childActive(child.path);
                  return (
                    <Link
                      key={child.label}
                      to={child.path}
                      onClick={onNavigate}
                      onMouseEnter={warm(child.path)}
                      onFocus={warm(child.path)}
                      aria-current={active ? 'page' : undefined}
                      className={cn(
                        'block rounded-lg px-3 py-1.5 text-[13px] transition-colors',
                        'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset',
                        active
                          ? 'bg-primary/10 text-primary font-medium'
                          : 'text-fg-muted hover:bg-primary/5 hover:text-fg'
                      )}
                    >
                      {child.label}
                    </Link>
                  );
                })}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
});
