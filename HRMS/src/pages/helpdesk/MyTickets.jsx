import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Ticket, Send } from 'lucide-react';
import {
  PageHeader, Card, CardHeader, Button, StatusBadge, Drawer, Input,
  EmptyState, Skeleton, Avatar, Badge,
} from '../../components/ui';
import { useMyTickets, useHelpdeskMutations } from '../../hooks/useModules';
import { useEmployeeMap } from '../../hooks/useEmployees';
import { useAuthStore } from '../../store/authStore';
import { formatDateTime, timeAgo, humanize, stripHtml } from '../../lib/utils';
import toast from 'react-hot-toast';

export default function MyTickets() {
  const { data: tickets = [], isLoading } = useMyTickets();
  const { addComment } = useHelpdeskMutations();
  const employeeMap = useEmployeeMap();
  const userName = useAuthStore((s) => s.user?.name || s.user?.email || 'You');
  const [selected, setSelected] = useState(null);
  const [comment, setComment] = useState('');

  const selectedTicket = selected ? tickets.find((t) => t.id === selected.id) : null;

  const submitComment = async () => {
    if (!comment.trim() || !selected) return;
    try {
      await addComment.mutateAsync({ id: selected.id, text: comment.trim() });
      setComment('');
      toast.success('Comment added');
    } catch (err) {
      toast.error(err.message || 'Failed to add comment');
    }
  };

  const ticketDescription = (description) => stripHtml(description || '');

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="My Tickets"
        subtitle="Support requests you've raised"
        actions={<Link to="/helpdesk/new"><Button icon={Plus}>Raise Ticket</Button></Link>}
      />

      <Card>
        <CardHeader title="My Tickets" subtitle={`${tickets.length} tickets`} />
        <div className="p-5 pt-3 space-y-2">
          {isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : tickets.length === 0 ? (
            <EmptyState icon={Ticket} title="No tickets" message="Raise a ticket to get help." />
          ) : tickets.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setSelected(t)}
              className="flex items-center gap-4 w-full text-left rounded-xl border border-border/60 p-3 hover:bg-muted/40 transition-colors"
            >
              <div className="h-10 w-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
                <Ticket className="h-5 w-5" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-fg truncate">{t.subject}</p>
                <p className="text-xs text-fg-subtle">
                  {t.id?.slice(0, 8)} · {humanize(t.category)} · {timeAgo(t.createdAt)}
                </p>
                {ticketDescription(t.description) && (
                  <p className="text-xs text-fg-muted mt-0.5 line-clamp-1">{ticketDescription(t.description)}</p>
                )}
              </div>
              <StatusBadge status={t.priority} dot />
              <StatusBadge status={t.status} />
            </button>
          ))}
        </div>
      </Card>

      <Drawer
        open={!!selectedTicket}
        onClose={() => setSelected(null)}
        title={selectedTicket?.subject}
        subtitle={selectedTicket && `${selectedTicket.id?.slice(0, 8)} · ${humanize(selectedTicket.category)}`}
        width="w-[500px]"
      >
        {selectedTicket && (
          <div className="space-y-5">
            <div className="flex items-center gap-2 flex-wrap">
              <StatusBadge status={selectedTicket.status} />
              <StatusBadge status={selectedTicket.priority} dot />
              <Badge tone="neutral">{humanize(selectedTicket.category)}</Badge>
            </div>

            <div className="rounded-xl bg-muted/50 p-4">
              <div className="flex items-center gap-2 mb-2">
                <Avatar name={userName} size="xs" />
                <p className="text-sm font-medium text-fg">{userName}</p>
                <span className="text-xs text-fg-subtle ml-auto">{formatDateTime(selectedTicket.createdAt)}</span>
              </div>
              <p className="text-sm text-fg-muted whitespace-pre-wrap">
                {ticketDescription(selectedTicket.description) || 'No description provided.'}
              </p>
            </div>

            <div>
              <p className="text-sm font-semibold text-fg mb-3">Conversation</p>
              <div className="space-y-3">
                {(selectedTicket.comments || []).length === 0 && (
                  <p className="text-xs text-fg-subtle">No replies yet. HR or support will respond here.</p>
                )}
                {(selectedTicket.comments || []).map((c, i) => {
                  const author = employeeMap[c.by]?.name || 'Support';
                  return (
                    <div key={i} className="flex gap-3">
                      <Avatar name={author} size="sm" />
                      <div className="flex-1 min-w-0">
                        <div className="rounded-xl bg-card border border-border/60 p-3">
                          <p className="text-sm text-fg">{c.text}</p>
                        </div>
                        <p className="text-[11px] text-fg-subtle mt-1">
                          {author} · {timeAgo(c.at || c.createdAt)}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {!['resolved', 'closed'].includes(selectedTicket.status) && (
              <div className="flex items-center gap-2">
                <Input
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder="Add a comment…"
                  className="flex-1"
                  onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && submitComment()}
                />
                <Button icon={Send} onClick={submitComment} disabled={addComment.isPending || !comment.trim()} />
              </div>
            )}
          </div>
        )}
      </Drawer>
    </div>
  );
}
