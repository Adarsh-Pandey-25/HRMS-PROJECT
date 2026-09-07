import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { RotateCw } from 'lucide-react';
import { Card, Button, Skeleton, PageHeader } from '../../components/ui';
import { formatDateTime, formatCurrency } from '../../lib/utils';
import { listFailedPaymentsApi, retryFailedPaymentApi } from '../../api/subscription.api';

export default function FailedPayments() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [retryingId, setRetryingId] = useState(null);
  const { data, isLoading } = useQuery({
    queryKey: ['super-admin', 'failed-payments', page],
    queryFn: () => listFailedPaymentsApi({ page, limit: 20 }),
    keepPreviousData: true,
  });
  const rows = data?.items || [];
  const meta = data?.meta;

  const retry = async (id) => {
    setRetryingId(id);
    try {
      const result = await retryFailedPaymentApi(id);
      toast.success(result.invoicePaid ? 'Payment succeeded' : 'Retry failed again');
      await qc.invalidateQueries({ queryKey: ['super-admin', 'failed-payments'] });
    } catch (err) {
      toast.error(err.message || 'Retry failed');
    } finally {
      setRetryingId(null);
    }
  };

  return (
    <div className="space-y-6 animate-fade-in max-w-5xl">
      <PageHeader title="Failed Payments" subtitle="Payment attempts that failed — retry manually or investigate." />
      <Card>
        <div className="overflow-x-auto px-5 pb-5 pt-5">
          {isLoading ? <Skeleton className="h-64 w-full rounded-xl" /> : rows.length === 0 ? (
            <p className="text-sm text-fg-subtle py-8 text-center">No failed payments.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left">
                  {['Company', 'Invoice', 'Amount', 'Reason', 'Attempted', ''].map((h) => (
                    <th key={h || 'actions'} className="py-2.5 pr-3 font-semibold text-fg-subtle text-xs uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-border/60">
                    <td className="py-2.5 pr-3">
                      <button className="text-primary hover:underline" onClick={() => navigate(`/super-admin/companies/${r.subscriptionInvoices?.companyId}`)}>
                        {r.subscriptionInvoices?.companies?.name || 'Unknown'}
                      </button>
                    </td>
                    <td className="py-2.5 pr-3 font-mono text-xs">{r.subscriptionInvoices?.invoiceNumber}</td>
                    <td className="py-2.5 pr-3">{formatCurrency(r.subscriptionInvoices?.amount || 0)}</td>
                    <td className="py-2.5 pr-3 text-fg-subtle text-xs">{r.failureReason || '—'}</td>
                    <td className="py-2.5 pr-3 text-fg-subtle text-xs">{formatDateTime(r.attemptedAt)}</td>
                    <td className="py-2.5 text-right">
                      <Button size="sm" variant="outline" icon={RotateCw} loading={retryingId === r.id} onClick={() => retry(r.id)}>Retry</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {meta && meta.totalPages > 1 && (
            <div className="flex justify-end gap-2 mt-3">
              <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
              <span className="text-xs text-fg-subtle self-center">Page {page} of {meta.totalPages}</span>
              <Button size="sm" variant="outline" disabled={page >= meta.totalPages} onClick={() => setPage((p) => p + 1)}>Next</Button>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
