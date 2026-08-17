import { useMemo, useState } from 'react';
import { AlertTriangle, Send } from 'lucide-react';
import {
  PageHeader, Card, CardHeader, Button, StatusBadge, Badge, Drawer, Input,
  DataTable, Skeleton, Avatar, Select, SearchInput, EmptyState,
} from '../../components/ui';
import { ExportButton } from '../../components/shared/ExportButton';
import { useAllTickets, useHelpdeskMutations } from '../../hooks/useModules';
import { useEmployeeMap } from '../../hooks/useEmployees';
import { useSettingsStore } from '../../store/settingsStore';
import { formatDateTime, timeAgo, humanize, stripHtml } from '../../lib/utils';
import toast from 'react-hot-toast';

const STATUSES = ['open', 'in_progress', 'resolved', 'closed'];
const PRIORITIES = ['low', 'medium', 'high', 'critical'];
const FALLBACK_CATEGORIES = ['it', 'hr', 'admin', 'finance', 'payroll', 'other', 'leave', 'benefits'];

const SLA_STATE = (t) => {
  if (['resolved', 'closed'].includes(t.status)) return null;
  if (!t.slaDueBy) return 'ontrack';
  const due = new Date(t.slaDueBy);
  return due < new Date() ? 'breached' : 'ontrack';
};

