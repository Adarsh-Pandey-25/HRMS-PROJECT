/**
 * What attendance hands payroll on days of approved leave (independent
 * review, 2 Nov 2026): a half day worked next to approved half-day leave,
 * or a late check-in after a morning off, costs no extra pay. The counts the
 * attendance screens show stay as they were.
 *
 * The database is a stand-in: every table returns the rows put in
 * global.__mockTables (filters are not applied, so each table holds only
 * the rows this test needs). Nothing is sent.
 */
// Never read backend/.env (the live database's keys) in a test.
jest.mock('dotenv', () => ({ config: () => ({ parsed: {} }) }));
jest.mock('../../src/config/supabase', () => {
  const builder = (table) => {
    const rows = () => (global.__mockTables?.[table] || []);
    const q = {};
    for (const m of ['select', 'eq', 'neq', 'in', 'gte', 'lte', 'gt', 'lt', 'order', 'range', 'limit', 'is', 'not', 'or', 'ilike', 'filter', 'match', 'contains']) {
      q[m] = () => q;
    }
    q.maybeSingle = () => Promise.resolve({ data: rows()[0] ?? null, error: null });
    q.single = () => Promise.resolve({ data: rows()[0] ?? null, error: null });
    q.then = (resolve, reject) => Promise.resolve({ data: rows(), error: null, count: rows().length }).then(resolve, reject);
    return q;
  };
  return { supabaseAdmin: { from: (t) => builder(t), rpc: () => Promise.resolve({ data: null, error: null }) } };
});
jest.mock('../../src/services/email.service', () => new Proxy({}, {
  get: (_t, prop) => (prop === '__esModule' || prop === 'then' ? undefined : () => Promise.resolve()),
}));
jest.mock('../../src/utils/logger', () => new Proxy({}, {
  get: (_t, prop) => (prop === '__esModule' || prop === 'then' ? undefined : () => {}),
}));

const attendance = require('../../src/services/attendance.service');
const { settingsKey } = require('../../src/utils/tenant');

const checkIn = (date, time, hours, status) => {
  const inAt = new Date(`${date}T${time}:00+05:30`);
  const outAt = new Date(inAt.getTime() + hours * 3600 * 1000);
  return {
    id: `${date}-${time}`,
    employee_id: 'e1',
    check_in_time: inAt.toISOString(),
    check_out_time: outAt.toISOString(),
    total_hours: hours,
    overtime_hours: 0,
    status,
    checkout_status: 'finalized',
    location: null,
  };
};

beforeAll(() => {
  global.__mockTables = {
    employees: [{ id: 'e1', company_id: 'c1', address: {}, date_of_joining: '2026-01-01' }],
    attendance: [
      checkIn('2026-10-15', '14:00', 4.5, 'half_day'), // approved half-day leave in the morning
      checkIn('2026-10-16', '14:00', 4.5, 'late'), // approved half-day leave in the morning, came in after lunch
      checkIn('2026-10-20', '09:30', 4, 'half_day'), // no leave: a real half day
    ],
    leaves: [
      { from_date: '2026-10-15', to_date: '2026-10-15', leave_type: 'CL', status: 'approved', is_half_day: true },
      { from_date: '2026-10-16', to_date: '2026-10-16', leave_type: 'CL', status: 'approved', is_half_day: true },
    ],
    holidays: [],
    // The Leave Policy has a custom unpaid type (Paid: No).
    system_settings: [{ key: settingsKey('c1', 'leave_policy'), value: [{ code: 'CL', paid: true }, { code: 'LWP', name: 'Leave without pay', paid: false }] }],
  };
});
afterAll(() => { delete global.__mockTables; });

test('a half day or late arrival on a day of approved leave costs no extra pay; the screens still show them', async () => {
  const { summary } = await attendance.getMonthlySummary('e1', 10, 2026);
  // Shown as before
  expect(summary.halfDay).toBe(2);
  expect(summary.late).toBe(1);
  // For pay: only 20 Oct is an unpaid half day, and no late arrival counts
  expect(summary.payHalfDay).toBe(1);
  expect(summary.payHalfDayDates).toEqual(['2026-10-20']);
  expect(summary.payLate).toBe(0);
  expect(summary.leaveDates).toEqual(['2026-10-15', '2026-10-16']);
});

