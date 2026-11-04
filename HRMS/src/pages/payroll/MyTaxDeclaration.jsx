import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Clock, FileText, Send, Undo2 } from 'lucide-react';
import toast from 'react-hot-toast';
import {
  PageHeader, Card, CardHeader, Button, Select, Skeleton, Textarea,
} from '../../components/ui';
import { fetchMyTaxDeclarationApi, saveMyTaxDeclarationApi, fetchAnnualTaxStatementApi } from '../../api/payroll.api';
import { AnnualTaxStatement } from '../../components/payroll/AnnualTaxStatement';
import { cn, formatCurrency, formatDate } from '../../lib/utils';

// Responses arrive camelCased (api/client.js): rent_paid → rentPaid; section_80c stays.
const camelKey = (k) => k.replace(/_([a-z])/g, (_, c) => c.toUpperCase());

const EARLIER = [
  { key: 'previous_employer_income', label: 'Salary from a previous employer this tax year', hint: 'If you joined during the year — from their payslips or Form 130/16.' },
  { key: 'previous_employer_tds', label: 'TDS that employer deducted' },
  { key: 'other_income', label: 'Other income you want counted (interest, rent received…)' },
];
const OLD_REGIME = [
  { key: 'rent_paid', label: 'Rent you pay for the year', hint: 'For the HRA exemption.' },
  { key: 'lta', label: 'Leave travel (LTA) you will claim' },
  { key: 'section_80c', label: 'Investments such as PPF, ELSS, life insurance, tuition fees, home-loan principal', hint: '80C-type. Don\'t include your PF — payroll counts that.' },
  { key: 'section_80d', label: 'Health insurance premiums', hint: '80D-type.' },
  { key: 'nps_extra', label: 'Extra NPS contribution', hint: '80CCD(1B)-type.' },
  { key: 'home_loan_interest', label: 'Home-loan interest' },
  { key: 'other_deductions', label: 'Other deductions' },
];

// What HR allowed, as it arrives (camelCased) — the payroll tax profile's fields.
const ALLOWED_LABELS = {
  hraExemption: 'HRA exemption',
  ltaExemption: 'LTA exemption',
  chapter8Deductions: 'Investments and insurance (Chapter VIII)',
  otherDeductions: 'Other deductions',
  previousEmployerIncome: 'Salary from a previous employer',
  previousEmployerTds: 'TDS by that employer',
  otherIncome: 'Other income',
};

/** This tax year and the next (declarations for next year open in March). */
const yearOptions = () => {
  const now = new Date();
  const start = now.getMonth() + 1 >= 4 ? now.getFullYear() : now.getFullYear() - 1;
  return [start, start + 1].map((y) => {
    const value = `${y}-${String((y + 1) % 100).padStart(2, '0')}`;
    return { value, label: `${value} (Apr ${y} – Mar ${y + 1})` };
  });
};

const STATUS = {
  none: { text: 'Not sent yet — fill it in and send it to HR.', icon: FileText, tone: 'bg-muted/60 text-fg-muted' },
  draft: { text: 'Saved, not sent yet — send it to HR when it\'s ready.', icon: FileText, tone: 'bg-muted/60 text-fg-muted' },
  submitted: { text: 'With HR for checking — you can change it once they have reviewed it.', icon: Clock, tone: 'bg-info/10 text-info' },
  verified: { text: 'Accepted by HR — payroll uses it for your TDS. You can update it and send it again.', icon: CheckCircle2, tone: 'bg-success/10 text-success' },
  returned: { text: 'Sent back by HR — see their note, change it and send it again.', icon: Undo2, tone: 'bg-warning/10 text-fg' },
};

const formFrom = (d) => ({
  regime: d?.regime === 'old' ? 'old' : 'new',
  metroCity: Boolean(d?.declared?.metroCity),
  note: d?.employeeNote || '',
  ...Object.fromEntries([...EARLIER, ...OLD_REGIME].map((f) => [f.key, d?.declared?.[camelKey(f.key)] ?? ''])),
});

/**
 * Payroll → My Tax Declaration (Form 124, formerly 12BB): the employee
 * chooses the tax regime for the year and declares what they can deduct;
 * HR checks it and payroll's TDS uses what HR allows.
 */
