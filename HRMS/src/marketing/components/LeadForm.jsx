import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { CheckCircle2 } from 'lucide-react';
import { SITE } from '../siteConfig';
import { submitLead } from '../lib/api';

const COMPANY_SIZES = ['1-10', '11-50', '51-200', '201-500', '501-1000', '1000+'];

// Mirrors backend/src/utils/slug.js — the suggestion is the first word of the company name.
const slugify = (v) => String(v || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
const firstWordSlug = (name) => slugify(String(name || '').trim().split(/\s+/)[0]);

const inputClass = 'mt-1.5 block w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-ink placeholder:text-slate-400 focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/20';

function Field({ label, optional, children }) {
  return (
    <label className="block text-sm font-medium text-slate-800">
      {label}{optional && <span className="font-normal text-slate-400"> (optional)</span>}
      {children}
    </label>
  );
}

/** Trial requests and contact messages both land in the super-admin Leads inbox (POST /api/public/leads). */
export function LeadForm({ type }) {
  const { pathname } = useLocation();
  const isTrial = type === 'trial';
  const [form, setForm] = useState({ full_name: '', work_email: '', phone: '', company_name: '', company_size: '', desired_slug: '', message: '', website: '' });
  const [slugEdited, setSlugEdited] = useState(false);
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState('');

  const set = (key) => (e) => {
    const value = e.target.value;
    setForm((f) => {
      const next = { ...f, [key]: value };
      if (key === 'company_name' && !slugEdited) next.desired_slug = firstWordSlug(value);
      return next;
    });
  };

  const onSubmit = async (e) => {
    e.preventDefault();
    setStatus('submitting');
    setError('');
    try {
      await submitLead({
        type,
        full_name: form.full_name.trim(),
        work_email: form.work_email.trim(),
        phone: form.phone.trim() || undefined,
        company_name: form.company_name.trim() || undefined,
        company_size: form.company_size || undefined,
        desired_slug: isTrial ? slugify(form.desired_slug) || undefined : undefined,
        message: form.message.trim() || undefined,
        website: form.website || undefined,
        source_path: pathname,
      });
      setStatus('done');
    } catch (err) {
      setError(err.status === 429 ? 'Too many requests from your network. Please try again in an hour, or email us.' : err.message);
      setStatus('idle');
    }
  };

  if (status === 'done') {
    return (
      <div className="rounded-2xl border border-brand-200 bg-brand-50 p-8 text-center">
        <CheckCircle2 className="mx-auto h-10 w-10 text-brand-700" aria-hidden="true" />
        <h2 className="mt-4 text-xl font-semibold text-ink">{isTrial ? 'Request received' : 'Message sent'}</h2>
        <p className="mt-2 text-slate-700">
          {isTrial
            ? 'We’ll review your request and email you an invite to set up your workspace. Keep an eye on your inbox.'
            : 'Thanks — we’ll get back to you by email.'}
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5 rounded-2xl border border-slate-200 bg-white p-6 shadow-card sm:p-8">
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Full name"><input required minLength={2} maxLength={200} autoComplete="name" className={inputClass} value={form.full_name} onChange={set('full_name')} /></Field>
        <Field label="Work email"><input required type="email" maxLength={255} autoComplete="email" className={inputClass} value={form.work_email} onChange={set('work_email')} /></Field>
        <Field label="Phone" optional><input type="tel" maxLength={20} pattern="\+?[0-9 ()\-]{7,20}" autoComplete="tel" className={inputClass} value={form.phone} onChange={set('phone')} /></Field>
        <Field label="Company name" optional={!isTrial}><input required={isTrial} minLength={isTrial ? 2 : undefined} maxLength={200} autoComplete="organization" className={inputClass} value={form.company_name} onChange={set('company_name')} /></Field>
      </div>
      <Field label="Number of employees" optional>
        <select className={inputClass} value={form.company_size} onChange={set('company_size')}>
          <option value="">Select</option>
          {COMPANY_SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </Field>
      {isTrial && (
        <Field label="Preferred workspace address" optional>
          <div className="mt-1.5 flex items-stretch overflow-hidden rounded-xl border border-slate-300 focus-within:border-brand-600 focus-within:ring-2 focus-within:ring-brand-600/20">
            <input
              maxLength={48}
              className="min-w-0 flex-1 px-3.5 py-2.5 text-ink focus:outline-none"
              value={form.desired_slug}
              onChange={(e) => { setSlugEdited(true); setForm((f) => ({ ...f, desired_slug: e.target.value })); }}
              onBlur={() => setForm((f) => ({ ...f, desired_slug: slugify(f.desired_slug) }))}
              placeholder="yourcompany"
            />
            <span className="flex items-center bg-slate-50 px-3 text-sm text-slate-500">.spaxsync.com</span>
          </div>
          <span className="mt-1.5 block text-xs font-normal text-slate-500">We’ll confirm availability when we send your invite. You can change it while setting up.</span>
        </Field>
      )}
      <Field label={isTrial ? 'Anything we should know?' : 'Message'} optional={isTrial}>
        <textarea required={!isTrial} minLength={isTrial ? undefined : 5} maxLength={4000} rows={4} className={inputClass} value={form.message} onChange={set('message')} />
      </Field>
      {/* Honeypot — hidden from people, filled in by bots. */}
      <div className="hidden" aria-hidden="true">
        <label>Website<input tabIndex={-1} autoComplete="off" value={form.website} onChange={set('website')} /></label>
      </div>
      {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <button type="submit" disabled={status === 'submitting'} className="inline-flex w-full items-center justify-center rounded-xl bg-brand-700 px-5 py-3 font-semibold text-white transition-colors hover:bg-brand-800 disabled:opacity-60">
        {status === 'submitting' ? 'Sending…' : isTrial ? `Request my ${SITE.trial.length} free trial` : 'Send message'}
      </button>
      <p className="text-center text-xs text-slate-500">
        By submitting you agree to our <Link to="/privacy" className="underline">privacy policy</Link>.
      </p>
    </form>
  );
}