test('UNPAID leave is not a cover: a half day next to unpaid half-day leave still costs half a day', async () => {
  const saved = global.__mockTables.leaves;
  global.__mockTables.leaves = [{ from_date: '2026-10-15', to_date: '2026-10-15', leave_type: 'UNPAID', status: 'approved', is_half_day: true }];
  try {
    const { summary } = await attendance.getMonthlySummary('e1', 10, 2026);
    expect(summary.payHalfDayDates).toEqual(['2026-10-15', '2026-10-20']);
    expect(summary.payLate).toBe(1);
  } finally {
    global.__mockTables.leaves = saved;
  }
});

test('unpaid half-day leave on a day worked: that half is unpaid, and the late check-in after it is not lateness', async () => {
  const saved = global.__mockTables.leaves;
  // 16 Oct: came in after lunch (shown as late, a full day's check-in) after a morning of unpaid half-day leave.
  global.__mockTables.leaves = [{ from_date: '2026-10-16', to_date: '2026-10-16', leave_type: 'LWP', status: 'approved', is_half_day: true }];
  try {
    const { summary } = await attendance.getMonthlySummary('e1', 10, 2026);
    expect(summary.payHalfDayDates).toEqual(['2026-10-15', '2026-10-16', '2026-10-20']);
    expect(summary.payHalfDay).toBe(3);
    expect(summary.payLate).toBe(0);
    expect(summary.late).toBe(1); // the screens still show it
    expect(summary.unpaidLeaveDates).toEqual(['2026-10-16']);
  } finally {
    global.__mockTables.leaves = saved;
  }
});

test('a half day or late arrival on a holiday, a weekly off or before joining costs no pay', async () => {
  const saved = { ...global.__mockTables };
  global.__mockTables.leaves = [];
  global.__mockTables.employees = [{ id: 'e1', company_id: 'c1', address: {}, date_of_joining: '2026-10-08' }];
  global.__mockTables.holidays = [{ date: '2026-10-21', company_id: 'c1' }];
  global.__mockTables.attendance = [
    checkIn('2026-10-06', '09:30', 4, 'half_day'), // Tuesday, before joining on 8 Oct
    checkIn('2026-10-18', '09:30', 4, 'half_day'), // Sunday
    checkIn('2026-10-21', '11:30', 8, 'late'), // a company holiday
    checkIn('2026-10-22', '09:30', 4, 'half_day'), // an ordinary Thursday: a real half day
  ];
  try {
    const { summary } = await attendance.getMonthlySummary('e1', 10, 2026);
    expect(summary.payHalfDayDates).toEqual(['2026-10-22']);
    expect(summary.payLate).toBe(0);
    // The screens still show what happened.
    expect(summary.halfDay).toBe(3);
    expect(summary.late).toBe(1);
  } finally {
    Object.assign(global.__mockTables, saved);
  }
});

test('half-day leave with no work that day leaves the other half unpaid; a Paid: No leave type is unpaid', async () => {
  const saved = global.__mockTables.leaves;
  global.__mockTables.leaves = [
    { from_date: '2026-10-22', to_date: '2026-10-22', leave_type: 'CL', status: 'approved', is_half_day: true }, // no check-in that day
    { from_date: '2026-10-23', to_date: '2026-10-23', leave_type: 'LWP', status: 'approved', is_half_day: false },
  ];
  try {
    const { summary } = await attendance.getMonthlySummary('e1', 10, 2026);
    expect(summary.payHalfDayDates).toEqual(['2026-10-15', '2026-10-20', '2026-10-22']);
    expect(summary.absentDates).toContain('2026-10-23');
    expect(summary.unpaidLeaveDates).toEqual(['2026-10-23']);
    expect(summary.leaveDates).toEqual(['2026-10-22']);
  } finally {
    global.__mockTables.leaves = saved;
  }
});
