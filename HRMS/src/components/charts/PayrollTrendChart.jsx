import { memo } from 'react';
import ReactApexChart from 'react-apexcharts';
import { useApexTheme } from '../../lib/apexTheme';

/**
 * Gradient area chart for monthly payroll cost, with a glowing smooth line and
 * animated entry. Y-axis renders compact INR (₹x.xL).
 * @param {string[]} months
 * @param {number[]} values
 * @param {(v:number)=>string} [tooltipFormatter]
 */
function PayrollTrendChart({ months, values, height = 280, tooltipFormatter }) {
  const t = useApexTheme();

  const options = {
    chart: { ...t.baseChart, type: 'area', height, zoom: { enabled: false } },
    theme: { mode: t.mode },
    stroke: { curve: 'smooth', width: 3, colors: ['#6C63FF'] },
    fill: {
      type: 'gradient',
      gradient: {
        shadeIntensity: 1,
        opacityFrom: 0.55,
        opacityTo: 0.02,
        stops: [0, 90, 100],
        colorStops: [
          { offset: 0, color: '#6C63FF', opacity: 0.55 },
          { offset: 100, color: '#6C63FF', opacity: 0.02 },
        ],
      },
    },
    markers: { size: 5, colors: ['#fff'], strokeColors: '#6C63FF', strokeWidth: 2.5, hover: { size: 8 } },
    dataLabels: { enabled: false },
    xaxis: {
      categories: months,
      axisBorder: { show: false },
      axisTicks: { show: false },
      labels: { style: { colors: t.axisLabel, fontSize: '12px' } },
    },
    yaxis: {
      labels: {
        formatter: (val) => `₹${(val / 100000).toFixed(1)}L`,
        style: { colors: t.axisLabel, fontSize: '12px' },
      },
    },
    grid: { borderColor: t.gridBorder, strokeDashArray: 4 },
    tooltip: {
      theme: t.tooltipTheme,
      y: { formatter: tooltipFormatter || ((val) => `₹${val.toLocaleString('en-IN')}`) },
      marker: { show: true },
    },
  };

  return (
    <ReactApexChart
      type="area"
      options={options}
      series={[{ name: 'Net Payroll', data: values }]}
      height={height}
    />
  );
}

export default memo(PayrollTrendChart);
