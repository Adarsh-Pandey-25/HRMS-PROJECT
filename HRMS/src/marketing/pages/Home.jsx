import { Rocket, Store, Building, Briefcase, Factory, Users } from 'lucide-react';
import { SITE } from '../siteConfig';
import { CORE_FEATURES } from '../data/features';
import { HOME_FAQ } from '../data/faq';
import { Section, SectionHeading, Container, TrialButton, DemoButton, ButtonLink } from '../components/ui';
import { DashboardMockup } from '../components/DashboardMockup';
import { PricingCards, PricingNotes } from '../components/PricingCards';
import { Faq } from '../components/Faq';

const AUDIENCES = [
  { icon: Rocket, label: 'Startups' },
  { icon: Store, label: 'Small businesses' },
  { icon: Briefcase, label: 'Agencies' },
  { icon: Factory, label: 'Factories & field teams' },
  { icon: Building, label: 'Multi-company groups' },
];

const STEPS = [
  { title: 'Create your company account', text: 'Takes about 2 minutes. You get your own workspace address and admin login.' },
  { title: 'Add your team', text: 'HR adds employees one by one or imports a spreadsheet — each person gets an onboarding email.' },
  { title: 'Go live', text: 'Employees check in, request leave and get their payslips. HR approves from one dashboard.' },
];

export default function Home() {
  return (
    <>
      {/* 1 — Hero */}
      <section className="relative overflow-hidden bg-ink">
        <div className="absolute inset-0 bg-[radial-gradient(60rem_30rem_at_80%_-10%,rgba(45,212,191,0.18),transparent)]" aria-hidden="true" />
        <Container className="relative grid items-center gap-14 py-16 sm:py-24 lg:grid-cols-[1.05fr_1fr]">
          <div>
            <p className="inline-flex items-center gap-2 rounded-full border border-white/15 px-3 py-1 text-xs font-medium text-brand-300">
              <span className="h-1.5 w-1.5 rounded-full bg-brass-fill" /> Made for India — INR pricing, LOP & professional tax
            </p>
            <h1 className="mt-5 text-4xl font-semibold leading-[1.1] tracking-tight text-white sm:text-5xl lg:text-[3.4rem]">
              The HRMS built for modern Indian businesses
            </h1>
            <p className="mt-5 max-w-xl text-lg leading-relaxed text-slate-300">
              Manage your team from hire to retire — attendance, payroll, leaves, documents and more. All in one place.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <TrialButton variant="bright" size="lg" />
              <DemoButton variant="ghostLight" size="lg" />
            </div>
            <p className="mt-3 text-sm text-slate-400">No credit card required.</p>
          </div>
          <DashboardMockup />
        </Container>
      </section>

      {/* 2 — Trust bar */}
      <section className="border-b border-slate-200 bg-white">
        <Container className="py-8">
          <p className="text-center text-sm font-medium text-slate-500">
            {SITE.customerCount > 0 ? `Trusted by ${SITE.customerCount}+ companies across India` : 'Built for growing teams across India'}
          </p>
          <ul className="mt-5 flex flex-wrap items-center justify-center gap-x-8 gap-y-4">
            {AUDIENCES.map(({ icon: Icon, label }) => (
              <li key={label} className="flex items-center gap-2 text-sm font-medium text-slate-700">
                <Icon className="h-5 w-5 text-brand-600" aria-hidden="true" />{label}
              </li>
            ))}
          </ul>
        </Container>
      </section>

      {/* 3 — Core features */}
      <Section id="features" className="bg-slate-50">
        <SectionHeading eyebrow="Everything in one place" title="One platform for your whole HR team" subtitle="Every module below is live in the product today." />
        <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {CORE_FEATURES.map(({ icon: Icon, title, text }) => (
            <div key={title} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-card">
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
                <Icon className="h-5 w-5" aria-hidden="true" />
              </span>
              <h3 className="mt-4 font-semibold text-ink">{title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-slate-600">{text}</p>
            </div>
          ))}
        </div>
        <div className="mt-10 text-center"><ButtonLink to="/features" variant="outline" arrow>See all features</ButtonLink></div>
      </Section>

      {/* 4 — How it works */}
      <Section>
        <SectionHeading eyebrow="How it works" title="Up and running in three steps" />
        <ol className="mt-12 grid gap-6 md:grid-cols-3">
          {STEPS.map((step, i) => (
            <li key={step.title} className="rounded-2xl border border-slate-200 p-6">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-ink text-sm font-semibold text-brand-300">{i + 1}</span>
              <h3 className="mt-4 font-semibold text-ink">{step.title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-slate-600">{step.text}</p>
            </li>
          ))}
        </ol>
      </Section>

      {/* 5 — Pricing */}
      <Section id="pricing" className="bg-slate-50">
        <SectionHeading eyebrow="Pricing" title="Simple plans in rupees" subtitle={`Start with a ${SITE.trial.length} free trial. No credit card required.`} />
        <div className="mt-12"><PricingCards /></div>
        <PricingNotes />
      </Section>

      {/* 6 — FAQ */}
      <Section id="faq">
        <SectionHeading title="Frequently asked questions" />
        <div className="mt-10"><Faq items={HOME_FAQ} /></div>
      </Section>

      <section className="bg-ink">
        <Container className="flex flex-col items-center gap-6 py-16 text-center">
          <Users className="h-8 w-8 text-brand-400" aria-hidden="true" />
          <h2 className="max-w-2xl text-3xl font-semibold tracking-tight text-white">Bring your whole team onto SpaxSync</h2>
          <div className="flex flex-col gap-3 sm:flex-row">
            <TrialButton variant="bright" size="lg" />
            <DemoButton variant="ghostLight" size="lg" />
          </div>
        </Container>
      </section>
    </>
  );
}
