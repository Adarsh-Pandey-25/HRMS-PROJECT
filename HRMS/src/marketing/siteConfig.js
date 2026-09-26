/**
 * Every company fact the marketing site shows lives here. Empty strings
 * render nothing — fill the TODOs before launch.
 */
export const SITE = {
  name: 'SpaxSync',
  legalName: 'Spaxads Digital Media Pvt Ltd',
  url: 'https://spaxsync.com',
  tagline: 'HR, attendance and payroll for growing Indian companies',
  description:
    'SpaxSync is the HR platform for Indian companies: attendance with biometric, office-IP and GPS check-in, leave, payroll with loss-of-pay and professional tax, hiring, and a workspace for every company.',
  supportEmail: 'support@spaxsync.com',
  salesEmail: 'sales@spaxsync.com',
  // TODO(launch): public phone number, e.g. '+91 98xxxxxxxx'
  phone: '',
  // TODO(launch): registered office address as it appears on your incorporation documents
  address: '',
  // TODO(launch): Grievance Officer under the DPDP Act 2023 / IT Rules 2011
  grievanceOfficer: {
    name: '',
    email: 'support@spaxsync.com',
  },
  // What a new workspace gets: backend TRIAL_DAYS (default 7) on the plan
  // bootstrapTrialSubscription picks (backend/src/services/auth.service.js).
  trial: {
    days: 7,
    length: '7 days',
    plan: 'Starter',
  },
  // Prices from the API are exclusive of GST (backend/src/utils/gst.js).
  gstRate: 0.18,
  // TODO(launch): GST registration number of the legal entity. Shown in the footer once set.
  gstin: '',
  // TODO(launch): Calendly (or similar) booking link. Empty → "Book a demo" opens an email to salesEmail.
  demoUrl: '',
  // TODO(launch): number of live customer companies. 0 → the trust bar shows who SpaxSync is for, without a count.
  customerCount: 0,
  legalLastUpdated: '25 September 2026',
};

/** "Book a demo" target — the booking link when set, otherwise an email to sales. */
export const demoHref = () =>
  SITE.demoUrl || `mailto:${SITE.salesEmail}?subject=${encodeURIComponent('SpaxSync demo request')}`;

export const NAV_LINKS = [
  { to: '/features', label: 'Features' },
  { to: '/pricing', label: 'Pricing' },
  { to: '/about', label: 'About' },
  { to: '/contact', label: 'Contact' },
];

export const FOOTER_GROUPS = [
  {
    title: 'Product',
    links: [
      { to: '/features', label: 'Features' },
      { to: '/pricing', label: 'Pricing' },
      { to: '/security', label: 'Security' },
      { to: '/start-trial', label: 'Start free trial' },
    ],
  },
  {
    title: 'Company',
    links: [
      { to: '/about', label: 'About' },
      { to: '/contact', label: 'Contact' },
    ],
  },
  {
    title: 'Legal',
    links: [
      { to: '/privacy', label: 'Privacy policy' },
      { to: '/terms', label: 'Terms of service' },
      { to: '/refund-policy', label: 'Refund policy' },
    ],
  },
];
