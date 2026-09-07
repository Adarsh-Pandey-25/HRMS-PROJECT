import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Card, CardHeader, PageHeader, Select, StatusBadge, Skeleton, EmptyState } from '../../components/ui';
import { formatCurrency, formatDate } from '../../lib/utils';
import { listInvoicesApi } from '../../api/subscription.api';

const STATUS_OPTIONS = ['draft', 'pending', 'paid', 'failed', 'refunded', 'void'];

export default function Invoices() {
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');

  const params = useMemo(() => ({ page, limit: 20, ...(status && { status }) }), [page, status]);
  const { data, isLoading } = useQuery({
    queryKey: ['super-admin', 'invoices', params],
    queryFn: () => listInvoicesApi(params),
  });

  const rows = data?.items || [];
  const meta = data?.meta;

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader title="Invoices" subtitle="Every invoice, across every company." />

      <Select
        value={status}
        onChange={(e) => { setStatus(e.target.value); setPage(1); }}
        placeholder="All statuses"
        className="w-48"
      >
        {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
      </Select>

      <Card>
        <CardHeader title="All invoices" subtitle={meta ? `${meta.total} total` : ''} />
        <div className="overflow-x-auto px-5 pb-5">
          {isLoading ? (
            <Skeleton className="h-64 w-full rounded-xl" />
          ) : rows.length === 0 ? (
            <EmptyState title="No invoices" message="No invoices match these filters." className="py-12" />
          ) : (
            <>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left">
                    {['Invoice', 'Company', 'Amount', 'Cycle', 'Status', 'Issued', 'Paid'].map((h) => (
                      <th key={h} className="py-2.5 pr-3 font-semibold text-fg-subtle text-xs uppercase tracking-wide">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((inv) => (
                    <tr
                      key={inv.id}
                      onClick={() => navigate(`/super-admin/subscriptions/${inv.companySubscriptionId}`)}
                      className="border-b border-border/60 cursor-pointer hover:bg-muted/40"
                    >
                      <td className="py-3 pr-3 font-mono text-xs text-fg">{inv.invoiceNumber}</td>
                      <td className="py-3 pr-3 font-medium text-fg">{inv.companies?.name}</td>
                      <td className="py-3 pr-3 text-fg-muted tabular-nums">{formatCurrency(inv.amount)}</td>
                      <td className="py-3 pr-3 text-fg-muted capitalize">{inv.billingCycle}</td>
                      <td className="py-3 pr-3"><StatusBadge status={inv.status} /></td>
                      <td className="py-3 pr-3 text-fg-subtle text-xs">{formatDate(inv.issuedAt)}</td>
                      <td className="py-3 pr-3 text-fg-subtle text-xs">{inv.paidAt ? formatDate(inv.paidAt) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {meta && meta.totalPages > 1 && (
                <div className="flex items-center justify-between pt-4">
                  <span className="text-xs text-fg-subtle">Page {meta.page} of {meta.totalPages} · {meta.total} records</span>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      disabled={meta.page <= 1}
                      className="h-8 w-8 flex items-center justify-center rounded-md text-fg-muted hover:bg-muted disabled:opacity-30"
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => setPage((p) => Math.min(meta.totalPages, p + 1))}
                      disabled={meta.page >= meta.totalPages}
                      className="h-8 w-8 flex items-center justify-center rounded-md text-fg-muted hover:bg-muted disabled:opacity-30"
                    >
                      <ChevronRight className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </Card>
    </div>
  );
}
