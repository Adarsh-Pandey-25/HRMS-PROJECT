import { Check } from 'lucide-react';
import { SITE } from '../siteConfig';
import { applyGST } from '../../lib/gst';
import { formatInr } from '../lib/format';
import { PLAN_FEATURE_LABELS, CORE_INCLUDED } from '../data/features';
import { usePlans } from '../lib/plans';
import { TrialButton, ButtonLink } from './ui';

const gstPercent = `${Math.round(SITE.gstRate * 100)}%`;

const seatLine = (plan) => {
  const parts = [];
  if (plan.includedSeats) parts.push(`${plan.includedSeats} employees included`);
  if (plan.pricePerSeatMonthly) parts.push(`${formatInr(plan.pricePerSeatMonthly)} per extra employee / month`);
  if (plan.maxSeats) parts.push(`up to ${plan.maxSeats} employees`);
  return parts;
};

function PlanCard({ plan, featured }) {
  const price = applyGST(plan.priceMonthly, plan.gstRate ?? SITE.gstRate);
  const enabled = new Set(plan.features || []);
  const planFeatures = Object.entries(PLAN_FEATURE_LABELS).filter(([key]) => enabled.has(key)).map(([, label]) => label);
  return (
    <div className={`relative flex flex-col rounded-2xl border bg-white p-6 sm:p-7 ${featured ? 'border-brand-600 shadow-card-hover ring-1 ring-brand-600' : 'border-slate-200 shadow-card'}`}>
      {featured && <span className="absolute -top-3 left-6 rounded-full bg-brand-700 px-3 py-1 text-xs font-semibold text-white">Recommended</span>}
      <h3 className="text-lg font-semibold text-ink">{plan.name}</h3>
      {plan.description && <p className="mt-1 text-sm text-slate-600">{plan.description}</p>}
      <div className="mt-5">
        <p className="flex items-baseline gap-1">
          <span className="text-4xl font-semibold tracking-tight text-ink">{formatInr(price.base)}</span>
          <span className="text-sm text-slate-500">/ month</span>
        </p>
        <p className="mt-1 text-sm text-slate-500">+ {gstPercent} GST applicable</p>
        <p className="mt-0.5 text-sm font-medium text-slate-700">Total: {formatInr(price.total)} / month incl. GST</p>
      </div>
      <ul className="mt-5 space-y-1 text-sm text-slate-700">
        {seatLine(plan).map((line) => <li key={line}>{line}</li>)}
      </ul>
      <ul className="mt-5 space-y-2.5 border-t border-slate-100 pt-5 text-sm text-slate-700">
        {[...CORE_INCLUDED, ...planFeatures].map((f) => (
          <li key={f} className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" aria-hidden="true" />{f}</li>
        ))}
      </ul>
      <div className="mt-auto pt-7">
        <TrialButton variant={featured ? 'primary' : 'outline'} label="Start free trial" className="w-full" />
        <p className="mt-2 text-center text-xs text-slate-500">{SITE.trial.length} free · no card required</p>
      </div>
    </div>
  );
}

export function PricingCards({ limit = 3 }) {
  const { plans, status } = usePlans();
  const shown = plans.filter((p) => Number(p.priceMonthly) > 0).slice(0, limit);

  if (!shown.length) {
    return (
      <div className="mx-auto max-w-lg rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-card">
        <p className="text-slate-700">{status === 'loading' ? 'Loading plans…' : 'Plans are being updated. Write to us for current pricing.'}</p>
        {status !== 'loading' && <ButtonLink href={`mailto:${SITE.salesEmail}?subject=Pricing`} variant="outline" className="mt-4">Email {SITE.salesEmail}</ButtonLink>}
      </div>
    );
  }

  const featuredIndex = shown.length >= 3 ? 1 : -1;
  return (
    <div className={`grid gap-6 ${shown.length >= 3 ? 'lg:grid-cols-3' : 'md:grid-cols-2 max-w-4xl mx-auto'}`}>
      {shown.map((plan, i) => <PlanCard key={plan.code} plan={plan} featured={i === featuredIndex} />)}
    </div>
  );
}

export function PricingNotes() {
  return (
    <div className="mt-8 text-center text-sm text-slate-600 space-y-1">
      <p>All prices exclusive of GST. {gstPercent} GST applicable as per Indian tax law.</p>
      <p>Billed monthly, quarterly or annually. Cancel anytime.</p>
    </div>
  );
}
