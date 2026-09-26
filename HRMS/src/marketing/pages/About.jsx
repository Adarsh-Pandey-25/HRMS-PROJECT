import { SITE } from '../siteConfig';
import { Section, SectionHeading, TrialButton, ButtonLink } from '../components/ui';

export default function About() {
  return (
    <Section>
      <SectionHeading align="left" eyebrow="About" title={`Why we built ${SITE.name}`} />
      <div className="mt-8 max-w-3xl space-y-5 text-lg leading-relaxed text-slate-700">
        <p>
          Most Indian companies still run HR on spreadsheets, a biometric machine that nobody reconciles, and WhatsApp messages
          for leave. Payroll then means a week of cross-checking attendance by hand.
        </p>
        <p>
          {SITE.name} puts attendance, leave, payroll and employee records in one place, built around how Indian companies work:
          office-IP and biometric check-in, loss-of-pay from real attendance, state-wise professional tax, and prices in rupees.
        </p>
        <p>
          {SITE.name} is built and operated by {SITE.legalName}.
        </p>
      </div>
      <div className="mt-10 flex flex-col gap-3 sm:flex-row">
        <TrialButton />
        <ButtonLink to="/contact" variant="outline">Talk to us</ButtonLink>
      </div>
    </Section>
  );
}
