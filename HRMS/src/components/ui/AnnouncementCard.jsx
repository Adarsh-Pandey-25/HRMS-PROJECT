import { useState } from 'react';
import { Pin, Paperclip, ChevronDown, Clock3 } from 'lucide-react';
import { cn, stripHtml, sanitizeHtml, safeHref, timeAgo, humanize } from '../../lib/utils';
import { PRIORITY_TONE } from '../../lib/constants';
import { Card } from './Card';
import { Badge } from './Badge';
import { Avatar } from './Avatar';

function audienceLabel(audience) {
  if (!audience || audience.type === 'all') return 'All employees';
  if (audience.value?.length) return audience.value.join(', ');
  return humanize(audience.type);
}

export function AnnouncementCard({ announcement: a, author, isUnread, onOpen }) {
  const [expanded, setExpanded] = useState(false);

  const toggle = () => {
    const next = !expanded;
    setExpanded(next);
    if (next) onOpen?.(a.id);
  };

  return (
    <Card className={cn('p-4 transition-colors', isUnread && 'border-primary/40')}>
      <div className="flex items-start gap-3">
        {isUnread && <span className="mt-2 h-2 w-2 rounded-full bg-primary shrink-0" title="Unread" />}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap mb-1.5">
            {a.isPinned && <Badge tone="primary"><Pin className="h-3 w-3" /> Pinned</Badge>}
            <Badge tone={PRIORITY_TONE[a.priority] || 'neutral'}>{humanize(a.priority)}</Badge>
            {a.status === 'scheduled' && (
              <Badge tone="info"><Clock3 className="h-3 w-3" /> Scheduled</Badge>
            )}
            <Badge tone="neutral">{audienceLabel(a.audience)}</Badge>
          </div>

          <button onClick={toggle} className="text-left w-full group">
            <h3 className="text-sm font-semibold text-fg group-hover:text-primary transition-colors">{a.title}</h3>
            <p className={cn('mt-1 text-sm text-fg-muted', !expanded && 'line-clamp-2')}>
              {expanded ? (
                <span dangerouslySetInnerHTML={{ __html: sanitizeHtml(a.body) }} className="prose-editor" />
              ) : (
                stripHtml(a.body)
              )}
            </p>
          </button>

          {a.attachments?.length > 0 && expanded && (
            <div className="mt-2 space-y-1">
              {a.attachments.map((att) => (
                <a key={att.name} href={safeHref(att.url)} rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline">
                  <Paperclip className="h-3 w-3" /> {att.name}
                </a>
              ))}
            </div>
          )}

          <div className="mt-2.5 flex items-center gap-2">
            <Avatar name={author?.name} size="xs" />
            <span className="text-xs text-fg-subtle">
              {author?.name || 'Unknown'} · {a.publishedAt ? timeAgo(a.publishedAt) : `scheduled ${timeAgo(a.scheduledAt)}`}
            </span>
            <button onClick={toggle} className="ml-auto text-fg-subtle hover:text-fg p-1">
              <ChevronDown className={cn('h-4 w-4 transition-transform', expanded && 'rotate-180')} />
            </button>
          </div>
        </div>
      </div>
    </Card>
  );
}
