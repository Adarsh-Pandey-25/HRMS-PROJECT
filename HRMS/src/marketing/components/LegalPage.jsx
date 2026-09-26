import { SITE } from '../siteConfig';
import { Container } from './ui';

/** Shared layout for policy pages. `sections` is [{ heading, body: string | string[] }]. */
export function LegalPage({ title, intro, sections }) {
  return (
    <Container className="py-16 sm:py-20">
      <article className="mx-auto max-w-3xl">
        <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight text-ink">{title}</h1>
        <p className="mt-3 text-sm text-slate-500">Last updated: {SITE.legalLastUpdated}</p>
        {intro && <p className="mt-8 text-lg leading-relaxed text-slate-700">{intro}</p>}
        {sections.map((s) => (
          <section key={s.heading} className="mt-10">
            <h2 className="text-xl font-semibold text-ink">{s.heading}</h2>
            {(Array.isArray(s.body) ? s.body : [s.body]).map((p) => <p key={p} className="mt-3 leading-relaxed text-slate-700">{p}</p>)}
          </section>
        ))}
      </article>
    </Container>
  );
}

export const grievanceContact = () =>
  [SITE.grievanceOfficer.name, `email ${SITE.grievanceOfficer.email}`, SITE.address && `post: ${SITE.address}`].filter(Boolean).join(', ');
