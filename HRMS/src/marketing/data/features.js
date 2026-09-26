import {
  Fingerprint, CalendarDays, IndianRupee, Users, Briefcase, GraduationCap,
  LifeBuoy, ShieldCheck, Building2, Plug, UserRound, FileText, Laptop, Target,
} from 'lucide-react';

/** Home-page grid: the core modules, each verified against a backend route. */
export const CORE_FEATURES = [
  { icon: Fingerprint, title: 'Smart attendance', text: 'Office-IP, biometric (ADMS) and GPS-geofence check-in, with shifts and late marks.' },
  { icon: CalendarDays, title: 'Leave management', text: 'Custom leave types, live balances and manager / HR approvals.' },
  { icon: IndianRupee, title: 'Payroll processing', text: 'Monthly auto-drafted runs, loss-of-pay from attendance, PDF payslips.' },
  { icon: UserRound, title: 'Employee self-service', text: 'Employees check in, apply for leave and download payslips themselves.' },
  { icon: FileText, title: 'Document management', text: 'Upload and organise employee documents in one secure place.' },
  { icon: GraduationCap, title: 'Training & courses', text: 'Video courses, enrolments and progress tracking.' },
  { icon: LifeBuoy, title: 'Helpdesk', text: 'Employees raise tickets, HR resolves them, with a knowledge base.' },
  { icon: Laptop, title: 'Asset management', text: 'Assign, track and recover company laptops, phones and more.' },
  { icon: Target, title: 'Performance tracking', text: 'Goals, review cycles and career events for every employee.' },
  { icon: Briefcase, title: 'Recruitment pipeline', text: 'Job openings, candidates, interviews and offer letters.' },
  { icon: Building2, title: 'Your own workspace', text: 'Each company is isolated at yourcompany.spaxsync.com, with its own logo.' },
  { icon: Plug, title: 'API & webhooks', text: 'Scoped API keys and signed webhooks for your other systems.' },
];

/**
 * Feature copy for the marketing site. Every item is a real module in this
 * codebase — check before adding anything. Not listed on purpose: selfie
 * check-in (a setting only, no capture), salary revisions (UI mock, no
 * backend), employee 2FA (no enrolment screen yet), installable app (PWA
 * removed).
 */
export const FEATURE_GROUPS = [
  {
    id: 'attendance',
    icon: Fingerprint,
    title: 'Attendance',
    summary: 'Check-ins that match how your offices actually work.',
    points: [
      'Web check-in restricted to your office IP ranges, GPS geofences, or both',
      'Biometric devices using the eSSL / ADMS push protocol, mapped to employees',
      'Shifts, late marks and short-hour detection with daily anomaly alerts',
      'Regularization requests and work-from-home approvals',
      'Automatic check-out for anyone who forgets to punch out',
    ],
  },
  {
    id: 'leave',
    icon: CalendarDays,
    title: 'Leave',
    summary: 'Policies your team can see and managers can approve in a click.',
    points: [
      'Custom leave types with yearly allocations and live balances',
      'Manager and HR approval flow with email notifications',
      'Company holiday calendar',
      'Low-balance reminders for employees',
    ],
  },
  {
    id: 'payroll',
    icon: IndianRupee,
    title: 'Payroll',
    summary: 'Payroll built around Indian rules, driven by real attendance.',
    points: [
      'Monthly payroll runs and a salary sheet for review',
      'Loss-of-pay calculated from attendance and unpaid leave',
      'State-wise professional tax',
      'Payslips as PDF, published to each employee',
    ],
  },
  {
    id: 'people',
    icon: Users,
    title: 'People',
    summary: 'One source of truth for every employee record.',
    points: [
      'Employee directory with profiles, documents and career history',
      'Bulk import from a spreadsheet when you move to SpaxSync',
      'Self-service onboarding: new joiners fill in their own details',
      'Onboarding checklists, birthday and work-anniversary wishes',
    ],
  },
  {
    id: 'hiring',
    icon: Briefcase,
    title: 'Hiring',
    summary: 'From job opening to offer letter.',
    points: [
      'Job openings and a candidate pipeline',
      'Interview scheduling',
      'Offer letters and acceptance tracking',
    ],
  },
  {
    id: 'growth',
    icon: GraduationCap,
    title: 'Performance & training',
    summary: 'Goals, reviews and learning in the same place.',
    points: [
      'Goals and review cycles with manager reviews',
      'Course catalogue with video lessons and progress tracking',
      'Enrolments and assignments for teams',
    ],
  },
  {
    id: 'operations',
    icon: LifeBuoy,
    title: 'Everyday operations',
    summary: 'The requests that usually live in email and spreadsheets.',
    points: [
      'Expense claims with approvals',
      'Asset inventory and asset requests',
      'Helpdesk tickets and a knowledge base',
      'Company announcements',
    ],
  },
  {
    id: 'platform',
    icon: Building2,
    title: 'Multi-company',
    summary: 'Run a group of companies without mixing their data.',
    points: [
      'Your own workspace address — yourcompany.spaxsync.com',
      'Subsidiaries as separate workspaces under one parent',
      'Separate sign-in pages for employees, HR and admins',
    ],
  },
  {
    id: 'security',
    icon: ShieldCheck,
    title: 'Control & audit',
    summary: 'See who changed what, and limit who can.',
    points: [
      'Role-based access for admins, HR, managers and employees',
      'Audit log of sensitive actions, tamper-evident',
      'Reports and exports for attendance, leave and payroll',
    ],
  },
  {
    id: 'integrations',
    icon: Plug,
    title: 'Integrations',
    summary: 'Connect SpaxSync to the rest of your stack.',
    points: [
      'API keys with scoped access',
      'Signed webhooks for events like new employees and leave approvals',
    ],
  },
];

/**
 * Plan feature keys (subscription_plans.features) → labels on pricing cards,
 * in display order. Mirrors backend/src/config/featureRegistry.js; keys not
 * listed here (e.g. coming-soon ones) are never shown.
 */
export const PLAN_FEATURE_LABELS = {
  web_checkin: 'Web check-in',
  ip_based_web: 'Office-IP check-in',
  gps_geofence: 'GPS geofencing',
  biometric_adms: 'Biometric devices (ADMS)',
  helpdesk: 'Helpdesk',
  assets: 'Asset management',
  training: 'Training & courses',
  recruitment: 'Recruitment pipeline',
  payroll: 'Payroll & payslips',
  advanced_reports: 'Advanced reports',
  api_access: 'API & webhooks',
};

/** Included on every plan (modules with no plan feature flag). */
export const CORE_INCLUDED = [
  'Leave, holidays and approvals',
  'Employee records, documents & self-service',
  'Performance goals & reviews',
  'Your own workspace address',
];
