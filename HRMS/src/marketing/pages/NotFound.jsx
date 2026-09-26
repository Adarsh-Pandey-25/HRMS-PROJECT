import { Section, ButtonLink } from '../components/ui';

export default function NotFound() {
  return (
    <Section>
      <div className="mx-auto max-w-lg text-center">
        <p className="text-sm font-semibold text-brand-600">404</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-ink">Page not found</h1>
        <p className="mt-4 text-slate-600">
          The page you’re looking for doesn’t exist. If you’re trying to sign in, use your company’s workspace address
          — for example <span className="font-medium text-ink">yourcompany.spaxsync.com</span>.
        </p>
        <ButtonLink to="/" className="mt-8">Go to the home page</ButtonLink>
      </div>
    </Section>
  );
}
