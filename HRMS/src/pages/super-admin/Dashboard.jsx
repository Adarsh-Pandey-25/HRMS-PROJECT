import { useQuery } from '@tanstack/react-query';
import ReactApexChart from 'react-apexcharts';
import { useNavigate } from 'react-router-dom';
import {
  Building2, Users, IndianRupee, TrendingUp, TrendingDown, AlertTriangle, Link2, PlusCircle, ListChecks,
} from 'lucide-react';
import { Card, CardHeader, StatCard, PageHeader, Skeleton, Button, Badge } from '../../components/ui';
import { useApexTheme, CHART_PALETTE } from '../../lib/apexTheme';
import { formatCurrency, formatCompactINR } from '../../lib/utils';
import { getDashboardSummaryApi, getDashboardGrowthApi, getAttentionFeedApi } from '../../api/superAdmin.api';

const URGENCY_TONE = { high: 'danger', medium: 'warning', low: 'info' };

export default function SuperAdminDashboard() {
  const navigate = useNavigate();
  const t = useApexTheme();

  const { data: summary, isLoading: summaryLoading } = useQuery({
    queryKey: ['super-admin', 'dashboard', 'summary'],
    queryFn: getDashboardSummaryApi,
  });
  const { data: growth, isLoading: growthLoading } = useQuery({
    queryKey: ['super-admin', 'dashboard', 'growth'],
    queryFn: () => getDashboardGrowthApi('6m'),
  });
  const { data: attentionFeed = [], isLoading: feedLoading } = useQuery({
    queryKey: ['super-admin', 'dashboard', 'attention-feed'],
    queryFn: () => getAttentionFeedApi(20),
  });

  const signups = growth?.signups || [];
  const revenue = growth?.revenue || [];

  const chartOptions = {
    chart: { ...t.baseChart, height: 300, toolbar: { show: false } },
    colors: [CHART_PALETTE[0], CHART_PALETTE[1]],
    stroke: { curve: 'smooth', width: [0, 2.5] },
    dataLabels: { enabled: false },
    xaxis: { categories: signups.map((r) => r.month), labels: { style: { colors: t.axisLabel } } },
    yaxis: [
      { title: { text: 'Signups', style: { color: t.axisLabel } }, labels: { style: { colors: t.axisLabel } } },
      { opposite: true, title: { text: 'MRR', style: { color: t.axisLabel } }, labels: { formatter: (v) => formatCompactINR(v), style: { colors: t.axisLabel } } },
    ],
    grid: { borderColor: t.gridBorder },
    tooltip: { theme: t.tooltipTheme, y: { formatter: (v, opts) => (opts.seriesIndex === 1 ? formatCurrency(v) : v) } },
    legend: { labels: { colors: t.axisLabel } },
  };
  const chartSeries = [
    { name: 'Signups', type: 'column', data: signups.map((r) => r.count) },
    { name: 'MRR', type: 'line', data: revenue.map((r) => r.mrr) },
  ];

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Dashboard"
        subtitle="Platform-wide overview across every company."
        actions={(
          <div className="flex gap-2">
            <Button variant="outline" icon={Link2} onClick={() => navigate('/super-admin/invites')}>Generate Invite</Button>
            <Button icon={Building2} onClick={() => navigate('/super-admin/companies')}>View All Companies</Button>
          </div>
        )}
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-6 gap-4">
        {summaryLoading ? (
          Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-card" />)
        ) : (
          <>
            <StatCard label="Companies" value={summary?.totalCompanies ?? 0} icon={Building2} tone="primary" footer={`${summary?.activeCompanies ?? 0} active · ${summary?.inactiveCompanies ?? 0} inactive`} />
            <StatCard label="Employees" value={summary?.totalEmployees ?? 0} icon={Users} tone="info" />
            <StatCard label="MRR" value={formatCurrency(summary?.mrr || 0)} icon={IndianRupee} tone="success" />
            <StatCard label="ARR" value={formatCurrency(summary?.arr || 0)} icon={TrendingUp} tone="teal" />
            <StatCard label="Churn (30d)" value={`${((summary?.churnRate || 0) * 100).toFixed(1)}%`} icon={TrendingDown} tone="warning" />
            <StatCard
              label="Signups this month"
              value={summary?.signupsThisMonth ?? 0}
              icon={PlusCircle}
              tone="primary"
              delta={summary?.signupChangePct ?? undefined}
              deltaLabel="vs last month"
            />
          </>
        )}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <Card className="xl:col-span-2">
          <CardHeader title="Growth" subtitle="Signups and MRR, last 6 months" />
          <div className="px-5 pb-5">
            {growthLoading ? <Skeleton className="h-[300px] rounded-xl" /> : (
              <ReactApexChart options={chartOptions} series={chartSeries} type="line" height={300} />
            )}
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Needs attention"
            subtitle={feedLoading ? 'Loading…' : `${attentionFeed.length} item(s)`}
            action={<AlertTriangle className="h-4 w-4 text-warning" />}
          />
          <div className="px-5 pb-5 max-h-[320px] overflow-y-auto">
            {feedLoading ? (
              <Skeleton className="h-40 w-full rounded-xl" />
            ) : attentionFeed.length === 0 ? (
              <p className="text-sm text-fg-subtle py-8 text-center flex flex-col items-center gap-2">
                <ListChecks className="h-5 w-5 text-success" /> Nothing needs attention right now.
              </p>
            ) : (
              <div className="divide-y divide-border/60">
                {attentionFeed.map((item, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => item.link && navigate(item.link)}
                    className="w-full flex items-start justify-between gap-3 py-2.5 text-left hover:bg-muted/50 rounded-lg px-2 -mx-2"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-fg truncate">{item.companyName || 'Unknown company'}</p>
                      <p className="text-xs text-fg-subtle">{item.message}</p>
                    </div>
                    <Badge tone={URGENCY_TONE[item.urgency] || 'neutral'} className="shrink-0">{item.urgency}</Badge>
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