export default function AllTickets() {
  const { data: tickets = [], isLoading } = useAllTickets();
  const { addComment, updateStatus } = useHelpdeskMutations();
  const employeeMap = useEmployeeMap();
  const configured = useSettingsStore((s) => s.helpdeskConfig?.categories) || [];
  const categoryOptions = (configured.length ? configured : FALLBACK_CATEGORIES).map((c) =>
    String(c).trim().toLowerCase().replace(/\s+/g, '_')
  );
  const [selected, setSelected] = useState(null);
  const [comment, setComment] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');

  const selectedTicket = selected ? tickets.find((t) => t.id === selected.id) : null;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return tickets.filter((t) => {
      if (statusFilter && t.status !== statusFilter) return false;
      if (categoryFilter && t.category !== categoryFilter) return false;
      if (priorityFilter && t.priority !== priorityFilter) return false;
      if (!q) return true;
      const raiser = employeeMap[t.raisedBy]?.name || '';
      return (
        t.subject?.toLowerCase().includes(q)
        || t.id?.toLowerCase().includes(q)
        || raiser.toLowerCase().includes(q)
        || t.category?.toLowerCase().includes(q)
      );
    });
  }, [tickets, search, statusFilter, categoryFilter, priorityFilter, employeeMap]);

  const submitComment = async () => {
    if (!comment.trim() || !selected) return;
    try {
      await addComment.mutateAsync({ id: selected.id, text: comment });
      setComment('');
      toast.success('Comment added');
    } catch (err) {
      toast.error(err.message || 'Failed to add comment');
    }
  };

  const changeStatus = async (status) => {
    if (!selectedTicket || selectedTicket.status === status) return;
    try {
      await updateStatus.mutateAsync({ id: selectedTicket.id, status });
      toast.success(`Ticket marked ${humanize(status)}`);
    } catch (err) {
      toast.error(err.message || 'Failed to update status');
    }
  };

  const columns = [
    {
      accessorKey: 'id',
      header: 'Ticket',
      cell: ({ row }) => (
        <span className="font-mono text-xs font-medium text-primary">{row.original.id?.slice(0, 8)}</span>
      ),
    },
    {
      accessorKey: 'subject',
      header: 'Subject',
      cell: ({ row }) => {
        const raiser = employeeMap[row.original.raisedBy];
        return (
          <div>
            <p className="font-medium text-fg">{row.original.subject}</p>
            <p className="text-xs text-fg-subtle">by {raiser?.name || 'Employee'}</p>
          </div>
        );
      },
    },
    {
      accessorKey: 'category',
      header: 'Category',
      cell: ({ getValue }) => <Badge tone="neutral">{humanize(getValue())}</Badge>,
    },
    {
      accessorKey: 'priority',
      header: 'Priority',
      cell: ({ getValue }) => <StatusBadge status={getValue()} dot />,
    },
    {
      accessorKey: 'status',
      header: 'Status',
      cell: ({ getValue }) => <StatusBadge status={getValue()} />,
    },
    {
      id: 'sla',
      header: 'SLA',
      cell: ({ row }) => {
        const sla = SLA_STATE(row.original);
        if (!sla) return <span className="text-xs text-fg-subtle">—</span>;
        return sla === 'breached'
          ? <Badge tone="danger"><AlertTriangle className="h-3 w-3" /> Breached</Badge>
          : <Badge tone="success">On track</Badge>;
      },
    },
  ];

  const exportRows = useMemo(
    () => filtered.map((t) => ({
      id: t.id,
      subject: t.subject,
      raisedBy: employeeMap[t.raisedBy]?.name || t.raisedBy,
      category: t.category,
      priority: t.priority,
      status: t.status,
      sla: SLA_STATE(t) || 'closed',
      created: t.createdAt,
      slaDueBy: t.slaDueBy,
    })),
    [filtered, employeeMap]
  );

  const filterControls = (
    <div className="flex items-center gap-2 flex-wrap justify-end">
      <SearchInput
        value={search}
        onChange={setSearch}
        placeholder="Search tickets…"
        className="w-48"
      />
      <Select
        value={statusFilter}
        onChange={(e) => setStatusFilter(e.target.value)}
        options={STATUSES}
        placeholder="All statuses"
        className="h-9 text-xs w-36"
      />
      <Select
        value={categoryFilter}
        onChange={(e) => setCategoryFilter(e.target.value)}
        options={categoryOptions}
        placeholder="All categories"
        className="h-9 text-xs w-36"
      />
      <Select
        value={priorityFilter}
        onChange={(e) => setPriorityFilter(e.target.value)}
        options={PRIORITIES}
        placeholder="All priorities"
        className="h-9 text-xs w-36"
      />
      <ExportButton
        rows={exportRows}
        filename="helpdesk-tickets"
        title="All Helpdesk Tickets"
        columns={['id', 'subject', 'raisedBy', 'category', 'priority', 'status', 'sla', 'created', 'slaDueBy']}
      />
    </div>
  );

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader title="All Tickets" subtitle="Every support request across the organisation" />

      <Card>
        <CardHeader
          title="All Tickets"
          subtitle={`${filtered.length} of ${tickets.length} tickets`}
          action={filterControls}
        />
        {isLoading ? (
          <Skeleton className="h-48 m-5 rounded-xl" />
        ) : filtered.length === 0 ? (
          <EmptyState
            className="py-12"
            title={tickets.length === 0 ? 'No tickets yet' : 'No matching tickets'}
            message={tickets.length === 0 ? 'Support requests will appear here once employees raise tickets.' : 'Try adjusting your search or filters.'}
          />
        ) : (
          <DataTable columns={columns} data={filtered} pageSize={10} onRowClick={setSelected} />
        )}
      </Card>

      <Drawer
        open={!!selectedTicket}
        onClose={() => setSelected(null)}
        title={selectedTicket?.subject}
        subtitle={selectedTicket && `${selectedTicket.id?.slice(0, 8)} · ${humanize(selectedTicket.category)}`}
        width="w-[500px]"
        footer={selectedTicket && (
          <>
            <Select
              label="Update status"
              value={selectedTicket.status}
              onChange={(e) => changeStatus(e.target.value)}
              options={STATUSES.map((s) => ({ value: s, label: humanize(s) }))}
              className="flex-1"
              disabled={updateStatus.isPending}
            />
            {selectedTicket.status === 'open' && (
              <Button variant="outline" onClick={() => changeStatus('in_progress')} disabled={updateStatus.isPending}>
                Start
              </Button>
            )}
            {!['resolved', 'closed'].includes(selectedTicket.status) && (
              <Button onClick={() => changeStatus('resolved')} disabled={updateStatus.isPending}>
                Resolve
              </Button>
            )}
          </>
        )}
      >
        {selectedTicket && (
          <div className="space-y-5">
            <div className="flex items-center gap-2 flex-wrap">
              <StatusBadge status={selectedTicket.status} />
              <StatusBadge status={selectedTicket.priority} dot />
              {SLA_STATE(selectedTicket) === 'breached' && (
                <Badge tone="danger"><AlertTriangle className="h-3 w-3" /> SLA Breached</Badge>
              )}
              {SLA_STATE(selectedTicket) === 'ontrack' && selectedTicket.slaDueBy && (
                <Badge tone="neutral">Due {formatDateTime(selectedTicket.slaDueBy)}</Badge>
              )}
            </div>

            <div className="rounded-xl bg-muted/50 p-4">
              <div className="flex items-center gap-2 mb-2">
                <Avatar name={employeeMap[selectedTicket.raisedBy]?.name || 'Employee'} size="xs" />
                <p className="text-sm font-medium text-fg">
                  {employeeMap[selectedTicket.raisedBy]?.name || 'Employee'}
                </p>
                <span className="text-xs text-fg-subtle ml-auto">{formatDateTime(selectedTicket.createdAt)}</span>
              </div>
              <p className="text-sm text-fg-muted whitespace-pre-wrap">
                {stripHtml(selectedTicket.description) || 'No description provided.'}
              </p>
            </div>

            <div>
              <p className="text-sm font-semibold text-fg mb-3">Conversation</p>
              <div className="space-y-3">
                {(selectedTicket.comments || []).length === 0 && (
                  <p className="text-xs text-fg-subtle">No replies yet.</p>
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
          </div>
        )}
      </Drawer>
    </div>
  );
}
