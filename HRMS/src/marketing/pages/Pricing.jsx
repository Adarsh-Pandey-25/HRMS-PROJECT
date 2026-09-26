import { SITE } from '../siteConfig';
import { PRICING_FAQ } from '../data/faq';
import { Section, SectionHeading } from '../components/ui';
import { PricingCards, PricingNotes } from '../components/PricingCards';
import { Faq } from '../components/Faq';

export default function Pricing() {
  return (
    <>
      <Section className="bg-slate-50">
        <SectionHeading
          eyebrow="Pricing"
          title="Plans that grow with your team"
          subtitle={`Every plan starts with a ${SITE.trial.length} free trial. No credit card required.`}
        />
        <div className="mt-12"><PricingCards limit={6} /></div>
        <PricingNotes />
      </Section>
      <Section>
        <SectionHeading title="Pricing questions" />
        <div className="mt-10"><Faq items={PRICING_FAQ} /></div>
      </Section>
    </>
  );
}
