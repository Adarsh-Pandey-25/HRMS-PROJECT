import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  CheckCheck, CalendarOff, Receipt, LifeBuoy, TrendingUp, DollarSign,
  Monitor, Bell, FileText, Megaphone,
} from 'lucide-react';
import { Drawer } from '../ui/Drawer';
import { EmptyState } from '../ui/EmptyState';
import { Skeleton } from '../ui/Skeleton';
import { useNotificationStore } from '../../store/notificationStore';
import {
  useNotifications, useNotificationMutations, useUnreadNotificationCount,
} from '../../hooks/useNotifications';
import { resolveNotificationLink } from '../../lib/notificationLinks';
import { timeAgo, cn } from '../../lib/utils';

const ICONS = {
  leave: { icon: CalendarOff, tone: 'text-info bg-info/10' },
  reimbursement: { icon: Receipt, tone: 'text-warning bg-warning/10' },
  expense: { icon: Receipt, tone: 'text-warning bg-warning/10' },
  document: { icon: FileText, tone: 'text-primary bg-primary/10' },
  payroll: { icon: DollarSign, tone: 'text-success bg-success/10' },
  payslip: { icon: DollarSign, tone: 'text-success bg-success/10' },
  ticket: { icon: LifeBuoy, tone: 'text-primary bg-primary/10' },
  review: { icon: TrendingUp, tone: 'text-teal bg-teal/10' },
  asset: { icon: Monitor, tone: 'text-primary bg-primary/10' },
  announcement: { icon: Megaphone, tone: 'text-warning bg-warning/10' },
  general: { icon: Bell, tone: 'text-primary bg-primary/10' },
};

function iconForType(type) {
  const key = String(type || 'general').toLowerCase();
  return ICONS[key] || ICONS.general;
}

function groupByDay(items) {
  const today = [];
  const earlier = [];
  const now = new Date();
  items.forEach((n) => {
    const d = new Date(n.at);
    if (Number.isNaN(d.getTime())) {
      earlier.push(n);
      return;
    }
    if (d.toDateString() === now.toDateString()) today.push(n);
    else earlier.push(n);
  });
  // Unread first within each group so they stand out in mixed lists
  const byUnreadFirst = (list) =>
    [...list].sort((a, b) => Number(a.read) - Number(b.read) || new Date(b.at) - new Date(a.at));
  return { today: byUnreadFirst(today), earlier: byUnreadFirst(earlier) };
}

export function NotificationDrawer() {
  const navigate = useNavigate();
  const { drawerOpen, closeDrawer } = useNotificationStore();
  const { data: notifications = [], isLoading, refetch: refetchList } = useNotifications({
    enabled: true,
  });
  const { data: unreadFromApi = 0, refetch: refetchCount } = useUnreadNotificationCount();
  const { markRead, markAllRead } = useNotificationMutations();

  const unreadFromList = notifications.filter((n) => !n.read).length;
  const listLoaded = !isLoading && Array.isArray(notifications);
  const unreadCount = listLoaded ? unreadFromList : unreadFromApi;

  const { today, earlier } = groupByDay(notifications);

  useEffect(() => {
    if (!drawerOpen) return;
    refetchList();
    refetchCount();
  }, [drawerOpen, refetchList, refetchCount]);

  const handleClick = (n) => {
    if (!n.read) markRead.mutate(n.id);
    const target = resolveNotificationLink(n.link);
    if (target) {
      closeDrawer();
      navigate(target);
    }
  };

  const Group = ({ title, items }) =>
    items.length > 0 && (
      <div className="mb-5">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-fg-subtle mb-2">{title}</p>
        <div className="space-y-2">
          {items.map((n) => {
            const meta = iconForType(n.type);
            const Icon = meta.icon;
            const unread = !n.read;
            return (
              <button
                key={n.id}
                type="button"
                onClick={() => handleClick(n)}
                className={cn(
                  'flex gap-3 w-full text-left rounded-xl p-3 transition-colors border',
                  unread
                    ? 'bg-primary/10 border-primary/30 shadow-sm ring-1 ring-primary/15 hover:bg-primary/15'
                    : 'bg-transparent border-transparent opacity-70 hover:opacity-100 hover:bg-muted'
                )}
              >
                <div className={cn(
                  'h-9 w-9 rounded-lg flex items-center justify-center shrink-0',
                  meta.tone,
                  unread ? 'ring-2 ring-primary/25' : ''
                )}>
                  <Icon className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start gap-2">
                    <p className={cn(
                      'text-sm truncate flex-1',
                      unread ? 'font-semibold text-fg' : 'font-medium text-fg-muted'
                    )}>
                      {n.title}
                    </p>
                    {unread ? (
                      <span className="shrink-0 mt-0.5 rounded-md bg-primary px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
                        New
                      </span>
                    ) : null}
                  </div>
                  <p className={cn('text-xs mt-0.5', unread ? 'text-fg-muted' : 'text-fg-subtle')}>{n.body}</p>
                  <p className="text-[11px] text-fg-subtle mt-1">{timeAgo(n.at)}</p>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    );

  return (
    <Drawer
      open={drawerOpen}
      onClose={closeDrawer}
      title="Notifications"
      subtitle={`${unreadCount} unread`}
      footer={
        <button
          type="button"
          onClick={() => markAllRead.mutate()}
          disabled={unreadCount === 0 || markAllRead.isPending}
          className="flex items-center gap-2 text-sm font-medium text-primary hover:text-primary-dark transition-colors disabled:opacity-50"
        >
          <CheckCheck className="h-4 w-4" /> Mark all as read
        </button>
      }
    >
      {isLoading ? (
        <div className="space-y-3">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-16 rounded-xl" />)}</div>
      ) : notifications.length === 0 ? (
        <EmptyState icon={Bell} title="All caught up" message="You have no notifications right now." />
      ) : (
        <>
          <Group title="Today" items={today} />
          <Group title="Earlier" items={earlier} />
        </>
      )}
    </Drawer>
  );
}
