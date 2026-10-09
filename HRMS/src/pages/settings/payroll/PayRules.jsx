import { CalendarDays, CalendarOff, Clock4, Coins, DoorOpen, Hourglass, Palmtree, TimerReset } from 'lucide-react';
import { cn, formatCurrency } from '../../../lib/utils';
import {
  DAY_SHORT, ORDINALS, countWorkingDays, describeWorkWeek, latePenaltyDays,
} from '../../../lib/payRules';
import { NumberChip, PillGroup, RuleCard, Sentence, Switch, Tag } from './bits';

const SAMPLE_GROSS = 30000;

/** Late arrivals: N lates after some free ones cost half (or a full) day. */
export function LateRuleCard({ late, onChange }) {
  const set = (patch) => onChange({ ...late, ...patch });
  const preview = Array.from({ length: 10 }, (_, i) => i + 1);
  const cutAfter = (n) => latePenaltyDays(n, late) > latePenaltyDays(n - 1, late);
  return (
    <RuleCard
      icon={Clock4}
      tone="amber"
      title="Late arrivals"
      summary={late.enabled
        ? `${late.freeLates} free, then every ${late.every} late${late.every === 1 ? '' : 's'} = ${late.penalty === 'full' ? '1 day' : '½ day'} cut`
        : 'Off — coming late never cuts pay'}
      right={<Switch checked={late.enabled} onChange={(v) => set({ enabled: v })} ariaLabel="Late arrival rule" />}
      muted={!late.enabled}
    >
      <Sentence>
        The first
        <NumberChip value={late.freeLates} min={0} max={31} onCommit={(v) => set({ freeLates: v })} ariaLabel="free lates" />
        late{late.freeLates === 1 ? '' : 's'} in a month are free. After that, every
        <NumberChip value={late.every} min={1} max={31} onCommit={(v) => set({ every: v })} ariaLabel="lates per cut" />
        late{late.every === 1 ? '' : 's'} cost
        <PillGroup
          size="sm"
          className="mx-1 align-middle"
          ariaLabel="Penalty"
          value={late.penalty}
          onChange={(v) => set({ penalty: v })}
          options={[{ value: 'half', label: '½ day' }, { value: 'full', label: '1 day' }]}
        />
        of pay.
      </Sentence>
      <div className="mt-3 flex flex-wrap items-center gap-1.5" aria-label="Example: ten lates">
        {preview.map((n) => {
          const free = n <= late.freeLates;
          const cut = cutAfter(n);
          return (
            <span
              key={n}
              title={free ? 'Free' : cut ? 'Pay cut here' : 'Counts toward the next cut'}
              className={cn(
                'flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-bold transition-all',
                free ? 'bg-success/15 text-success' : cut ? 'scale-110 bg-danger text-white shadow' : 'bg-warning/15 text-warning',
              )}
            >
              {n}
            </span>
          );
        })}
        <span className="ml-1 text-[11px] text-fg-subtle">
          10 lates → <b className="text-fg">{latePenaltyDays(10, late)} day{latePenaltyDays(10, late) === 1 ? '' : 's'}</b> of pay
        </span>
      </div>
      <p className="mt-2 text-[11px] text-fg-subtle">
        Late = checked in after the shift start plus the grace period (Settings → Attendance). Half days don&apos;t count — they already cost half a day.
      </p>
    </RuleCard>
  );
}

