import { useMemo, useState } from 'react';
import ReactApexChart from 'react-apexcharts';
import { ArrowLeft } from 'lucide-react';
import { subMonths, format, endOfMonth } from 'date-fns';
import { useApexTheme, CHART_PALETTE } from '../../lib/apexTheme';
import { useEmployees } from '../../hooks/useEmployees';

/**
 * Cumulative headcount (by join date) for the trailing 12 months, plus
 * each month's department composition — computed from the live employee
 * directory so totals and drilldowns stay in sync with the Directory.
 */
function useMonthlyHeadcount(employees) {
  return useMemo(() => {
    const now = new Date();
    return Array.from({ length: 12 }, (_, i) => subMonths(now, 11 - i)).map((d) => {
      const cutoff = format(endOfMonth(d), 'yyyy-MM-dd');
      const asOf = employees.filter((e) => {
        const joined = e.joinDate || e.dateOfJoining || e.date_of_joining;
        return joined && String(joined).slice(0, 10) <= cutoff;
      });
      const byDept = {};
      asOf.forEach((e) => {
        const dept = e.department || 'Unassigned';
        byDept[dept] = (byDept[dept] || 0) + 1;
      });
      return {
        key: format(d, 'yyyy-MM'),
        label: format(d, 'MMM'),
        fullLabel: format(d, 'MMMM yyyy'),
        count: asOf.length,
        departments: Object.entries(byDept)
          .map(([name, value]) => ({ name, value }))
          .sort((a, b) => b.value - a.value),
      };
    });
  }, [employees]);
}

/**
 * Headcount column chart with drilldown — click a month's bar to break it
 * down by department, with a back link to return to the 12-month overview.
 */
export default function HeadcountDrilldownChart() {
  const t = useApexTheme();
  const { employees } = useEmployees();
  const staff = useMemo(
    () => (employees || []).filter((e) => {
      const role = String(e.role || '').toLowerCase();
      return role !== 'admin' && role !== 'super_admin';
    }),
    [employees]
  );
  const months = useMonthlyHeadcount(staff);
  const [drillKey, setDrillKey] = useState(null);
  const drilled = drillKey ? months.find((m) => m.key === drillKey) : null;

  const categories = drilled ? drilled.departments.map((d) => d.name) : months.map((m) => m.label);
  const values = drilled ? drilled.departments.map((d) => d.value) : months.map((m) => m.count);
  const colors = drilled ? drilled.departments.map((_, i) => CHART_PALETTE[i % CHART_PALETTE.length]) : ['#6C63FF'];

  const options = {
    chart: {
      ...t.baseChart,
      type: 'bar',
      height: 320,
      events: {
        dataPointSelection: (_event, _ctx, config) => {
          if (drilled) return;
          const month = months[config.dataPointIndex];
          if (month) setDrillKey(month.key);
        },
      },
    },
    theme: { mode: t.mode },
    plotOptions: {
      bar: {
        borderRadius: 8,
        borderRadiusApplication: 'end',
        columnWidth: '52%',
        distributed: !!drilled,
        dataLabels: { position: 'top' },
      },
    },
    dataLabels: {
      enabled: true,
      offsetY: -22,
      style: { fontSize: '12px', colors: [t.isDark ? '#C7C2FF' : '#6C63FF'], fontWeight: 600 },
    },
    fill: {
      type: 'gradient',
      gradient: {
        shade: 'light', type: 'vertical', shadeIntensity: 0.4,
        gradientToColors: ['#A78BFA'], opacityFrom: 1, opacityTo: 0.75, stops: [0, 90, 100],
      },
    },
    colors,
    legend: { show: false },
    xaxis: {
      categories,
      labels: { style: { fontSize: '12px', colors: t.axisLabel }, rotate: drilled ? -25 : 0, trim: true },
      axisBorder: { show: false },
      axisTicks: { show: false },
    },
    yaxis: { labels: { style: { colors: t.axisLabel, fontSize: '12px' } }, forceNiceScale: true },
    grid: {
      borderColor: t.gridBorder,
      strokeDashArray: 4,
      yaxis: { lines: { show: true } },
      xaxis: { lines: { show: false } },
    },
    tooltip: {
      theme: t.tooltipTheme,
      y: { formatter: (v) => `${v} employee${v === 1 ? '' : 's'}` },
    },
    states: {
      hover: { filter: { type: 'lighten', value: 0.15 } },
      active: { filter: { type: 'darken', value: 0.1 } },
    },
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-2 min-h-[20px]">
        {drilled ? (
          <button
            type="button"
            onClick={() => setDrillKey(null)}
            className="flex items-center gap-1 text-xs font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> All months
          </button>
        ) : (
          <span className="text-xs text-fg-subtle">Click a month to see its department breakdown</span>
        )}
        {drilled && (
          <span className="text-xs font-medium text-fg">
            {drilled.fullLabel} · {drilled.count} employee{drilled.count === 1 ? '' : 's'}
          </span>
        )}
      </div>
      <ReactApexChart
        key={drilled ? 'drill' : 'overview'}
        type="bar"
        options={options}
        series={[{ name: drilled ? 'Employees' : 'Headcount', data: values }]}
        height={320}
      />
    </div>
  );
}
