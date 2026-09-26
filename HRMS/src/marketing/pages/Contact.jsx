import { Mail, Phone, CalendarClock } from 'lucide-react';
import { SITE, demoHref } from '../siteConfig';
import { Section } from '../components/ui';
import { LeadForm } from '../components/LeadForm';

export default function Contact() {
  const demo = demoHref();
  return (
    <Section className="bg-slate-50">
      <div className="grid gap-12 lg:grid-cols-[1fr_1.2fr]">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wider text-brand-600">Contact</p>
          <h1 className="mt-2 text-3xl sm:text-4xl font-semibold tracking-tight text-ink">Talk to the {SITE.name} team</h1>
          <p className="mt-4 text-lg text-slate-600">Questions about pricing, moving from another tool, or a demo for your team — send us a message.</p>
          <ul className="mt-8 space-y-4 text-slate-700">
            <li className="flex gap-3"><Mail className="h-5 w-5 text-brand-600" aria-hidden="true" /><span>Sales: <a className="font-medium text-ink hover:underline" href={`mailto:${SITE.salesEmail}`}>{SITE.salesEmail}</a><br />Support: <a className="font-medium text-ink hover:underline" href={`mailto:${SITE.supportEmail}`}>{SITE.supportEmail}</a></span></li>
            {SITE.phone && <li className="flex gap-3"><Phone className="h-5 w-5 text-brand-600" aria-hidden="true" /><a className="font-medium text-ink hover:underline" href={`tel:${SITE.phone.replace(/\s/g, '')}`}>{SITE.phone}</a></li>}
            <li className="flex gap-3"><CalendarClock className="h-5 w-5 text-brand-600" aria-hidden="true" /><a className="font-medium text-ink hover:underline" href={demo} {...(demo.startsWith('http') ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>Book a demo</a></li>
          </ul>
          {SITE.address && <p className="mt-8 text-sm text-slate-500">{SITE.legalName}<br />{SITE.address}</p>}
        </div>
        <LeadForm type="contact" />
      </div>
    </Section>
  );
}
