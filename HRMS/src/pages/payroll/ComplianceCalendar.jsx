import { useMemo } from 'react';
import { Banknote, CalendarClock, FileText, Gift, HeartHandshake, HeartPulse, Landmark, Receipt } from 'lucide-react';
import { PageHeader, Card } from '../../components/ui';
import { useSettingsStore } from '../../store/settingsStore';
import { cn, formatDate } from '../../lib/utils';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/**
 * The statutory due dates for payroll, month by month, for the next twelve
 * months — from the 27 Oct 2026 report (docs/payroll-statutory-values.md
 * lists what is still to confirm with a CA). LWF follows the months the
 * company entered in Settings → Payroll. Read-only; nothing is filed from here.
 */
function deadlinesFrom(start, lwfStates) {
  const items = [];
  const add = (y, m, day, entry) => items.push({ date: new Date(y, m - 1, day), ...entry });
  const lastDay = (y, m) => new Date(y, m, 0).getDate();
  // From a year back: an annual due date (the bonus, say) can fall in the window from an earlier March.
  for (let k = -12; k < 12; k += 1) {
    // The payroll month whose dues fall in the month after it.
    const pm = new Date(start.getFullYear(), start.getMonth() + k, 1);
    const m = pm.getMonth() + 1;
    const y = pm.getFullYear();
    const next = new Date(y, m, 1);
    const nm = next.getMonth() + 1;
    const ny = next.getFullYear();
    const label = `${MONTHS[m - 1]} ${y}`;
    add(ny, nm, 7, { icon: Banknote, tone: 'primary', title: `Pay ${label} salaries`, detail: 'Before the 7th (Code on Wages s.17). Full and final within 2 working days of someone leaving.' });
    if (m === 3) {
      add(ny, 4, 30, { icon: Receipt, tone: 'amber', title: `Deposit ${label} TDS`, detail: 'March TDS: 30 April under the earlier rules — confirm the date with your CA.' });
    } else {
      add(ny, nm, 7, { icon: Receipt, tone: 'amber', title: `Deposit ${label} TDS`, detail: 'Payroll → TDS Register shows the amount.' });
    }
    add(ny, nm, 15, { icon: Landmark, tone: 'sky', title: `PF for ${label}: upload the ECR and pay`, detail: 'Run Payroll → Files → EPF ECR.' });
    add(ny, nm, 15, { icon: HeartPulse, tone: 'rose', title: `ESI for ${label}`, detail: 'Run Payroll → Files → ESI.' });
    for (const s of lwfStates || []) {
      if ((s.months || []).includes(m)) {
        add(y, m, lastDay(y, m), { icon: HeartHandshake, tone: 'teal', title: `LWF (${s.state}) deducted on ${label} payslips`, detail: 'Deposit it by your state\'s due date.' });
      }
    }
    // The quarterly TDS statement (Form 138, formerly 24Q).
    const quarterEnds = { 6: [7, 31, 'April–June'], 9: [10, 31, 'July–September'], 12: [1, 31, 'October–December'], 3: [5, 31, 'January–March'] };
    if (quarterEnds[m]) {
      const [dm, dd, q] = quarterEnds[m];
      add(dm < m ? y + 1 : y, dm, dd, { icon: FileText, tone: 'violet', title: `TDS statement for ${q} ${y}`, detail: 'Form 138 (formerly 24Q): Payroll → TDS Register → the quarter\'s file. Confirm the date with your CA.' });
    }
    if (m === 3) {
      add(y, 6, 15, { icon: FileText, tone: 'violet', title: `Annual TDS certificates for ${y - 1}-${String(y).slice(2)}`, detail: 'Form 130 (formerly Form 16) to each employee — Payroll → TDS Register → Statement has the figures.' });
      add(y, 11, 30, { icon: Gift, tone: 'primary', title: `Statutory bonus for ${y - 1}-${String(y).slice(2)}`, detail: 'Within 8 months of the year\'s end, for those with wages up to ₹21,000 a month.' });
    }
  }
  const from = new Date(start.getFullYear(), start.getMonth(), 1);
  const to = new Date(start.getFullYear(), start.getMonth() + 12, 0);
  return items.filter((i) => i.date >= from && i.date <= to).sort((a, b) => a.date - b.date);
}

const TONES = {
  primary: 'bg-primary/10 text-primary',
  amber: 'bg-warning/15 text-warning',
  sky: 'bg-info/10 text-info',
  rose: 'bg-danger/10 text-danger',
  teal: 'bg-teal/15 text-teal',
  violet: 'bg-violet-500/10 text-violet-500',
};

export default function ComplianceCalendar() {
  const lwfStates = useSettingsStore((s) => s.payrollConfig?.lwfStates);
  const today = new Date();
  const items = useMemo(() => deadlinesFrom(new Date(), lwfStates), [lwfStates]);
  const byMonth = useMemo(() => {
    const groups = new Map();
    for (const i of items) {
      const key = `${i.date.getFullYear()}-${i.date.getMonth()}`;
      if (!groups.has(key)) groups.set(key, { label: `${MONTHS[i.date.getMonth()]} ${i.date.getFullYear()}`, items: [] });
      groups.get(key).items.push(i);
    }
    return [...groups.values()];
  }, [items]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Compliance calendar"
        subtitle="Payroll's statutory due dates for the next twelve months. Dates are from the law as of 27 Oct 2026; the ones marked “confirm” are still to be checked with your CA."
      />
      {byMonth.map((g) => (
        <Card key={g.label} className="p-5">
          <h3 className="flex items-center gap-2 text-sm font-bold text-fg">
            <CalendarClock className="h-4 w-4 text-primary" /> {g.label}
          </h3>
          <ul className="mt-3 divide-y divide-border/50">
            {g.items.map((i) => {
              const Icon = i.icon;
              const past = i.date < new Date(today.getFullYear(), today.getMonth(), today.getDate());
              return (
                <li key={`${i.title}-${i.date.toISOString()}`} className={cn('flex items-start gap-3 py-2.5', past && 'opacity-50')}>
                  <span className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-xl', TONES[i.tone])}>
                    <Icon className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-fg">{i.title}</p>
                    <p className="text-xs text-fg-subtle">{i.detail}</p>
                  </div>
                  <span className="shrink-0 rounded-full bg-muted px-2.5 py-0.5 text-[11px] font-semibold tabular-nums text-fg-muted">
                    {formatDate(i.date, 'dd MMM')}
                  </span>
                </li>
              );
            })}
          </ul>
        </Card>
      ))}
      <p className="px-1 text-xs text-fg-subtle">
        Professional Tax follows your state&apos;s own dates. Gratuity is due within 30 days of becoming payable.
      </p>
    </div>
  );
}