export default function MyTaxDeclaration() {
  const qc = useQueryClient();
  const years = useMemo(yearOptions, []);
  const [taxYear, setTaxYear] = useState(years[0].value);
  const { data: decl, isLoading, error } = useQuery({
    queryKey: ['payroll', 'my-tax-declaration', taxYear],
    queryFn: () => fetchMyTaxDeclarationApi(taxYear),
  });
  const [form, setForm] = useState(() => formFrom(null));
  const [saving, setSaving] = useState(null);
  const { data: statement } = useQuery({
    queryKey: ['payroll', 'tax-statement', 'me', taxYear],
    queryFn: () => fetchAnnualTaxStatementApi('me', taxYear),
    retry: false,
  });
  useEffect(() => { if (decl) setForm(formFrom(decl)); }, [decl]);

  const locked = decl?.status === 'submitted';
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const invalid = [...EARLIER, ...OLD_REGIME].some((f) => form[f.key] !== '' && !(Number(form[f.key]) >= 0));

  const save = async (submit) => {
    setSaving(submit ? 'submit' : 'save');
    try {
      const declared = { metro_city: form.metroCity };
      for (const f of [...EARLIER, ...(form.regime === 'old' ? OLD_REGIME : [])]) {
        if (form[f.key] !== '' && Number(form[f.key]) > 0) declared[f.key] = Math.round(Number(form[f.key]) * 100) / 100;
      }
      const saved = await saveMyTaxDeclarationApi({
        taxYear, regime: form.regime, declared, note: form.note, submit,
      });
      qc.setQueryData(['payroll', 'my-tax-declaration', taxYear], saved);
      toast.success(submit ? 'Sent to HR for checking' : 'Saved');
    } catch (err) {
      toast.error(err.message || 'Could not save your declaration');
    } finally {
      setSaving(null);
    }
  };

  const status = STATUS[decl?.status] || STATUS.none;
  const StatusIcon = status.icon;
  const field = (f) => (
    <label key={f.key} className="block text-xs text-fg-muted">
      <span className="mb-1 block font-semibold text-fg">{f.label}</span>
      <input
        type="number"
        min={0}
        step="1"
        inputMode="decimal"
        disabled={locked}
        value={form[f.key]}
        onChange={set(f.key)}
        className="h-10 w-full rounded-xl border border-border bg-card px-3 text-sm text-fg outline-none focus:ring-2 focus:ring-primary disabled:opacity-60"
        placeholder="₹ for the year"
        aria-label={f.label}
      />
      {f.hint && <span className="mt-1 block text-[11px] text-fg-subtle">{f.hint}</span>}
    </label>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="My tax declaration"
        subtitle="Choose your tax regime and declare what you can deduct. HR checks it, and payroll uses what HR allows to work out your monthly TDS."
        actions={<Select aria-label="Tax year" options={years} value={taxYear} onChange={(e) => setTaxYear(e.target.value)} className="w-56" />}
      />

      {error && <Card className="p-5 text-sm text-danger">{error.message}</Card>}

      {isLoading || !decl ? (
        <Skeleton className="h-72 w-full rounded-2xl" />
      ) : (
        <>
          <div className={cn('flex items-start gap-2 rounded-2xl px-4 py-3 text-sm', status.tone)}>
            <StatusIcon className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <p>{status.text}</p>
              {decl.hrNote && <p className="mt-1 text-xs">HR&apos;s note: {decl.hrNote}</p>}
              {decl.status === 'verified' && decl.verifiedAt && <p className="mt-1 text-xs">Accepted on {formatDate(decl.verifiedAt)}.</p>}
            </div>
          </div>

          <Card>
            <CardHeader title={`Tax regime for ${taxYear}`} subtitle="You can choose each year. If you don't, the new regime applies." />
            <div className="grid grid-cols-1 gap-3 px-5 pb-5 md:grid-cols-2">
              {[
                ['new', 'New regime', 'Lower rates; a ₹75,000 standard deduction and nothing else. No tax up to ₹12 lakh of taxable income.'],
                ['old', 'Old regime', 'Higher rates, but rent (HRA), LTA, 80C-type investments, health insurance, home-loan interest and Professional Tax come off.'],
              ].map(([value, title, text]) => (
                <button
                  key={value}
                  type="button"
                  disabled={locked}
                  aria-pressed={form.regime === value}
                  onClick={() => setForm((f) => ({ ...f, regime: value }))}
                  className={cn(
                    'rounded-2xl border p-4 text-left transition-colors disabled:opacity-60',
                    form.regime === value ? 'border-primary bg-primary/5 ring-1 ring-primary/40' : 'border-border hover:bg-muted/40',
                  )}
                >
                  <p className="text-sm font-semibold text-fg">{title}</p>
                  <p className="mt-1 text-xs text-fg-muted">{text}</p>
                </button>
              ))}
            </div>
          </Card>

          <Card>
            <CardHeader title="Earlier this tax year" subtitle="Only if it applies to you." />
            <div className="grid grid-cols-1 gap-4 px-5 pb-5 md:grid-cols-3">{EARLIER.map(field)}</div>
          </Card>

          {form.regime === 'old' && (
            <Card>
              <CardHeader title="Deductions (old regime)" subtitle="Amounts for the whole tax year. Keep the proofs — rent receipts, investment statements — HR may ask for them." />
              <div className="grid grid-cols-1 gap-4 px-5 pb-5 md:grid-cols-2">
                {OLD_REGIME.map(field)}
                <label className="flex items-center gap-2 text-xs text-fg-muted">
                  <input type="checkbox" disabled={locked} checked={form.metroCity} onChange={(e) => setForm((f) => ({ ...f, metroCity: e.target.checked }))} />
                  I rent in a metro city
                </label>
              </div>
            </Card>
          )}

          {decl.status === 'verified' && decl.allowed && (
            <Card>
              <CardHeader title="What HR allowed" subtitle="Used for your TDS." />
              <div className="grid grid-cols-1 gap-2 px-5 pb-5 text-sm sm:grid-cols-2">
                {Object.entries(ALLOWED_LABELS).filter(([k]) => Number(decl.allowed[k]) > 0).map(([k, label]) => (
                  <p key={k} className="flex justify-between gap-3 text-fg-muted">
                    <span>{label}</span>
                    <span className="tabular-nums text-fg">{formatCurrency(decl.allowed[k])}</span>
                  </p>
                ))}
              </div>
            </Card>
          )}

          {statement?.months > 0 && (
            <Card>
              <CardHeader title="Your salary and tax so far" subtitle={`From your published payslips in ${taxYear}.`} />
              <div className="px-5 pb-5"><AnnualTaxStatement s={statement} /></div>
            </Card>
          )}

          <Card className="p-5">
            <Textarea label="Note for HR (optional)" rows={2} maxLength={1000} disabled={locked} value={form.note} onChange={set('note')} />
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <Button variant="outline" onClick={() => save(false)} loading={saving === 'save'} disabled={locked || Boolean(saving) || invalid}>Save</Button>
              <Button icon={Send} onClick={() => save(true)} loading={saving === 'submit'} disabled={locked || Boolean(saving) || invalid}>Send to HR</Button>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
