import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  addDays, addMonths, addYears, differenceInCalendarDays, format, isSameDay, isSameMonth, isValid, parseISO, startOfMonth, startOfWeek,
} from 'date-fns';
import { ChevronLeft, ChevronRight, Palmtree, CalendarDays, LayoutGrid, List, Plus, Pencil, Trash2 } from 'lucide-react';
import {
  PageHeader, Card, CardHeader, Button, EmptyState, Skeleton, SegmentedControl, Badge, Modal, ConfirmDialog, Input, Select,
} from '../../components/ui';
import {
  fetchHolidaysByYearApi, fetchUpcomingHolidaysApi, createHolidayApi, updateHolidayApi, deleteHolidayApi,
} from '../../api/holidays.api';
import { useAuthStore } from '../../store/authStore';
import { invalidateAndRefetch } from '../../lib/queryCache';
import { cn } from '../../lib/utils';

/**
 * Company holidays as a real calendar (month grid, year overview, list),
 * like Google Calendar. Each year is loaded on its own as you move through
 * the calendar. HR and admins can add, edit and delete holidays right here
 * — the same holidays, and the same calls, as Settings → Leave Policy; no
 * one is notified.
 */

const TYPES = {
  public: { label: 'Public holiday', chip: 'bg-primary/10 text-primary', dot: 'bg-primary', tone: 'primary' },
  optional: { label: 'Optional holiday', chip: 'bg-warning/15 text-warning', dot: 'bg-warning', tone: 'warning' },
  restricted: { label: 'Restricted holiday', chip: 'bg-info/12 text-info', dot: 'bg-info', tone: 'info' },
};
const typeKey = (h) => (TYPES[h?.type] ? h.type : 'public');
const typeOf = (h) => TYPES[typeKey(h)];
// The same choices as Settings → Leave Policy.
const TYPE_OPTIONS = [
  { value: 'public', label: 'Public / National' },
  { value: 'optional', label: 'Optional' },
  { value: 'restricted', label: 'Restricted' },
];
const MAX_NAME = 100;
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const VIEWS = [
  { value: 'month', label: 'Month', icon: CalendarDays },
  { value: 'year', label: 'Year', icon: LayoutGrid },
  { value: 'list', label: 'List', icon: List },
];
const COMING_UP = 6;

const keyOf = (d) => format(d, 'yyyy-MM-dd');
const dayKeyOf = (h) => String(h?.date || '').slice(0, 10);
const dateOf = (h) => parseISO(dayKeyOf(h));

/** "Today", "Tomorrow", "in 7 days", "3 days ago". */
const whenFrom = (date, today) => {
  const days = differenceInCalendarDays(date, today);
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  if (days === -1) return 'Yesterday';
  return days > 0 ? `in ${days} days` : `${-days} days ago`;
};

function useYearHolidays(year, enabled = true) {
  return useQuery({
    queryKey: ['holidays', year],
    queryFn: () => fetchHolidaysByYearApi(year),
    enabled: enabled && Boolean(year),
    staleTime: 5 * 60_000,
  });
}

