import { SITE } from '../siteConfig';

const gstPercent = `${Math.round(SITE.gstRate * 100)}%`;

/**
 * FAQ — rendered on the home and pricing pages and emitted as FAQPage
 * structured data. Answers must match how the product actually behaves:
 * the trial runs on the Starter plan, and sign-in pauses (data kept) when a
 * trial ends without a plan (backend subscriptionBilling.cron.js).
 */
export const HOME_FAQ = [
  {
    q: 'Is there a free trial?',
    a: `Yes — ${SITE.trial.length} free, no credit card required. Your workspace runs on the ${SITE.trial.plan} plan during the trial, and you can move to any plan when you subscribe.`,
  },
  {
    q: 'How is pricing calculated?',
    a: `Each plan has a monthly price that includes a set number of seats (active employees), with extra seats charged per seat. Prices shown are exclusive of GST; ${gstPercent} GST is added on your invoice as per Indian law.`,
  },
  {
    q: 'What counts as a “seat”?',
    a: 'Each active employee in your account counts as one seat. Deactivated or offboarded employees do not count.',
  },
  {
    q: 'Is our data secure?',
    a: 'Yes. Every company’s data is isolated in its own workspace, access is controlled by role, and sensitive actions are recorded in an audit log. Data is encrypted in transit and at rest with our database provider. We never share your employee data.',
  },
  {
    q: 'Can we integrate with our biometric device?',
    a: 'Yes. Devices that support the eSSL / ZKTeco ADMS push protocol send punches straight to SpaxSync, and office-IP and GPS check-in work in the browser without any hardware.',
  },
  {
    q: 'What happens after the trial ends?',
    a: 'You’ll be asked to choose a plan. Until you do, sign-in to your workspace is paused — your data is kept safe and nothing is deleted.',
  },
];

export const PRICING_FAQ = [
  ...HOME_FAQ,
  {
    q: 'Can I switch plans later?',
    a: 'Yes. When you change plans, the price difference for the rest of your current billing period is prorated.',
  },
  {
    q: 'Can I cancel?',
    a: 'Yes, cancel anytime from Subscription & Billing in your workspace. Your plan stays active until the end of the period you’ve paid for.',
  },
  {
    q: 'Do I get my own login page?',
    a: 'Yes. Every company gets its own workspace address, like yourcompany.spaxsync.com, with separate sign-in pages for employees, HR and admins.',
  },
  {
    q: 'What currency are prices in?',
    a: `All prices are in Indian rupees, exclusive of GST. For billing or invoice questions, write to ${SITE.salesEmail}.`,
  },
];
