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
        'on-primary': withOpacity('--color-on-primary'),
        accent: withOpacity('--color-accent'),
        ink: {
          DEFAULT: '#0B1220',
          950: '#0B1220',
          900: '#0F172A',
          800: '#1E293B',
          700: '#334155',
        },
        brand: {
          50: '#F0FDFA',
          100: '#CCFBF1',
          200: '#99F6E4',
          300: '#5EEAD4',
          400: '#2DD4BF',
          500: '#14B8A6',
          600: '#0D9488',
          700: '#0F766E',
          800: '#115E59',
          900: '#134E4A',
        },
        brass: {
          DEFAULT: '#D97706',
          fill: '#F59E0B',
          tint: '#FEF3C7',
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
        card: '0 1px 2px rgba(15,23,42,0.04), 0 4px 16px rgba(15,23,42,0.06)',
        'card-hover': '0 2px 4px rgba(15,23,42,0.06), 0 12px 28px rgba(15,23,42,0.10)',
        drawer: '-8px 0 30px rgba(11,18,32,0.14)',
        soft: '0 1px 2px rgba(15,23,42,0.05)',
      },
      keyframes: {
        'fade-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        'rise-in': {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
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
        'rise-in': 'rise-in 0.4s cubic-bezier(0.16, 1, 0.3, 1) both',
        'slide-in-right': 'slide-in-right 0.2s ease-out',
        'scale-in': 'scale-in 0.12s ease-out',
        'flyout-in': 'flyout-in 0.12s ease-out',
      },
    },
  },
  plugins: [],
};