/** One small month of the year view: holidays coloured, today ringed. */
function MiniMonth({ year, month, byDate, today, onPickDay, onOpenMonth }) {
  const first = new Date(year, month, 1);
  const start = startOfWeek(first);
  const days = Array.from({ length: 42 }, (_, i) => addDays(start, i));
  const count = days.filter((d) => isSameMonth(d, first) && byDate.has(keyOf(d))).length;
  return (
    <div className="rounded-xl border border-border/60 p-3">
      <button type="button" onClick={() => onOpenMonth(first)} className="mb-2 flex w-full items-center justify-between text-left">
        <span className="text-sm font-semibold text-fg hover:text-primary">{format(first, 'MMMM')}</span>
        {count > 0 && <span className="text-[11px] text-fg-subtle">{count} {count === 1 ? 'holiday' : 'holidays'}</span>}
      </button>
      <div className="grid grid-cols-7 gap-0.5 text-center">
        {DOW.map((d) => <span key={d} className="text-[10px] font-medium text-fg-subtle">{d[0]}</span>)}
        {days.map((d) => {
          const inMonth = isSameMonth(d, first);
          const holiday = inMonth ? byDate.get(keyOf(d))?.[0] : null;
          return (
            <button
              key={keyOf(d)}
              type="button"
              disabled={!inMonth}
              title={holiday ? holiday.name : undefined}
              onClick={() => onPickDay(d)}
              className={cn(
                'mx-auto flex h-6 w-6 items-center justify-center rounded-full text-[11px] tabular-nums',
                !inMonth && 'invisible',
                holiday ? cn(typeOf(holiday).chip, 'font-semibold') : 'text-fg-muted hover:bg-muted',
                isSameDay(d, today) && !holiday && 'ring-1 ring-primary text-primary font-semibold',
                isSameDay(d, today) && holiday && 'ring-2 ring-offset-1 ring-primary',
              )}
            >
              {format(d, 'd')}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Add or edit one holiday (HR / admin). */
function HolidayFormModal({ initial, byDate, saving, onClose, onSave }) {
  const [form, setForm] = useState(initial);
  const editing = Boolean(initial.id);

  const submit = () => {
    const name = String(form.name || '').trim();
    if (!name) return toast.error('Give the holiday a name');
    if (name.length > MAX_NAME) return toast.error(`Keep the name under ${MAX_NAME} characters`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(form.date || '') || !isValid(parseISO(form.date))) return toast.error('Pick a date');
    const clash = (byDate.get(form.date) || [])
      .find((h) => h.id !== initial.id && String(h.name || '').trim().toLowerCase() === name.toLowerCase());
    if (clash) return toast.error(`${clash.name} is already on ${format(parseISO(form.date), 'd MMM yyyy')}`);
    return onSave({ ...form, name });
  };

  return (
    <Modal
      open
      onClose={() => { if (!saving) onClose(); }}
      title={editing ? 'Edit holiday' : 'Add holiday'}
      subtitle="It shows on everyone's calendar and counts in attendance and payroll, like holidays added in Settings. No one is notified."
      footer={(
        <>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={submit} loading={saving}>{editing ? 'Save changes' : 'Add holiday'}</Button>
        </>
      )}
    >
      <div className="space-y-4">
        <Input
          label="Holiday name"
          required
          maxLength={MAX_NAME}
          placeholder="e.g. Holi"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
        />
        <Input label="Date" type="date" required value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
        <Select label="Type" options={TYPE_OPTIONS} value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} />
      </div>
    </Modal>
  );
}

export default function HolidayCalendar() {
  const qc = useQueryClient();
  const role = useAuthStore((s) => s.role);
  // The server allows the same (holiday routes: HR or admin).
  const canManage = role === 'admin' || role === 'hr';
  const today = useMemo(() => new Date(), []);
  const [view, setView] = useState('month');
  const [cursor, setCursor] = useState(() => startOfMonth(today));
  const [selected, setSelected] = useState(() => keyOf(today));
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [toDelete, setToDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const year = cursor.getFullYear();

  const { data: holidays = [], isLoading } = useYearHolidays(year);
  const { data: upcoming = [] } = useQuery({ queryKey: ['holidays', 'upcoming'], queryFn: fetchUpcomingHolidaysApi, staleTime: 5 * 60_000 });

  // A month view near the year's edge also shows days of the next or previous
  // year in its grid; those holidays are loaded too.
  const gridStart = startOfWeek(startOfMonth(cursor));
  const gridDays = useMemo(() => Array.from({ length: 42 }, (_, i) => addDays(gridStart, i)), [gridStart.getTime()]); // eslint-disable-line react-hooks/exhaustive-deps
  const edgeYear = [gridDays[0].getFullYear(), gridDays[41].getFullYear()].find((y) => y !== year) || null;
  const { data: edgeHolidays = [] } = useYearHolidays(edgeYear, view === 'month');

  const byDate = useMemo(() => {
    const map = new Map();
    for (const h of [...holidays, ...(view === 'month' ? edgeHolidays : [])]) {
      if (!h?.date) continue;
      map.set(dayKeyOf(h), [...(map.get(dayKeyOf(h)) || []), h]);
    }
    return map;
  }, [holidays, edgeHolidays, view]);

  const yearHolidays = useMemo(
    () => holidays.filter((h) => h?.date).sort((a, b) => dayKeyOf(a).localeCompare(dayKeyOf(b))),
    [holidays],
  );
  const left = yearHolidays.filter((h) => differenceInCalendarDays(dateOf(h), today) >= 0).length;
  const typeCounts = yearHolidays.reduce((acc, h) => ({ ...acc, [typeKey(h)]: (acc[typeKey(h)] || 0) + 1 }), {});
  const comingUp = useMemo(
    () => upcoming.filter((h) => h?.date && differenceInCalendarDays(dateOf(h), today) >= 0)
      .sort((a, b) => dayKeyOf(a).localeCompare(dayKeyOf(b)))
      .slice(0, COMING_UP),
    [upcoming, today],
  );
  const next = comingUp[0] || null;

  const step = (n) => setCursor((c) => (view === 'month' ? addMonths(c, n) : addYears(c, n)));
  const goToday = () => { setCursor(startOfMonth(today)); setSelected(keyOf(today)); };
  const openDay = (d) => { setCursor(startOfMonth(d)); setSelected(keyOf(d)); setView('month'); };

  const selectedDate = parseISO(selected);
  const selectedHolidays = byDate.get(selected) || [];
  const title = view === 'month' ? format(cursor, 'MMMM yyyy') : String(year);

  const saveHoliday = async (values) => {
    setSaving(true);
    try {
      if (values.id) await updateHolidayApi(values.id, values);
      else await createHolidayApi(values);
      toast.success(values.id ? 'Holiday updated' : 'Holiday added');
      setForm(null);
      openDay(parseISO(values.date));
      // Every holiday list in the app (this calendar, Settings, My Attendance).
      await invalidateAndRefetch(qc, ['holidays']);
    } catch (err) {
      toast.error(err.message || 'Could not save the holiday');
    } finally {
      setSaving(false);
    }
  };

  const deleteHoliday = async () => {
    setDeleting(true);
    try {
      await deleteHolidayApi(toDelete.id);
      toast.success('Holiday deleted');
      setToDelete(null);
      await invalidateAndRefetch(qc, ['holidays']);
    } catch (err) {
      toast.error(err.message || 'Could not delete the holiday');
    } finally {
      setDeleting(false);
    }
  };

  const editHoliday = (h) => setForm({ id: h.id, name: h.name || '', date: dayKeyOf(h), type: typeKey(h) });

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Holiday Calendar"
        subtitle={`${yearHolidays.length} ${yearHolidays.length === 1 ? 'holiday' : 'holidays'} in ${year}${year === today.getFullYear() ? ` · ${left} still to come` : ''}`}
      />

      {next && (
        <button
          type="button"
          onClick={() => openDay(dateOf(next))}
          className="flex w-full items-center gap-3 rounded-card border border-primary/20 bg-primary/5 px-4 py-3 text-left transition-colors hover:bg-primary/10"
        >
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Palmtree className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <p className="text-xs text-fg-subtle">Next holiday</p>
            <p className="truncate text-sm font-semibold text-fg">
              {next.name} · {format(dateOf(next), 'EEEE, d MMM')}
              <span className="ml-2 font-normal text-fg-muted">{whenFrom(dateOf(next), today)}</span>
            </p>
          </div>
        </button>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_280px]">
        <Card className="p-4 sm:p-5">
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={goToday}>Today</Button>
              <button type="button" aria-label="Previous" onClick={() => step(-1)} className="rounded-lg p-1.5 text-fg-muted transition-colors hover:bg-muted hover:text-fg">
                <ChevronLeft className="h-5 w-5" />
              </button>
              <button type="button" aria-label="Next" onClick={() => step(1)} className="rounded-lg p-1.5 text-fg-muted transition-colors hover:bg-muted hover:text-fg">
                <ChevronRight className="h-5 w-5" />
              </button>
              <h2 className="ml-1 text-lg font-semibold text-fg">{title}</h2>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <SegmentedControl options={VIEWS} value={view} onChange={setView} />
              {canManage && (
                <Button size="sm" icon={Plus} onClick={() => setForm({ name: '', date: selected, type: 'public' })}>Add holiday</Button>
              )}
            </div>
          </div>

          {isLoading ? (
            <Skeleton className="h-96 rounded-xl" />
          ) : view === 'month' ? (
            <>
              <div className="grid grid-cols-7 overflow-hidden rounded-xl border-l border-t border-border/60">
                {DOW.map((d) => (
                  <div key={d} className="border-b border-r border-border/60 bg-muted/40 py-2 text-center text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">{d}</div>
                ))}
                {gridDays.map((d) => {
                  const key = keyOf(d);
                  const inMonth = isSameMonth(d, cursor);
                  const dayHolidays = byDate.get(key) || [];
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setSelected(key)}
                      className={cn(
                        'min-h-[64px] border-b border-r border-border/60 p-1 text-left align-top transition-colors sm:min-h-[96px] sm:p-1.5',
                        inMonth ? 'bg-card hover:bg-muted/40' : 'bg-muted/25 hover:bg-muted/40',
                        selected === key && 'bg-primary/5 ring-1 ring-inset ring-primary/40',
                      )}
                    >
                      <span className={cn(
                        'inline-flex h-6 w-6 items-center justify-center rounded-full text-xs tabular-nums',
                        isSameDay(d, today) ? 'bg-primary font-semibold text-on-primary' : inMonth ? 'text-fg' : 'text-fg-subtle',
                      )}
                      >
                        {format(d, 'd')}
                      </span>
                      <div className="mt-1 space-y-1">
                        {dayHolidays.map((h) => (
                          <span key={h.id || h.name} className={cn('hidden truncate rounded-md px-1.5 py-0.5 text-[11px] font-medium sm:block', typeOf(h).chip)}>
                            {h.name}
                          </span>
                        ))}
                        {dayHolidays.length > 0 && <span className={cn('mx-auto block h-1.5 w-1.5 rounded-full sm:hidden', typeOf(dayHolidays[0]).dot)} />}
                      </div>
                    </button>
                  );
                })}
              </div>

              <div className="mt-4 rounded-xl bg-muted/40 px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs text-fg-subtle">{format(selectedDate, 'EEEE, d MMMM yyyy')} · {whenFrom(selectedDate, today)}</p>
                  {canManage && selectedHolidays.length === 0 && (
                    <Button size="sm" variant="outline" icon={Plus} onClick={() => setForm({ name: '', date: selected, type: 'public' })}>
                      Add a holiday on this day
                    </Button>
                  )}
                </div>
                {selectedHolidays.length === 0 ? (
                  <p className="mt-0.5 text-sm text-fg-muted">No holiday on this day.</p>
                ) : selectedHolidays.map((h) => (
                  <div key={h.id || h.name} className="mt-2 flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-fg">{h.name}</span>
                    <Badge tone={typeOf(h).tone}>{typeOf(h).label}</Badge>
                    {canManage && h.id && (
                      <span className="ml-auto flex items-center gap-1">
                        <Button size="sm" variant="ghost" icon={Pencil} onClick={() => editHoliday(h)}>Edit</Button>
                        <Button size="sm" variant="ghost" icon={Trash2} onClick={() => setToDelete(h)}>Delete</Button>
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </>
          ) : view === 'year' ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
              {Array.from({ length: 12 }, (_, m) => (
                <MiniMonth
                  key={m}
                  year={year}
                  month={m}
                  byDate={byDate}
                  today={today}
                  onPickDay={openDay}
                  onOpenMonth={(first) => { setCursor(first); setView('month'); }}
                />
              ))}
            </div>
          ) : yearHolidays.length === 0 ? (
            <EmptyState
              icon={Palmtree}
              title={`No holidays in ${year}`}
              message={canManage ? 'Use Add holiday to put one on the calendar.' : 'Your HR team adds the company holidays.'}
            />
          ) : (
            <div className="space-y-2">
              {yearHolidays.map((h) => {
                const date = dateOf(h);
                const past = differenceInCalendarDays(date, today) < 0;
                return (
                  <div key={h.id || `${h.name}-${h.date}`} className={cn('flex items-center gap-2 rounded-xl border border-border/60 p-3 transition-colors hover:bg-muted/40', past && 'opacity-60')}>
                    <button type="button" onClick={() => openDay(date)} className="flex min-w-0 flex-1 items-center gap-4 text-left">
                      <div className={cn('flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-xl', typeOf(h).chip)}>
                        <span className="text-[10px] font-semibold uppercase">{format(date, 'MMM')}</span>
                        <span className="text-lg font-bold leading-none">{format(date, 'd')}</span>
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-fg">{h.name}</p>
                        <p className="text-xs text-fg-subtle">{format(date, 'EEEE')} · {whenFrom(date, today)}</p>
                      </div>
                    </button>
                    <Badge tone={typeOf(h).tone}>{typeOf(h).label}</Badge>
                    {canManage && h.id && (
                      <span className="flex items-center">
                        <button type="button" aria-label={`Edit ${h.name}`} onClick={() => editHoliday(h)} className="rounded-lg p-1.5 text-fg-muted transition-colors hover:bg-muted hover:text-fg">
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button type="button" aria-label={`Delete ${h.name}`} onClick={() => setToDelete(h)} className="rounded-lg p-1.5 text-fg-muted transition-colors hover:bg-muted hover:text-danger">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2">
            {Object.entries(TYPES)
              .filter(([key]) => key !== 'restricted' || typeCounts.restricted)
              .map(([key, t]) => (
                <span key={key} className="flex items-center gap-1.5 text-xs text-fg-muted">
                  <span className={cn('h-2.5 w-2.5 rounded-full', t.dot)} />
                  {t.label} ({typeCounts[key] || 0})
                </span>
              ))}
            <span className="flex items-center gap-1.5 text-xs text-fg-muted">
              <span className="flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[9px] font-semibold text-on-primary">{format(today, 'd')}</span>
              Today
            </span>
          </div>
        </Card>

        <Card className="h-fit">
          <CardHeader title="Coming up" subtitle="The next company holidays" />
          <div className="space-y-1 p-3 pt-1">
            {comingUp.length === 0 ? (
              <p className="px-2 py-3 text-sm text-fg-subtle">No more holidays planned yet.</p>
            ) : comingUp.map((h) => {
              const date = dateOf(h);
              return (
                <button
                  key={h.id || `${h.name}-${h.date}`}
                  type="button"
                  onClick={() => openDay(date)}
                  className="flex w-full items-center gap-3 rounded-xl p-2 text-left transition-colors hover:bg-muted"
                >
                  <div className={cn('flex h-10 w-10 shrink-0 flex-col items-center justify-center rounded-lg', typeOf(h).chip)}>
                    <span className="text-[9px] font-semibold uppercase">{format(date, 'MMM')}</span>
                    <span className="text-sm font-bold leading-none">{format(date, 'd')}</span>
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-fg">{h.name}</p>
                    <p className="text-xs text-fg-subtle">{format(date, 'EEE')} · {whenFrom(date, today)}</p>
                  </div>
                </button>
              );
            })}
          </div>
        </Card>
      </div>

      {form && (
        <HolidayFormModal
          key={form.id || `new-${form.date}`}
          initial={form}
          byDate={byDate}
          saving={saving}
          onClose={() => setForm(null)}
          onSave={saveHoliday}
        />
      )}

      <ConfirmDialog
        open={Boolean(toDelete)}
        onClose={() => { if (!deleting) setToDelete(null); }}
        onConfirm={deleteHoliday}
        title={`Delete ${toDelete?.name || 'this holiday'}?`}
        message="It disappears from everyone's calendar and stops counting as a holiday in attendance and payroll. No one is notified."
        confirmLabel="Delete holiday"
        loading={deleting}
      />
    </div>
  );
}
