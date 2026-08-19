import { useUIStore } from '../store/uiStore';

/** Shared ApexCharts palette — mirrors CHART_COLORS but tuned for the premium
 *  gradient/3D-style charts. */
export const CHART_PALETTE = [
  '#2563EB',
  '#14B8A6',
  '#F59E0B',
  '#EF4444',
  '#22C55E',
  '#38BDF8',
  '#EC4899',
  '#3B82F6',
  '#8B5CF6',
];

/**
 * Returns the theme-aware fragments every ApexChart in the app shares. Reads
 * `isDark` from the UI store so charts re-render into the dark palette when the
 * user toggles the theme. Spread the returned pieces into each chart's options.
 */
export function useApexTheme() {
  const isDark = useUIStore((s) => s.isDark);

  return {
    isDark,
    mode: isDark ? 'dark' : 'light',
    foreColor: isDark ? '#9CA3AF' : '#6B7280',
    gridBorder: isDark ? '#374151' : '#F3F4F6',
    axisLabel: isDark ? '#9CA3AF' : '#9CA3AF',
    tooltipTheme: isDark ? 'dark' : 'light',
    /** Stroke colour separating donut/pie segments — matches the card surface. */
    cardStroke: isDark ? '#1F2937' : '#FFFFFF',
    /** Base chart config shared by every chart (animations, shadow, fonts). */
    baseChart: {
      fontFamily: 'Inter, sans-serif',
      background: 'transparent',
      foreColor: isDark ? '#9CA3AF' : '#6B7280',
      toolbar: { show: false },
      animations: {
        enabled: true,
        easing: 'easeinout',
        speed: 800,
        animateGradually: { enabled: true, delay: 100 },
        dynamicAnimation: { enabled: true, speed: 400 },
      },
      dropShadow: {
        enabled: true,
        top: 4,
        left: 0,
        blur: 10,
        color: '#6C63FF',
        opacity: isDark ? 0.35 : 0.15,
      },
    },
  };
}