/** Overtime: off, paid at a multiple of the hourly rate, or comp-off days. */
export function OvertimeCard({ overtime, onChange, perDay }) {
  const set = (patch) => onChange({ ...overtime, ...patch });
  const hourly = perDay / 9;
  return (
    <RuleCard
      icon={Hourglass}
      tone="violet"
      title="Overtime"
      summary={overtime.mode === 'off' ? 'Off — extra hours are recorded, not paid'
        : overtime.mode === 'pay' ? `Paid at ${overtime.multiplier}× the hourly rate`
          : `${overtime.compOffHours}h of overtime = 1 Comp Off day`}
      right={(
        <PillGroup
          size="sm"
          ariaLabel="Overtime"
          value={overtime.mode}
          onChange={(v) => set({ mode: v })}
          options={[{ value: 'off', label: 'Off' }, { value: 'pay', label: 'Pay' }, { value: 'comp_off', label: 'Comp-off' }]}
        />
      )}
    >
      {overtime.mode === 'off' ? (
        <p className="text-xs text-fg-subtle">Hours past the shift still show on attendance — they just don&apos;t add pay or leave.</p>
      ) : (
        <div className="space-y-1">
          {overtime.mode === 'pay' ? (
            <Sentence>
              Pay
              <PillGroup
                size="sm"
                className="mx-1 align-middle"
                ariaLabel="Multiplier"
                value={overtime.multiplier}
                onChange={(v) => set({ multiplier: v })}
                options={[1, 1.5, 2].map((m) => ({ value: m, label: `${m}×` }))}
              />
              the hourly rate
              <Tag className="mx-1" tone="primary">≈ {formatCurrency(hourly * overtime.multiplier)}/h on ₹30k</Tag>
              for overtime.
            </Sentence>
          ) : (
            <Sentence>
              Every
              <NumberChip value={overtime.compOffHours} min={1} max={24} onCommit={(v) => set({ compOffHours: v })} suffix="h" ariaLabel="hours per comp-off day" />
              of overtime earns
              <Tag className="mx-1" tone="primary">1 Comp Off day</Tag>
              (half days count), added when the payslip is published.
            </Sentence>
          )}
          <Sentence>
            Count a day only if it has at least
            <NumberChip value={overtime.minMinutes} min={0} max={600} step={15} onCommit={(v) => set({ minMinutes: v })} suffix="min" width="w-12" ariaLabel="minimum overtime minutes" />
            extra, up to
            <NumberChip value={overtime.monthlyCapHours} min={0} max={744} step={5} onCommit={(v) => set({ monthlyCapHours: v })} suffix="h" ariaLabel="monthly cap" />
            a month{overtime.monthlyCapHours ? '' : <span className="text-fg-subtle"> (0 = no cap)</span>}.
          </Sentence>
          <p className="text-[11px] text-fg-subtle">
            Forgotten check-outs never earn overtime. Overtime starts after the hours set in Settings → Attendance.
          </p>
        </div>
      )}
    </RuleCard>
  );
}

/** Weekly offs: tap a day to make it an off day; pick which weeks for alternate offs. */
export function WeeklyOffsCard({ workWeek, onChange }) {
  const now = new Date();
  const working = countWorkingDays(now.getFullYear(), now.getMonth() + 1, workWeek);
  const monthName = now.toLocaleString('en-US', { month: 'long' });
  const toggleDay = (dow) => {
    const next = { ...workWeek.offDays };
    if (next[dow]) delete next[dow]; else next[dow] = 'all';
    if (Object.keys(next).length === 7) return; // a week needs at least one working day
    onChange({ offDays: next });
  };
  const toggleWeek = (dow, w) => {
    const rule = workWeek.offDays[dow];
    let weeks = rule === 'all' ? [1, 2, 3, 4, 5] : [...rule];
    weeks = weeks.includes(w) ? weeks.filter((x) => x !== w) : [...weeks, w].sort();
    const next = { ...workWeek.offDays };
    if (!weeks.length) delete next[dow];
    else next[dow] = weeks.length === 5 ? 'all' : weeks;
    onChange({ offDays: next });
  };
  const order = [1, 2, 3, 4, 5, 6, 0];
  const offList = order.filter((d) => workWeek.offDays[d]);
  return (
    <RuleCard
      icon={CalendarOff}
      tone="teal"
      title="Weekly offs"
      summary={`${describeWorkWeek(workWeek)} · ${working} working days in ${monthName}`}
    >
      <div className="flex flex-wrap gap-2">
        {order.map((dow) => {
          const rule = workWeek.offDays[dow];
          return (
            <button
              key={dow}
              type="button"
              aria-pressed={Boolean(rule)}
              onClick={() => toggleDay(dow)}
              className={cn(
                'relative flex h-14 w-14 flex-col items-center justify-center rounded-2xl text-xs font-bold transition-all duration-200',
                rule
                  ? 'bg-gradient-to-br from-teal to-primary text-white shadow-md'
                  : 'border border-border bg-muted/40 text-fg-muted hover:border-primary/40 hover:text-fg',
              )}
            >
              {DAY_SHORT[dow]}
              <span className={cn('mt-0.5 text-[9px] font-semibold uppercase tracking-wide', rule ? 'text-white/80' : 'text-fg-subtle')}>
                {rule ? (rule === 'all' ? 'off' : 'some') : 'work'}
              </span>
            </button>
          );
        })}
      </div>
      {offList.length > 0 && (
        <div className="mt-4 space-y-2">
          {offList.map((dow) => {
            const rule = workWeek.offDays[dow];
            return (
              <div key={dow} className="flex flex-wrap items-center gap-2 rounded-2xl bg-muted/40 px-3 py-2">
                <span className="w-24 text-xs font-semibold text-fg">{DAY_SHORT[dow]} off on</span>
                {[1, 2, 3, 4, 5].map((w) => {
                  const on = rule === 'all' || rule.includes(w);
                  return (
                    <button
                      key={w}
                      type="button"
                      aria-pressed={on}
                      onClick={() => toggleWeek(dow, w)}
                      className={cn(
                        'rounded-full px-2.5 py-1 text-[11px] font-semibold transition-colors',
                        on ? 'bg-primary text-on-primary' : 'bg-card text-fg-subtle ring-1 ring-border hover:text-fg',
                      )}
                    >
                      {ORDINALS[w]}
                    </button>
                  );
                })}
                <span className="text-[11px] text-fg-subtle">{rule === 'all' ? 'every week' : 'only these weeks'}</span>
              </div>
            );
          })}
        </div>
      )}
      <p className="mt-3 text-[11px] text-fg-subtle">
        Used everywhere: attendance doesn&apos;t mark anyone absent on a weekly off, nobody gets an absent email, and the per-day pay rate leaves them out.
      </p>
    </RuleCard>
  );
}

