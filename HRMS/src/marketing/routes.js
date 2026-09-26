import { SITE } from './siteConfig';

/**
 * Every pre-rendered marketing page. scripts/prerender.mjs writes one
 * dist/_marketing/<path>/index.html per entry and lists them in sitemap.xml;
 * main.jsx uses isMarketingPath() to decide which app boots on the apex.
 */
export const MARKETING_ROUTES = [
  {
    path: '/',
    title: `${SITE.name} — HRMS for Indian Businesses`,
    description: 'The HRMS built for modern Indian businesses: attendance with biometric, office-IP and GPS check-in, leave, payroll with LOP, documents and more. Start a 7-day free trial.',
    priority: '1.0',
  },
  {
    path: '/features',
    title: `Features — ${SITE.name}`,
    description: 'Attendance, leave, payroll, employee records, hiring, performance, training, helpdesk, assets and an API — every module in SpaxSync.',
    priority: '0.9',
  },
  {
    path: '/pricing',
    title: `Pricing — ${SITE.name}`,
    description: 'Simple per-company plans in Indian rupees with included seats. Prices exclusive of 18% GST. 7-day free trial, no credit card.',
    priority: '0.9',
  },
  {
    path: '/about',
    title: `About — ${SITE.name}`,
    description: `${SITE.name} is built by ${SITE.legalName} for Indian companies that have outgrown spreadsheets.`,
    priority: '0.5',
  },
  {
    path: '/contact',
    title: `Contact — ${SITE.name}`,
    description: 'Talk to the SpaxSync team about pricing, a demo, or moving your company to SpaxSync.',
    priority: '0.6',
  },
  {
    path: '/start-trial',
    title: `Start your free trial — ${SITE.name}`,
    description: 'Request a 7-day free trial of SpaxSync for your company. No credit card required.',
    priority: '0.8',
  },
  {
    path: '/security',
    title: `Security — ${SITE.name}`,
    description: 'How SpaxSync keeps each company’s HR data isolated, access-controlled and audited.',
    priority: '0.5',
  },
  { path: '/privacy', title: `Privacy policy — ${SITE.name}`, description: `How ${SITE.legalName} collects, uses and protects personal data.`, priority: '0.3' },
  { path: '/terms', title: `Terms of service — ${SITE.name}`, description: `The terms for using ${SITE.name}.`, priority: '0.3' },
  { path: '/refund-policy', title: `Refund & cancellation policy — ${SITE.name}`, description: `Cancellation and refund terms for ${SITE.name} subscriptions.`, priority: '0.3' },
];

export const NOT_FOUND_ROUTE = {
  path: '/404',
  title: `Page not found — ${SITE.name}`,
  description: SITE.description,
  noindex: true,
};

const normalize = (pathname) => (pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname) || '/';

export const findMarketingRoute = (pathname) => MARKETING_ROUTES.find((r) => r.path === normalize(pathname)) || null;

/** Paths on the apex that belong to the HRMS app bundle, not the marketing site. */
const APP_PREFIXES = ['/super-admin', '/onboarding'];

export const isMarketingPath = (pathname) => !APP_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
