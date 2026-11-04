import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Undo2 } from 'lucide-react';
import toast from 'react-hot-toast';
import {
  PageHeader, Card, Button, Select, Skeleton, Drawer, Textarea,
} from '../../components/ui';
import { fetchTaxDeclarationsApi, verifyTaxDeclarationApi, returnTaxDeclarationApi } from '../../api/payroll.api';
import { cn, formatCurrency, formatDate } from '../../lib/utils';

// Responses arrive camelCased (api/client.js): rent_paid → rentPaid; section_80c stays.
const camelKey = (k) => k.replace(/_([a-z])/g, (_, c) => c.toUpperCase());

const DECLARED_LABELS = [
  ['rent_paid', 'Rent paid in the year'],
  ['lta', 'LTA claimed'],
  ['section_80c', '80C-type investments (excl. PF)'],
  ['section_80d', 'Health insurance (80D-type)'],
  ['nps_extra', 'Extra NPS (80CCD(1B)-type)'],
  ['home_loan_interest', 'Home-loan interest'],
  ['other_deductions', 'Other deductions'],
  ['previous_employer_income', 'Previous employer salary'],
  ['previous_employer_tds', 'Previous employer TDS'],
  ['other_income', 'Other income'],
];

// What HR allows → the employee's payroll tax profile (what TDS uses).
const ALLOWED = [
  { key: 'hra_exemption', label: 'HRA exemption allowed', oldOnly: true, hint: 'Least of: HRA received, rent − 10% of Basic + DA, or 50% (metro city, per the 2026 list) / 40% of Basic + DA — for the months rent is paid. Check with your CA.' },
  { key: 'lta_exemption', label: 'LTA exemption allowed', oldOnly: true },
  { key: 'chapter8_deductions', label: 'Chapter VIII deductions allowed', oldOnly: true, hint: '80C-type (with their PF) up to its limit, health insurance, extra NPS — after the legal limits.' },
  { key: 'other_deductions', label: 'Other deductions allowed', oldOnly: true, hint: 'E.g. home-loan interest, within its limit.' },
  { key: 'previous_employer_income', label: 'Previous employer salary' },
  { key: 'previous_employer_tds', label: 'Previous employer TDS' },
  { key: 'other_income', label: 'Other income' },
];

const STATUS_LABEL = {
  submitted: { text: 'To check', tone: 'bg-info/10 text-info' },
  verified: { text: 'Accepted', tone: 'bg-success/10 text-success' },
  returned: { text: 'Sent back', tone: 'bg-warning/10 text-warning' },
  draft: { text: 'Draft', tone: 'bg-muted text-fg-muted' },
};

const yearOptions = () => {
  const now = new Date();
  const start = now.getMonth() + 1 >= 4 ? now.getFullYear() : now.getFullYear() - 1;
  return [start, start + 1, start - 1].map((y) => {
    const value = `${y}-${String((y + 1) % 100).padStart(2, '0')}`;
    return { value, label: `${value} (Apr ${y} – Mar ${y + 1})` };
  });
};

/**
 * What to pre-fill for HR: the declared amounts mapped to the profile's
 * fields, or — where the employee left one blank — what is already recorded
 * for them (e.g. a previous employer's salary HR entered). HR checks and adjusts.
 */
const suggest = (d) => {
  const dec = d.declared || {};
  const n = (k) => Number(dec[camelKey(k)] || 0);
  const rec = (k) => Number(d.recorded?.[camelKey(k)] || 0);
  const either = (declared, key) => (declared > 0 ? declared : rec(key));
  const old = d.regime === 'old';
  return {
    regime: d.regime,
    hra_exemption: old ? (rec('hra_exemption') || '') : 0,
    lta_exemption: either(old ? n('lta') : 0, 'lta_exemption'),
    chapter8_deductions: either(old ? n('section_80c') + n('section_80d') + n('nps_extra') : 0, 'chapter8_deductions'),
    other_deductions: either(old ? n('home_loan_interest') + n('other_deductions') : 0, 'other_deductions'),
    previous_employer_income: either(n('previous_employer_income'), 'previous_employer_income'),
    previous_employer_tds: either(n('previous_employer_tds'), 'previous_employer_tds'),
    other_income: either(n('other_income'), 'other_income'),
    note: '',
  };
};

