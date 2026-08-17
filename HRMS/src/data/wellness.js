import { employees } from './employees';

// ---------------------------------------------------------------------------
//  Employee wellness / mood check-ins — placeholder data for a future
//  pulse-survey feature. Everything here is mocked, no backend.
// ---------------------------------------------------------------------------

export const MOODS = [
  { key: 'great', emoji: '😄', label: 'Great', value: 5, tone: 'success' },
  { key: 'good', emoji: '🙂', label: 'Good', value: 4, tone: 'teal' },
  { key: 'okay', emoji: '😐', label: 'Okay', value: 3, tone: 'info' },
  { key: 'low', emoji: '😕', label: 'Low', value: 2, tone: 'warning' },
  { key: 'stressed', emoji: '😣', label: 'Stressed', value: 1, tone: 'danger' },
];

function pseudo(seed) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = seed.charCodeAt(i) + ((h << 5) - h);
  return Math.abs(h);
}

const CHECKIN_DATES = ['2026-07-02', '2026-07-03', '2026-07-04', '2026-07-06', '2026-07-07', '2026-07-08'];

// Org-wide mock check-ins (everyone but the demo user, whose "today" comes
// from the interactive widget instead) — used to seed team/company widgets.
export const moodCheckins = employees
  .filter((e) => e.status === 'active' || e.status === 'probation')
  .flatMap((e) =>
    CHECKIN_DATES.map((date) => ({
      employeeId: e.id,
      date,
      mood: MOODS[pseudo(`${e.id}-${date}-mood`) % MOODS.length].key,
    }))
  );

export function moodOn(date, employeeIds) {
  const ids = employeeIds ? new Set(employeeIds) : null;
  return moodCheckins.filter((c) => c.date === date && (!ids || ids.has(c.employeeId)));
}
