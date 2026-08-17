/** @type {import('tailwindcss').Config} */

// Helper so CSS-variable colors still support Tailwind opacity modifiers
// e.g. bg-primary/10, text-fg-muted, etc.
function withOpacity(variable) {
  return ({ opacityValue }) =>
    opacityValue === undefined
      ? `rgb(var(${variable}))`
      : `rgb(var(${variable}) / ${opacityValue})`;
}

export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: withOpacity('--color-primary'),
          light: withOpacity('--color-primary-light'),
          dark: withOpacity('--color-primary-dark'),
        },
        page: withOpacity('--color-page'),
        card: withOpacity('--color-card'),
        sidebar: withOpacity('--color-sidebar'),
        muted: withOpacity('--color-muted'),
        border: withOpacity('--color-border'),
        fg: {
          DEFAULT: withOpacity('--color-text-primary'),
          muted: withOpacity('--color-text-secondary'),
          subtle: withOpacity('--color-text-muted'),
        },
        success: '#22C55E',
        danger: '#EF4444',
        warning: '#F59E0B',
        info: '#3B82F6',
        teal: '#14B8A6',
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      fontSize: {
        kpi: ['28px', { lineHeight: '34px', fontWeight: '600' }],
        'page-title': ['24px', { lineHeight: '30px', fontWeight: '600' }],
      },
      borderRadius: {
        card: '16px',
        input: '10px',
        pill: '999px',
      },
      boxShadow: {
        card: '0 2px 12px rgba(108,99,255,0.08)',
        'card-hover': '0 6px 20px rgba(108,99,255,0.14)',
        drawer: '-8px 0 30px rgba(30,27,75,0.12)',
      },
      keyframes: {
        'fade-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        'slide-in-right': {
          '0%': { transform: 'translateX(100%)' },
          '100%': { transform: 'translateX(0)' },
        },
        'scale-in': {
          '0%': { opacity: '0', transform: 'scale(0.96)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        'flyout-in': {
          '0%': { opacity: '0', transform: 'translateX(-8px)' },
          '100%': { opacity: '1', transform: 'translateX(0)' },
        },
        shimmer: {
          '100%': { transform: 'translateX(100%)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 0.1s ease-out',
        'slide-in-right': 'slide-in-right 0.2s ease-out',
        'scale-in': 'scale-in 0.12s ease-out',
        'flyout-in': 'flyout-in 0.12s ease-out',
      },
    },
  },
  plugins: [],
};
