import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Card, CardHeader, PageHeader, Select, StatusBadge, Skeleton, EmptyState } from '../../components/ui';
import { formatCurrency, formatDate } from '../../lib/utils';
import { listSubscriptionsApi, listPlansApi } from '../../api/subscription.api';

const STATUS_OPTIONS = ['trialing', 'active', 'past_due', 'grace_period', 'suspended', 'cancelled', 'expired'];
const CYCLE_OPTIONS = ['monthly', 'quarterly', 'annual'];

export default function SubscriptionsList() {
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [planId, setPlanId] = useState('');
  const [billingCycle, setBillingCycle] = useState('');

  const { data: plans = [] } = useQuery({ queryKey: ['super-admin', 'plans', 'all'], queryFn: () => listPlansApi(true) });

  const params = useMemo(() => ({
    page, limit: 20,
    ...(status && { status }),
    ...(planId && { plan_id: planId }),
    ...(billingCycle && { billing_cycle: billingCycle }),
  }), [page, status, planId, billingCycle]);

  const { data, isLoading } = useQuery({
    queryKey: ['super-admin', 'subscriptions', params],
    queryFn: () => listSubscriptionsApi(params),
  });

  const rows = data?.items || [];
  const meta = data?.meta;

  const resetToPage1 = (setter) => (value) => { setter(value); setPage(1); };

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader title="Subscriptions" subtitle="Every company's subscription state, in one place." />

      <div className="flex flex-wrap gap-3">
        <Select value={status} onChange={(e) => resetToPage1(setStatus)(e.target.value)} placeholder="All statuses" className="w-48">
          {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
        </Select>
        <Select value={planId} onChange={(e) => resetToPage1(setPlanId)(e.target.value)} placeholder="All plans" className="w-48">
          {plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </Select>
        <Select value={billingCycle} onChange={(e) => resetToPage1(setBillingCycle)(e.target.value)} placeholder="All cycles" className="w-40">
          {CYCLE_OPTIONS.map((c) => <option key={c} value={c}>{c}</option>)}
        </Select>
      </div>

      <Card>
        <CardHeader title="All subscriptions" subtitle={meta ? `${meta.total} total` : ''} />
        <div className="overflow-x-auto px-5 pb-5">
          {isLoading ? (
            <Skeleton className="h-64 w-full rounded-xl" />
          ) : rows.length === 0 ? (
            <EmptyState title="No subscriptions" message="No subscriptions match these filters." className="py-12" />
          ) : (
            <>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left">
                    {['Company', 'Plan', 'Cycle', 'Seats', 'Status', 'Next renewal', 'MRR'].map((h) => (
                      <th key={h} className="py-2.5 pr-3 font-semibold text-fg-subtle text-xs uppercase tracking-wide">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((s) => (
                    <tr
                      key={s.id}
                      onClick={() => navigate(`/super-admin/subscriptions/${s.id}`)}
                      className="border-b border-border/60 cursor-pointer hover:bg-muted/40"
                    >
                      <td className="py-3 pr-3 font-medium text-fg">{s.companies?.name}</td>
                      <td className="py-3 pr-3 text-fg-muted">{s.plans?.name}</td>
                      <td className="py-3 pr-3 text-fg-muted capitalize">{s.billingCycle}</td>
                      <td className="py-3 pr-3 text-fg-muted tabular-nums">{s.seatCount}</td>
                      <td className="py-3 pr-3"><StatusBadge status={s.status} /></td>
                      <td className="py-3 pr-3 text-fg-subtle text-xs">{s.nextRenewalDate ? formatDate(s.nextRenewalDate) : '—'}</td>
                      <td className="py-3 pr-3 text-fg-muted tabular-nums">{formatCurrency(s.mrr)}</td>
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
