/**
 * Audit, 20 Nov 2026: the onboarding jobs ran at every start (and every 12
 * hours), so each deploy re-sent the pre-joining email and gave that day's
 * joiners a new temporary password, logging them out. Each job now sends once
 * a day, and the day-one email spares a temporary password that still works.
 * In-memory database; nothing is sent.
 */
jest.mock('dotenv', () => ({ config: () => ({ parsed: {} }) }));
jest.mock('../../src/config/supabase', () => ({ supabaseAdmin: { from: (...a) => mockDb.current.from(...a) } }));
jest.mock('../../src/utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));
jest.mock('../../src/utils/cronLock', () => ({ withCronLock: (_name, _ms, fn) => fn }));
jest.mock('../../src/utils/cronAlert', () => ({ alertOnCronFailure: async () => {} }));
jest.mock('../../src/services/email.service', () => ({
  prejoiningEmail: jest.fn(async () => {}),
  dayOneEmail: jest.fn(async () => {}),
}));
jest.mock('../../src/services/emailPreferences.service', () => ({ isEmailEnabled: async () => true }));
jest.mock('../../src/services/auth.service', () => ({ bumpTokenVersion: jest.fn(async () => {}) }));
jest.mock('../../src/services/settings.service', () => {
  const store = new Map();
  return {
    getSetting: async (key) => (store.has(key) ? store.get(key) : null),
    setSetting: async (key, value) => { store.set(key, value); return { error: null }; },
    __reset: () => store.clear(),
  };
});

const mockDb = { current: null };
const moment = require('moment-timezone');
const { makeFakeSupabase } = require('./helpers/fakeSupabase');
const emailService = require('../../src/services/email.service');
const authService = require('../../src/services/auth.service');
const settingsService = require('../../src/services/settings.service');
const { runPrejoiningCheck, runDayOneCheck } = require('../../src/cron/onboarding.cron');

const IST = 'Asia/Kolkata';
const day = (offset) => moment().tz(IST).add(offset, 'days').format('YYYY-MM-DD');
let tables;

beforeEach(() => {
  tables = {
    employees: [
      { id: 'joiner', first_name: 'Asha', email: 'asha@acme.test', company_id: 'c1', date_of_joining: day(0), must_change_password: true, password_hash: 'old', temp_password_expires_at: null },
      { id: 'already', first_name: 'Ravi', email: 'ravi@acme.test', company_id: 'c1', date_of_joining: day(0), must_change_password: true, password_hash: 'given', temp_password_expires_at: new Date(Date.now() + 24 * 3600e3).toISOString() },
      { id: 'soon', first_name: 'Neha', email: 'neha@acme.test', company_id: 'c1', date_of_joining: day(2), must_change_password: true, password_hash: 'x', temp_password_expires_at: null },
    ],
  };
  mockDb.current = makeFakeSupabase(tables);
  jest.clearAllMocks();
  settingsService.__reset();
});

const row = (id) => tables.employees.find((e) => e.id === id);

test('day one: credentials go once; a restart the same day sends nothing and keeps the password', async () => {
  const first = await runDayOneCheck('startup');
  expect(first.sent).toBe(1);
  expect(emailService.dayOneEmail).toHaveBeenCalledTimes(1);
  expect(emailService.dayOneEmail.mock.calls[0][0].id).toBe('joiner');
  const hash = row('joiner').password_hash;
  expect(hash).not.toBe('old');
  expect(authService.bumpTokenVersion).toHaveBeenCalledTimes(1);

  const again = await runDayOneCheck('startup');
  expect(again.skipped).toBe('already_ran_today');
  expect(emailService.dayOneEmail).toHaveBeenCalledTimes(1);
  expect(row('joiner').password_hash).toBe(hash);
  expect(authService.bumpTokenVersion).toHaveBeenCalledTimes(1);
});

test('day one: someone whose temporary password still works is left alone', async () => {
  await runDayOneCheck('cron');
  expect(row('already').password_hash).toBe('given');
  expect(emailService.dayOneEmail.mock.calls.map((c) => c[0].id)).not.toContain('already');
});

test('pre-joining: the reminder goes once a day', async () => {
  await runPrejoiningCheck('startup');
  await runPrejoiningCheck('interval');
  expect(emailService.prejoiningEmail).toHaveBeenCalledTimes(1);
  expect(emailService.prejoiningEmail.mock.calls[0][0].id).toBe('soon');
});