/** How one day's pay is worked out. */
export function DayRateCard({ basis, fixedDays, onChange, onFixedDays, workWeek }) {
  const now = new Date();
  const working = countWorkingDays(now.getFullYear(), now.getMonth() + 1, workWeek);
  const calendar = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const divisor = basis === 'calendar' ? calendar : basis === 'fixed' ? fixedDays : working;
  return (
    <RuleCard
      icon={Coins}
      tone="primary"
      title="Day rate"
      summary={`₹30,000 ÷ ${divisor} = ${formatCurrency(SAMPLE_GROSS / divisor)} a day — what one absent day costs`}
    >
      <PillGroup
        ariaLabel="Day rate basis"
        value={basis}
        onChange={onChange}
        options={[
          { value: 'working', label: `Working days (${working})`, icon: CalendarDays },
          { value: 'calendar', label: `Calendar days (${calendar})` },
          { value: 'fixed', label: 'Fixed days' },
        ]}
      />
      {basis === 'fixed' && (
        <Sentence className="mt-2">
          Every month counts as
          <NumberChip value={fixedDays} min={1} max={31} onCommit={onFixedDays} ariaLabel="fixed days per month" />
          days (26 and 30 are common).
        </Sentence>
      )}
      <p className="mt-2 text-[11px] text-fg-subtle">
        {basis === 'working' && 'Changes with each month and your weekly offs. Holidays count as paid working days.'}
        {basis === 'calendar' && 'Every day of the month counts, weekly offs included — a smaller cut per absent day.'}
        {basis === 'fixed' && 'The same divisor every month, however many working days it has.'}
      </p>
    </RuleCard>
  );
}

/** What a forgotten check-out counts as. */
export function MissedCheckoutCard({ value, onChange }) {
  return (
    <RuleCard
      icon={TimerReset}
      tone="sky"
      title="Forgot to check out"
      summary={value === 'half' ? 'Counts as a half day' : 'Counts as a full shift, no overtime'}
      right={(
        <PillGroup
          size="sm"
          ariaLabel="Forgotten check-out"
          value={value}
          onChange={onChange}
          options={[{ value: 'full', label: 'Full shift' }, { value: 'half', label: 'Half day' }]}
        />
      )}
    >
      <p className="text-xs text-fg-subtle">
        The day closes on its own at 4 AM (or when a biometric day ends). It used to count the whole night — 15–17 hours with overtime.
      </p>
    </RuleCard>
  );
}

/** Leaving before the shift ends. */
export function EarlyLeaveCard({ value, onChange }) {
  return (
    <RuleCard
      icon={DoorOpen}
      tone="rose"
      title="Leaving early"
      summary={value ? 'Leaving before the shift ends = half day' : 'Short days under half the shift are half days; otherwise an early departure'}
      right={<Switch checked={value} onChange={onChange} label={['No', 'Yes']} ariaLabel="Leaving early is a half day" />}
    >
      <p className="text-xs text-fg-subtle">
        Strict mode: any check-out before the shift&apos;s full hours makes it a half day (web check-in).
      </p>
    </RuleCard>
  );
}

/** Absences use casual leave before they cost pay. */
export function LeaveFirstCard({ value, onChange }) {
  return (
    <RuleCard
      icon={Palmtree}
      tone="teal"
      title="Use casual leave first"
      summary={value ? 'Unplanned absences use Casual Leave, then cost pay' : 'Off — every unplanned absence is loss of pay'}
      right={<Switch checked={value} onChange={onChange} ariaLabel="Use casual leave first" />}
    >
      <p className="text-xs text-fg-subtle">
        The draft payslip shows which absent days Casual Leave covers. The leave is taken only when the payslip is published, and the
        days then appear as approved leave. Same switch as Settings → Leave Policy.
      </p>
    </RuleCard>
  );
}
