import { Fingerprint, CalendarDays, IndianRupee, Check } from 'lucide-react';

/** Illustration of the HR dashboard for the hero — pure markup, no image request. */
export function DashboardMockup() {
  const bars = [62, 78, 70, 88, 84, 92, 74];
  return (
    <div aria-hidden="true" className="relative mx-auto w-full max-w-xl select-none">
      <div className="absolute -inset-6 rounded-[2rem] bg-brand-400/10 blur-2xl" />
      <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-ink-900 shadow-2xl">
        <div className="flex items-center gap-1.5 border-b border-white/10 px-4 py-3">
          <span className="h-2.5 w-2.5 rounded-full bg-white/15" /><span className="h-2.5 w-2.5 rounded-full bg-white/15" /><span className="h-2.5 w-2.5 rounded-full bg-white/15" />
          <span className="ml-3 rounded-md bg-white/5 px-3 py-1 text-[11px] text-slate-400">yourcompany.spaxsync.com</span>
        </div>
        <div className="grid gap-3 p-4 sm:grid-cols-3">
          {[
            { icon: Fingerprint, label: 'Checked in today', value: '46 / 50' },
            { icon: CalendarDays, label: 'Leave requests', value: '3 pending' },
            { icon: IndianRupee, label: 'Payroll', value: 'Draft ready' },
          ].map(({ icon: Icon, label, value }) => (
            <div key={label} className="rounded-xl bg-white/[0.04] p-3">
              <Icon className="h-4 w-4 text-brand-400" />
              <p className="mt-2 text-[11px] text-slate-400">{label}</p>
              <p className="text-sm font-semibold text-white">{value}</p>
            </div>
          ))}
        </div>
        <div className="grid gap-3 px-4 pb-4 sm:grid-cols-[1.4fr_1fr]">
          <div className="rounded-xl bg-white/[0.04] p-3">
            <p className="text-[11px] text-slate-400">Attendance this week</p>
            <div className="mt-3 flex h-24 items-end gap-2">
              {bars.map((h, i) => <div key={i} className="flex-1 rounded-t bg-brand-400/80" style={{ height: `${h}%` }} />)}
            </div>
          </div>
          <div className="space-y-2 rounded-xl bg-white/[0.04] p-3">
            <p className="text-[11px] text-slate-400">Approvals</p>
            {['Casual leave · 2 days', 'Regularization · Mon', 'Expense claim'].map((t) => (
              <div key={t} className="flex items-center justify-between rounded-lg bg-white/[0.04] px-2.5 py-2">
                <span className="text-[11px] text-slate-300">{t}</span>
                <Check className="h-3.5 w-3.5 text-brand-400" />
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="absolute -bottom-5 -left-3 hidden rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-card sm:block">
        <p className="text-[11px] text-slate-500">Payslip published</p>
        <p className="text-sm font-semibold text-ink">September 2026</p>
      </div>
    </div>
  );
}