/**
 * Payroll → Tax Declarations: HR checks each employee's declaration (and
 * its proofs) and records the amounts allowed — they become the employee's
 * TDS inputs. Or sends it back with a note. Nothing is sent to anyone.
 */
export default function TaxDeclarations() {
  const qc = useQueryClient();
  const years = useMemo(yearOptions, []);
  const [taxYear, setTaxYear] = useState(years[0].value);
  const [status, setStatus] = useState('submitted');
  const [open, setOpen] = useState(null);
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(null);
  const key = ['payroll', 'tax-declarations', taxYear, status];
  const { data: rows = [], isLoading, error } = useQuery({
    queryKey: key,
    queryFn: () => fetchTaxDeclarationsApi({ taxYear, status: status || undefined }),
  });

  const review = (d) => { setOpen(d); setForm(suggest(d)); };
  const close = () => { setOpen(null); setForm(null); };
  const done = async (message) => {
    toast.success(message);
    close();
    await qc.invalidateQueries({ queryKey: ['payroll', 'tax-declarations'] });
  };

  const accept = async () => {
    setBusy('accept');
    try {
      // Every field on screen is sent, zeros too, so what HR sees is what is saved;
      // the old regime's fields stay as they were when the new regime is chosen.
      const allowed = {};
      for (const f of ALLOWED) {
        if (f.oldOnly && form.regime !== 'old') continue;
        allowed[f.key] = Math.round(Number(form[f.key] || 0) * 100) / 100;
      }
      await verifyTaxDeclarationApi(open.id, { allowed, regime: form.regime, note: form.note });
      await done(`${open.employeeName}'s declaration accepted`);
    } catch (err) {
      toast.error(err.message || 'Could not accept it');
    } finally {
      setBusy(null);
    }
  };
  const sendBack = async () => {
    setBusy('return');
    try {
      await returnTaxDeclarationApi(open.id, form.note);
      await done(`Sent back to ${open.employeeName}`);
    } catch (err) {
      toast.error(err.message || 'Could not send it back');
    } finally {
      setBusy(null);
    }
  };

  const invalid = form && ALLOWED.some((f) => form[f.key] !== '' && !(Number(form[f.key]) >= 0));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Tax declarations"
        subtitle="Check what employees declared for income tax and record what you allow — it becomes their TDS input."
        actions={(
          <div className="flex flex-wrap gap-2">
            <Select
              aria-label="Status"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="w-40"
              options={[
                { value: 'submitted', label: 'To check' },
                { value: 'verified', label: 'Accepted' },
                { value: 'returned', label: 'Sent back' },
                { value: 'draft', label: 'Drafts' },
                { value: '', label: 'All' },
              ]}
            />
            <Select aria-label="Tax year" options={years} value={taxYear} onChange={(e) => setTaxYear(e.target.value)} className="w-56" />
          </div>
        )}
      />

      {error && <Card className="p-5 text-sm text-danger">{error.message}</Card>}

      <Card>
        {isLoading ? (
          <Skeleton className="m-5 h-40 rounded-xl" />
        ) : rows.length === 0 ? (
          <p className="p-8 text-center text-sm text-fg-subtle">No declarations here for {taxYear}.</p>
        ) : (
          <div className="overflow-x-auto p-5">
            <table className="w-full min-w-[600px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-fg-subtle">
                  <th className="py-2">Employee</th>
                  <th className="py-2">Regime</th>
                  <th className="py-2">Status</th>
                  <th className="py-2">Sent</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody>
                {rows.map((d) => {
                  const s = STATUS_LABEL[d.status] || STATUS_LABEL.draft;
                  return (
                    <tr key={d.id} className="border-b border-border/60">
                      <td className="py-2">
                        <span className="font-medium text-fg">{d.employeeName}</span>
                        {d.employeeCode && <span className="ml-2 text-xs text-fg-subtle">{d.employeeCode}</span>}
                      </td>
                      <td className="py-2 text-xs capitalize text-fg-muted">{d.regime} regime</td>
                      <td className="py-2"><span className={cn('rounded-full px-2 py-0.5 text-[11px] font-semibold', s.tone)}>{s.text}</span></td>
                      <td className="py-2 text-xs text-fg-muted">{d.submittedAt ? formatDate(d.submittedAt) : '—'}</td>
                      <td className="py-2 text-right">
                        {d.status === 'submitted' && <Button size="sm" variant="outline" onClick={() => review(d)}>Review</Button>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Drawer
        open={Boolean(open)}
        onClose={close}
        title={open ? `${open.employeeName} — ${open.taxYear}` : ''}
        subtitle={open ? `${open.regime === 'old' ? 'Old' : 'New'} regime chosen` : ''}
        width="w-[520px]"
        footer={open && form && (
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="outline" icon={Undo2} onClick={sendBack} loading={busy === 'return'} disabled={Boolean(busy) || !form.note.trim()}>
              Send back
            </Button>
            <Button icon={Check} onClick={accept} loading={busy === 'accept'} disabled={Boolean(busy) || invalid || (form.regime === 'old' && form.hra_exemption === '')}>
              Accept
            </Button>
          </div>
        )}
      >
        {open && form && (
          <div className="space-y-5 text-sm">
            <div>
              <p className="mb-2 text-xs font-bold uppercase tracking-wide text-fg-subtle">Declared</p>
              {DECLARED_LABELS.filter(([k]) => Number(open.declared?.[camelKey(k)] || 0) > 0).map(([k, label]) => (
                <p key={k} className="flex justify-between gap-3 text-fg-muted">
                  <span>{label}</span>
                  <span className="tabular-nums text-fg">{formatCurrency(open.declared[camelKey(k)])}</span>
                </p>
              ))}
              {open.declared?.metroCity && <p className="text-xs text-fg-subtle">Rents in a metro city.</p>}
              {open.employeeNote && <p className="mt-2 rounded-xl bg-muted/50 p-2 text-xs text-fg-muted">Their note: {open.employeeNote}</p>}
            </div>

            <div>
              <p className="mb-2 text-xs font-bold uppercase tracking-wide text-fg-subtle">Regime</p>
              <div className="inline-flex gap-1 rounded-xl bg-muted/70 p-1">
                {[['new', 'New'], ['old', 'Old']].map(([v, l]) => (
                  <button
                    key={v}
                    type="button"
                    aria-pressed={form.regime === v}
                    onClick={() => setForm((f) => ({ ...f, regime: v }))}
                    className={cn('rounded-lg px-3 py-1 text-xs font-bold', form.regime === v ? 'bg-card text-primary shadow-sm' : 'text-fg-muted')}
                  >
                    {l}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-3">
              <p className="text-xs font-bold uppercase tracking-wide text-fg-subtle">Allowed (after checking proofs and legal limits)</p>
              {ALLOWED.filter((f) => !f.oldOnly || form.regime === 'old').map((f) => (
                <label key={f.key} className="block text-xs text-fg-muted">
                  <span className="mb-1 block font-semibold text-fg">{f.label}</span>
                  <input
                    type="number"
                    min={0}
                    step="1"
                    value={form[f.key]}
                    onChange={(e) => setForm((x) => ({ ...x, [f.key]: e.target.value }))}
                    className="h-9 w-full rounded-xl border border-border bg-card px-2 text-sm text-fg outline-none focus:ring-2 focus:ring-primary"
                    aria-label={f.label}
                  />
                  {f.hint && <span className="mt-1 block text-[11px] text-fg-subtle">{f.hint}</span>}
                </label>
              ))}
            </div>

            <Textarea
              label="Note to the employee (needed to send it back)"
              rows={2}
              maxLength={1000}
              value={form.note}
              onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
            />
          </div>
        )}
      </Drawer>
    </div>
  );
}
