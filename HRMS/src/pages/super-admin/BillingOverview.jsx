import { useQuery } from '@tanstack/react-query';
import ReactApexChart from 'react-apexcharts';
import { useNavigate } from 'react-router-dom';
import { IndianRupee, TrendingUp, Users, Layers, AlertTriangle, Clock } from 'lucide-react';
import { Card, CardHeader, StatCard, PageHeader, Skeleton, StatusBadge } from '../../components/ui';
import { useApexTheme, CHART_PALETTE } from '../../lib/apexTheme';
import { formatCurrency, formatCompactINR, formatDate } from '../../lib/utils';
import {
  getRevenueSummaryApi, getRevenueTrendApi, getRevenueByPlanApi, getChurnApi, listExpiringSubscriptionsApi,
  getCohortRetentionApi,
} from '../../api/subscription.api';

export default function BillingOverview() {
  const navigate = useNavigate();
  const t = useApexTheme();

  const { data: summary, isLoading: summaryLoading } = useQuery({
    queryKey: ['super-admin', 'billing', 'summary'],
    queryFn: getRevenueSummaryApi,
  });
  const { data: trend = [], isLoading: trendLoading } = useQuery({
    queryKey: ['super-admin', 'billing', 'trend'],
    queryFn: () => getRevenueTrendApi('12m'),
  });
  const { data: byPlan = [], isLoading: byPlanLoading } = useQuery({
    queryKey: ['super-admin', 'billing', 'by-plan'],
    queryFn: getRevenueByPlanApi,
  });
  const { data: churnData } = useQuery({
    queryKey: ['super-admin', 'billing', 'churn'],
    queryFn: () => getChurnApi(30),
  });
  const { data: expiring = [] } = useQuery({
    queryKey: ['super-admin', 'billing', 'expiring'],
    queryFn: () => listExpiringSubscriptionsApi(30),
  });
  const { data: cohorts = [], isLoading: cohortsLoading } = useQuery({
    queryKey: ['super-admin', 'billing', 'cohorts'],
    queryFn: () => getCohortRetentionApi(12),
  });

  const trendOptions = {
    chart: { ...t.baseChart, type: 'area', height: 300, toolbar: { show: false } },
    colors: [CHART_PALETTE[0]],
    dataLabels: { enabled: false },
    stroke: { curve: 'smooth', width: 2.5 },
    fill: { type: 'gradient', gradient: { opacityFrom: 0.35, opacityTo: 0 } },
    xaxis: { categories: trend.map((r) => r.month), labels: { style: { colors: t.axisLabel } } },
    yaxis: { labels: { formatter: (v) => formatCompactINR(v), style: { colors: t.axisLabel } } },
    grid: { borderColor: t.gridBorder },
    tooltip: { theme: t.tooltipTheme, y: { formatter: (v) => formatCurrency(v) } },
  };
  const trendSeries = [{ name: 'MRR', data: trend.map((r) => r.mrr) }];

  const byPlanOptions = {
    chart: { ...t.baseChart, type: 'donut', height: 300 },
    labels: byPlan.map((p) => p.planName),
    colors: CHART_PALETTE,
    legend: { position: 'bottom', labels: { colors: t.axisLabel } },
    dataLabels: { enabled: false },
    stroke: { colors: [t.cardStroke] },
    tooltip: { theme: t.tooltipTheme, y: { formatter: (v) => formatCurrency(v) } },
  };
  const byPlanSeries = byPlan.map((p) => p.mrr);

  const cohortOptions = {
    chart: { ...t.baseChart, type: 'bar', height: 260, toolbar: { show: false } },
    colors: [CHART_PALETTE[2]],
    plotOptions: { bar: { borderRadius: 4, columnWidth: '50%' } },
    dataLabels: { enabled: false },
    xaxis: { categories: cohorts.map((c) => c.month), labels: { style: { colors: t.axisLabel } } },
    yaxis: { max: 100, labels: { formatter: (v) => `${v}%`, style: { colors: t.axisLabel } } },
    grid: { borderColor: t.gridBorder },
    tooltip: {
      theme: t.tooltipTheme,
      y: { formatter: (v, opts) => `${v}% (${cohorts[opts.dataPointIndex]?.stillActive}/${cohorts[opts.dataPointIndex]?.totalCompanies})` },
    },
  };
  const cohortSeries = [{ name: 'Still active', data: cohorts.map((c) => c.retentionPct) }];

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader title="Billing Overview" subtitle="Revenue, subscriptions, and renewals across every company." />

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {summaryLoading ? (
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-32 rounded-card" />)
        ) : (
          <>
            <StatCard label="Current MRR" value={formatCurrency(summary?.mrr || 0)} icon={IndianRupee} tone="primary" />
            <StatCard label="Current ARR" value={formatCurrency(summary?.arr || 0)} icon={TrendingUp} tone="success" />
            <StatCard label="Active Subscriptions" value={summary?.activeSubscriptions ?? 0} icon={Layers} tone="info" />
            <StatCard label="Total Seats Sold" value={summary?.totalSeatsSold ?? 0} icon={Users} tone="teal" />
          </>
        )}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <Card className="xl:col-span-2">
          <CardHeader title="MRR trend" subtitle="Last 12 months, from paid invoices" />
          <div className="px-5 pb-5">
            {trendLoading ? <Skeleton className="h-[300px] rounded-xl" /> : (
              <ReactApexChart options={trendOptions} series={trendSeries} type="area" height={300} />
            )}
          </div>
        </Card>
        <Card>
          <CardHeader title="Revenue by plan" />
          <div className="px-5 pb-5">
            {byPlanLoading ? <Skeleton className="h-[300px] rounded-xl" /> : byPlan.length === 0 ? (
              <p className="text-sm text-fg-subtle py-10 text-center">No active subscriptions yet.</p>
            ) : (
              <ReactApexChart options={byPlanOptions} series={byPlanSeries} type="donut" height={300} />
            )}
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader
            title="Expiring soon"
            subtitle={`${expiring.length} renewing in the next 30 days`}
            action={<Clock className="h-4 w-4 text-fg-subtle" />}
          />
          <div className="px-5 pb-5">
            {expiring.length === 0 ? (
              <p className="text-sm text-fg-subtle py-6 text-center">Nothing renewing soon.</p>
            ) : (
              <div className="divide-y divide-border/60">
                {expiring.slice(0, 8).map((s) => (
                  <button
                    key={s.id}
                    onClick={() => navigate(`/super-admin/subscriptions/${s.id}`)}
                    className="w-full flex items-center justify-between py-2.5 text-left hover:bg-muted/50 rounded-lg px-2 -mx-2"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-fg truncate">{s.companies?.name}</p>
                      <p className="text-xs text-fg-subtle">{s.plans?.name} · {s.seatCount} seats</p>
                    </div>
                    <span className="text-xs text-fg-muted shrink-0 ml-3">{formatDate(s.nextRenewalDate)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </Card>

        <Card>
          <CardHeader title="Cohort retention" subtitle="Signup month → % of companies still on a live subscription today" />
          <div className="px-5 pb-5">
            {cohortsLoading ? <Skeleton className="h-[260px] rounded-xl" /> : cohorts.length === 0 ? (
              <p className="text-sm text-fg-subtle py-10 text-center">Not enough data yet.</p>
            ) : (
              <ReactApexChart options={cohortOptions} series={cohortSeries} type="bar" height={260} />
            )}
          </div>
        </Card>

        <Card>
          <CardHeader
            title="At risk"
            subtitle={churnData ? `${churnData.atRisk.length} past due or in grace period · ${(churnData.churnRate * 100).toFixed(1)}% churn (30d)` : ''}
            action={<AlertTriangle className="h-4 w-4 text-warning" />}
          />
          <div className="px-5 pb-5">
            {!churnData || churnData.atRisk.length === 0 ? (
              <p className="text-sm text-fg-subtle py-6 text-center">No subscriptions at risk.</p>
            ) : (
              <div className="divide-y divide-border/60">
                {churnData.atRisk.slice(0, 8).map((s) => (
                  <button
                    key={s.id}
                    onClick={() => navigate(`/super-admin/subscriptions/${s.id}`)}
                    className="w-full flex items-center justify-between py-2.5 text-left hover:bg-muted/50 rounded-lg px-2 -mx-2"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-fg truncate">{s.companies?.name}</p>
                      <p className="text-xs text-fg-subtle">{s.plans?.name}</p>
                    </div>
                    <StatusBadge status={s.status} />
                  </button>
                ))}
              </div>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
