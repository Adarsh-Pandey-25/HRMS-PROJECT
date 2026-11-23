/**
 * Owner's request: a default shift and a 30-minute late-arrival buffer,
 * shown and editable in Settings → Attendance Config → Shift Timings & Late
 * Buffer. A check-in up to 30 minutes after the shift starts is on time;
 * later is Late.
 *
 * Lateness used to be a fixed "after 10:00" (09:30 + 30 min). The setting
 * that replaced it (attendance_config.gracePeriodMinutes) defaulted to 15,
 * and a company with no saved shifts saw three sample shifts in Settings
 * that attendance never used.
 *
 * Check-outs go through the real attendance.service checkOut on an
 * in-memory database, with the clock set by the test. No .env, no network.
 */
jest.mock('dotenv', () => ({ config: () => ({ parsed: {} }) }));
jest.mock('../../src/config/supabase', () => ({ supabaseAdmin: { from: (...a) => mockDb.current.from(...a) } }));
jest.mock('../../src/utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));
jest.mock('../../src/services/email.service', () => new Proxy({}, {
  get: (_t, prop) => (prop === '__esModule' || prop === 'then' ? undefined : () => Promise.resolve()),
}));
jest.mock('../../src/services/featureOverride.service', () => ({ hasFeature: async () => false, getDataCollectionMode: async () => 'continue' }));
jest.mock('../../src/services/auditLog.service', () => ({ auditFromRequest: () => {}, logAudit: async () => {} }));
jest.mock('../../src/services/settings.service', () => {
  const store = new Map();
  const get = (key, companyId) => store.get(`${companyId}:${key}`);
  return {
    getSetting: async (key, fallback, companyId) => get(key, companyId) ?? fallback,
    getBoolean: async (key, fallback, companyId) => get(key, companyId) ?? fallback,
    listSettingsForCompany: async (companyId) => ({
      data: [...store.entries()]
        .filter(([k]) => k.startsWith(`${companyId}:`))
        .map(([k, value]) => ({ key: k.slice(companyId.length + 1), value })),
      error: null,
    }),
    __set: (companyId, key, value) => store.set(`${companyId}:${key}`, value),
    __reset: () => store.clear(),
  };
});
// The clock checkOut reads; everything else in helpers is the real thing.
jest.mock('../../src/utils/helpers', () => ({
  ...jest.requireActual('../../src/utils/helpers'),
  nowIST: () => mockClock.now.clone(),
}));

const mockDb = { current: null };
const mockClock = { now: null };

const moment = require('moment-timezone');
const { makeFakeSupabase } = require('./helpers/fakeSupabase');
const settingsService = require('../../src/services/settings.service');
const attendanceService = require('../../src/services/attendance.service');
const settingsController = require('../../src/controllers/settings.controller');

const IST = 'Asia/Kolkata';
const DAY = '2026-11-23';
const at = (hm, day = DAY) => moment.tz(`${day} ${hm}`, 'YYYY-MM-DD HH:mm', IST);

let tables;

beforeEach(() => {
  settingsService.__reset();
  tables = { employees: [], attendance: [] };
  mockDb.current = makeFakeSupabase(tables);
});

/** One web day: check in at `checkInHm`, check out a full shift (9 h) later. Returns the day's status. */
const statusOfDay = async (checkInHm, { address = {}, hours = 9 } = {}) => {
  const checkIn = at(checkInHm);
  tables.employees = [{ id: 'e1', company_id: 'c1', role: 'employee', address }];
  tables.attendance = [{
    id: 'a1', employee_id: 'e1', company_id: 'c1', check_in_time: checkIn.toISOString(),
    check_out_time: null, check_in_method: 'web', status: 'present', location: null,
  }];
  mockClock.now = checkIn.clone().add(hours, 'hours');
  const row = await attendanceService.checkOut('e1', {});
  return row.status;
};

/** What GET /api/settings sends the Settings page for attendance_config. */
const settingsPageConfig = async () => {
  let body;
  const res = { status: () => res, json: (b) => { body = b; return res; } };
  await settingsController.getAll({ user: { company_id: 'c1' } }, res, (err) => { throw err; });
  return body.data.find((row) => row.key === 'attendance_config')?.value;
};

describe('defaults when the company has saved nothing', () => {
  test('one General Shift 09:30–18:30 and a 30-minute buffer', async () => {
    const cfg = await attendanceService.getAttendanceConfig('c1');
    expect(cfg.gracePeriodMinutes).toBe(30);
    expect(cfg.shifts).toEqual([
      expect.objectContaining({ name: 'General Shift', start: '09:30', end: '18:30', active: true, isDefault: true }),
    ]);
    const rules = attendanceService.shiftRulesFor({}, cfg);
    expect(rules).toEqual(expect.objectContaining({ shiftStart: '09:30', expectedHours: 9, gracePeriodMinutes: 30 }));
  });

  test('Settings is sent the same default shift and buffer', async () => {
    const value = await settingsPageConfig();
    expect(value.gracePeriodMinutes).toBe(30);
    expect(value.shifts).toEqual([expect.objectContaining({ name: 'General Shift', start: '09:30', end: '18:30' })]);
  });

  test('a saved config without shifts or a buffer still gets both, and keeps everything else', async () => {
    settingsService.__set('c1', 'attendance_config', { selfieRequired: true, shifts: [] });
    const cfg = await attendanceService.getAttendanceConfig('c1');
    expect(cfg.gracePeriodMinutes).toBe(30);
    expect(cfg.shifts[0]).toEqual(expect.objectContaining({ start: '09:30', end: '18:30' }));
    const value = await settingsPageConfig();
    expect(value).toEqual(expect.objectContaining({ selfieRequired: true, gracePeriodMinutes: 30 }));
    expect(value.shifts[0]).toEqual(expect.objectContaining({ start: '09:30' }));
  });

  test('check-in at 09:59 (start + 29 min) is on time; 10:01 (start + 31 min) is Late', async () => {
    expect(await statusOfDay('09:59')).toBe('present');
    expect(await statusOfDay('10:01')).toBe('late');
  });

  test('exactly start + 30 min is still on time', async () => {
    expect(await statusOfDay('10:00')).toBe('present');
  });

  test('the half-day rule still comes first: late and short hours is a half day', async () => {
    expect(await statusOfDay('10:01', { hours: 4 })).toBe('half_day');
  });
});

describe('a saved buffer is used', () => {
  test('a 10-minute buffer: 09:39 on time, 09:41 Late, and 09:59 is now Late', async () => {
    settingsService.__set('c1', 'attendance_config', { gracePeriodMinutes: 10 });
    expect((await attendanceService.getAttendanceConfig('c1')).gracePeriodMinutes).toBe(10);
    expect((await settingsPageConfig()).gracePeriodMinutes).toBe(10);
    expect(await statusOfDay('09:39')).toBe('present');
    expect(await statusOfDay('09:41')).toBe('late');
    expect(await statusOfDay('09:59')).toBe('late');
  });

  test('editing the buffer changes the result: 10:01 is Late at 30, on time at 45', async () => {
    settingsService.__set('c1', 'attendance_config', { gracePeriodMinutes: 30 });
    expect(await statusOfDay('10:01')).toBe('late');
    settingsService.__set('c1', 'attendance_config', { gracePeriodMinutes: 45 });
    expect(await statusOfDay('10:01')).toBe('present');
  });

  test('0 means no buffer: 09:31 is Late', async () => {
    settingsService.__set('c1', 'attendance_config', { gracePeriodMinutes: 0 });
    expect((await attendanceService.getAttendanceConfig('c1')).gracePeriodMinutes).toBe(0);
    expect(await statusOfDay('09:31')).toBe('late');
  });

  test('the older snake_case key is read too; a blank or negative value falls back to 30', async () => {
    settingsService.__set('c1', 'attendance_config', { grace_period_minutes: 20 });
    expect((await attendanceService.getAttendanceConfig('c1')).gracePeriodMinutes).toBe(20);
    settingsService.__set('c1', 'attendance_config', { gracePeriodMinutes: '' });
    expect((await attendanceService.getAttendanceConfig('c1')).gracePeriodMinutes).toBe(30);
    settingsService.__set('c1', 'attendance_config', { gracePeriodMinutes: -5 });
    expect((await attendanceService.getAttendanceConfig('c1')).gracePeriodMinutes).toBe(30);
  });
});

describe('saved shifts', () => {
  const shifts = [
    { id: 'SHIFT-G', name: 'General Shift', start: '10:00', end: '19:00', active: true },
    { id: 'SHIFT-N', name: 'Night Shift', start: '22:00', end: '07:00', active: true },
  ];

  test('an edited default shift moves the on-time line: 10:29 on time, 10:31 Late', async () => {
    settingsService.__set('c1', 'attendance_config', { shifts });
    expect(await statusOfDay('10:29')).toBe('present');
    expect(await statusOfDay('10:31')).toBe('late');
  });

  test('the buffer counts from each employee\'s own shift start (night shift 22:00)', async () => {
    settingsService.__set('c1', 'attendance_config', { shifts });
    const address = { shift_id: 'SHIFT-N', shift: 'Night Shift' };
    expect(await statusOfDay('22:29', { address })).toBe('present');
    expect(await statusOfDay('22:31', { address })).toBe('late');
  });

  test('saved shifts are sent to Settings as they are, not replaced by the default', async () => {
    settingsService.__set('c1', 'attendance_config', { shifts, gracePeriodMinutes: 15 });
    const value = await settingsPageConfig();
    expect(value.shifts).toEqual(shifts);
    expect(value.gracePeriodMinutes).toBe(15);
  });
});
