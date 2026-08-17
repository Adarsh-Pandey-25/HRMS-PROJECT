import { memo } from 'react';
import ReactApexChart from 'react-apexcharts';
import { useApexTheme, CHART_PALETTE } from '../../lib/apexTheme';

/**
 * Enhanced 3D-style column chart with gradient fills and a purple drop shadow.
 * @param {string[]} categories - x-axis labels
 * @param {{name:string,data:number[]}[]} series - one or more bar series
 * @param {number} [height]
 * @param {(v:number)=>string} [tooltipFormatter]
 */
function AttendanceBarChart({ categories, series, height = 300, tooltipFormatter }) {
  const t = useApexTheme();
  const single = series.length === 1;

  const options = {
    chart: { ...t.baseChart, type: 'bar', height },
    theme: { mode: t.mode },
    plotOptions: {
      bar: {
        borderRadius: 8,
        borderRadiusApplication: 'end',
        columnWidth: single ? '52%' : '64%',
        dataLabels: { position: 'top' },
      },
    },
    dataLabels: {
      enabled: single,
      offsetY: -22,
      style: { fontSize: '12px', colors: ['#6C63FF'], fontWeight: 600 },
    },
    fill: single
      ? {
          type: 'gradient',
          gradient: {
            shade: 'light',
            type: 'vertical',
            shadeIntensity: 0.4,
            gradientToColors: ['#A78BFA'],
            inverseColors: false,
            opacityFrom: 1,
            opacityTo: 0.75,
            stops: [0, 90, 100],
          },
        }
      : { type: 'gradient', gradient: { shade: 'light', type: 'vertical', shadeIntensity: 0.35, opacityFrom: 1, opacityTo: 0.8 } },
    colors: single ? ['#6C63FF'] : CHART_PALETTE,
    xaxis: {
      categories,
      labels: { style: { fontSize: '12px', colors: t.axisLabel } },
      axisBorder: { show: false },
      axisTicks: { show: false },
    },
    yaxis: { labels: { style: { colors: t.axisLabel, fontSize: '12px' } } },
    grid: {
      borderColor: t.gridBorder,
      strokeDashArray: 4,
      yaxis: { lines: { show: true } },
      xaxis: { lines: { show: false } },
    },
    legend: { show: !single, position: 'top', horizontalAlign: 'right', fontSize: '13px', labels: { colors: t.foreColor } },
    tooltip: {
      theme: t.tooltipTheme,
      y: { formatter: tooltipFormatter || ((val) => `${val}`) },
    },
    states: {
      hover: { filter: { type: 'lighten', value: 0.15 } },
      active: { filter: { type: 'darken', value: 0.1 } },
    },
  };

  return <ReactApexChart type="bar" options={options} series={series} height={height} />;
}

export default memo(AttendanceBarChart);
