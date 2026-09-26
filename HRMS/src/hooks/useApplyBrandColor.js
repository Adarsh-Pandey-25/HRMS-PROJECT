import { useEffect } from 'react';
import { useCompanyStore } from '../store/companyStore';
import { useUIStore } from '../store/uiStore';

function hexToHsl(hex) {
  const match = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || '');
  if (!match) return null;
  const r = parseInt(match[1], 16) / 255;
  const g = parseInt(match[2], 16) / 255;
  const b = parseInt(match[3], 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
    else if (max === g) h = ((b - r) / d + 2) * 60;
    else h = ((r - g) / d + 4) * 60;
  }
  return { h, s, l };
}

function hslToChannels(h, s, l) {
  s = Math.min(1, Math.max(0, s));
  l = Math.min(1, Math.max(0, l));
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let [r, g, b] = [0, 0, 0];
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return [r, g, b].map((v) => Math.round((v + m) * 255)).join(' ');
}

// Applies the company's brand color as the app's --color-primary (and derived
// light/dark tint shades) live, so the sidebar/topbar/buttons re-tint as soon as
// the picker changes — no reload needed. Shades are derived via HSL lightness
// adjustment (rather than naive RGB mixing) so arbitrary hues stay saturated
// instead of drifting toward gray, and are recomputed per light/dark theme since
// each theme wants different lightness targets for its light/dark tint shade.
export const DEFAULT_BRAND_COLOR = '#0F766E';
/** The pre-launch purple default. Companies that never picked a colour still
 *  have it saved, so it is treated as "no choice" and gets the new default. */
const LEGACY_DEFAULT_BRAND_COLOR = '#6C63FF';

export const effectiveBrandColor = (color) => {
  const c = String(color || '').trim();
  if (!c || c.toUpperCase() === LEGACY_DEFAULT_BRAND_COLOR) return DEFAULT_BRAND_COLOR;
  return c;
};

/** Relative luminance of "r g b" channels (WCAG formula). */
const channelsLuminance = (channels) => {
  const [r, g, b] = channels.split(' ').map((v) => {
    const c = Number(v) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

export function useApplyBrandColor() {
  const brandColor = useCompanyStore((s) => effectiveBrandColor(s.company.brandColor));
  const isDark = useUIStore((s) => s.isDark);

  useEffect(() => {
    const hsl = hexToHsl(brandColor);
    if (!hsl) return;
    const { h, s } = hsl;
    const root = document.documentElement.style;

    let primary;
    if (isDark) {
      primary = hslToChannels(h, s, Math.min(0.78, hsl.l + 0.3));
      root.setProperty('--color-primary', primary);
      root.setProperty('--color-primary-light', hslToChannels(h, s * 0.6, 0.16));
      root.setProperty('--color-primary-dark', hslToChannels(h, s, Math.min(0.85, hsl.l + 0.4)));
    } else {
      primary = hslToChannels(h, s, hsl.l);
      root.setProperty('--color-primary', primary);
      root.setProperty('--color-primary-light', hslToChannels(h, s * 0.5, 0.96));
      root.setProperty('--color-primary-dark', hslToChannels(h, s, hsl.l * 0.8));
    }
    // Text on solid primary fills: white on dark brand colours, deep ink on
    // light ones, so any company-chosen colour stays readable.
    root.setProperty('--color-on-primary', channelsLuminance(primary) > 0.4 ? '11 18 32' : '255 255 255');
  }, [brandColor, isDark]);
}
