import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Megaphone, ArrowRight } from 'lucide-react';
import { Card, CardHeader, Badge } from '../../components/ui';
import { useActiveAnnouncements } from '../../hooks/useAnnouncements';
import { PRIORITY_TONE } from '../../lib/constants';
import { formatDate, timeAgo, humanize } from '../../lib/utils';

export function Greeting({ user, dateLabel }) {
  const today = dateLabel ? new Date(dateLabel) : new Date();
  return (
    <div>
      <h1 className="text-page-title text-fg">Hello {user?.firstName} 👋</h1>
      <p className="mt-1 text-sm text-fg-muted">{formatDate(today, 'EEEE, MMMM d, yyyy')}</p>
    </div>
  );
}

export function RecentAnnouncements({ count = 3 }) {
  const { data: announcements = [], isLoading } = useActiveAnnouncements();
  const recent = useMemo(() => announcements.slice(0, count), [announcements, count]);

  return (
    <Card>
      <CardHeader
        title="Recent Announcements"
        subtitle="Latest company updates"
        action={
          <Link to="/announcements" className="flex items-center gap-1 text-xs font-medium text-primary hover:underline">
            View all <ArrowRight className="h-3 w-3" />
          </Link>
        }
      />
      <div className="p-5 pt-3 space-y-2">
        {isLoading ? (
          <p className="text-sm text-fg-subtle">Loading announcements…</p>
        ) : recent.length === 0 ? (
          <p className="text-sm text-fg-subtle">No announcements yet.</p>
        ) : recent.map((a) => (
          <Link key={a.id} to="/announcements" className="flex items-center gap-3 rounded-xl p-2.5 hover:bg-muted transition-colors group">
            <div className="h-9 w-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
              <Megaphone className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-fg truncate">{a.title}</p>
              <p className="text-xs text-fg-subtle">{timeAgo(a.publishedAt)}</p>
            </div>
            <Badge tone={PRIORITY_TONE[a.priority] || 'neutral'}>{humanize(a.priority)}</Badge>
            <ArrowRight className="h-4 w-4 text-fg-subtle opacity-0 group-hover:opacity-100 transition-opacity" />
          </Link>
        ))}
      </div>
    </Card>
  );
}

/** items: [{ label, count, icon, to, tone }] */
export function PendingList({ title, subtitle, items }) {
  return (
    <Card>
      <CardHeader title={title} subtitle={subtitle} />
      <div className="p-5 pt-3 space-y-2">
        {items.length === 0 ? (
          <p className="text-sm text-fg-subtle">Nothing pending. 🎉</p>
        ) : items.map((p) => (
          <Link key={p.label} to={p.to} className="flex items-center gap-3 rounded-xl p-2.5 hover:bg-muted transition-colors group">
            <div className={`h-9 w-9 rounded-lg flex items-center justify-center ${p.tone}`}>
              <p.icon className="h-4 w-4" />
            </div>
            <span className="text-sm text-fg flex-1">{p.label}</span>
            <Badge tone="neutral">{p.count}</Badge>
            <ArrowRight className="h-4 w-4 text-fg-subtle opacity-0 group-hover:opacity-100 transition-opacity" />
          </Link>
        ))}
      </div>
    </Card>
  );
}
