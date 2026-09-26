import { Check } from 'lucide-react';
import { FEATURE_GROUPS } from '../data/features';
import { Section, SectionHeading, TrialButton, DemoButton } from '../components/ui';

export default function Features() {
  return (
    <>
      <Section className="bg-slate-50">
        <SectionHeading
          eyebrow="Features"
          title="Everything your HR team runs on"
          subtitle="Attendance, leave, payroll, people, hiring and more — in one workspace for your company."
        />
        <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
          <TrialButton />
          <DemoButton />
        </div>
      </Section>
      <Section>
        <div className="grid gap-6 md:grid-cols-2">
          {FEATURE_GROUPS.map(({ id, icon: Icon, title, summary, points }) => (
            <article key={id} id={id} className="rounded-2xl border border-slate-200 p-6 sm:p-7">
              <div className="flex items-center gap-3">
                <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50 text-brand-700"><Icon className="h-5 w-5" aria-hidden="true" /></span>
                <h2 className="text-xl font-semibold text-ink">{title}</h2>
              </div>
              <p className="mt-3 text-slate-600">{summary}</p>
              <ul className="mt-4 space-y-2 text-sm text-slate-700">
                {points.map((p) => <li key={p} className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" aria-hidden="true" />{p}</li>)}
              </ul>
            </article>
          ))}
        </div>
      </Section>
    </>
  );
}
