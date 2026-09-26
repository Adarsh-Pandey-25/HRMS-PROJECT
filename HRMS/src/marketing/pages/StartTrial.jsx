import { Check } from 'lucide-react';
import { SITE } from '../siteConfig';
import { Section } from '../components/ui';
import { LeadForm } from '../components/LeadForm';

const POINTS = [
  `${SITE.trial.length} free on the ${SITE.trial.plan} plan`,
  'No credit card required',
  'Your own workspace address with separate employee, HR and admin sign-in',
  'Choose a plan when you’re ready — or let the trial end, nothing is charged',
];

export default function StartTrial() {
  return (
    <Section className="bg-slate-50">
      <div className="grid gap-12 lg:grid-cols-[1fr_1.2fr]">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wider text-brand-600">Free trial</p>
          <h1 className="mt-2 text-3xl sm:text-4xl font-semibold tracking-tight text-ink">Start your {SITE.trial.length} free trial</h1>
          <p className="mt-4 text-lg text-slate-600">
            Tell us about your company. We’ll email you an invite to create your workspace — setup takes a couple of minutes.
          </p>
          <ul className="mt-8 space-y-3 text-slate-700">
            {POINTS.map((p) => <li key={p} className="flex gap-2.5"><Check className="mt-0.5 h-5 w-5 shrink-0 text-brand-600" aria-hidden="true" />{p}</li>)}
          </ul>
        </div>
        <LeadForm type="trial" />
      </div>
    </Section>
  );
}
