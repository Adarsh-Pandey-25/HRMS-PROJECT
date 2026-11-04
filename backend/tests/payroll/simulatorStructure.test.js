/**
 * The pay simulator's sample salary is split the way the company structures
 * salaries (Settings → Payroll → Salary structure: parts on or off, HRA and
 * DA a % of Basic; Basic a % of the pay from the CTC template), with what is
 * on screen winning over what is saved. A part switched off isn't shown at
 * ₹0. Figures by hand first. The database is an in-memory stand-in; nothing
 * is stored or sent.
 */
// Never read backend/.env (the live database's keys) in a test.
jest.mock('dotenv', () => ({ config: () => ({ parsed: {} }) }));
jest.mock('../../src/config/supabase', () => {
  const make = (table) => {
    const state = { filters: [] };
    const rows = () => global.__db[table] || [];
    const run = () => ({ data: rows().filter((r) => state.filters.every(([f, v]) => String(r[f]) === String(v))), error: null });
    const q = {};
    for (const m of ['select', 'order', 'in', 'gte', 'lte', 'neq', 'limit']) q[m] = () => q;
    q.eq = (f, v) => { state.filters.push([f, v]); return q; };
    q.maybeSingle = () => Promise.resolve({ data: run().data[0] ?? null, error: null });
    q.then = (resolve, reject) => Promise.resolve(run()).then(resolve, reject);
    return q;
  };
  return { supabaseAdmin: { from: (t) => make(t) } };
});
jest.mock('../../src/utils/logger', () => new Proxy({}, {
  get: (_t, prop) => (prop === '__esModule' || prop === 'then' ? undefined : () => {}),
}));

const payroll = require('../../src/services/payroll.service');
const settingsService = require('../../src/services/settings.service');
const { settingsKey } = require('../../src/utils/tenant');

const withSettings = async (config = {}) => {
  global.__db = {
    payroll_components: [],
    system_settings: [{ key: settingsKey('c1', 'payroll_config'), value: { pt_state: 'Karnataka', pt_state_set: true, ...config } }],
  };
  await settingsService.ensureCache(true);
};
// October 2026, every day worked: each part is paid in full.
const lines = async (body) => {
  const r = await payroll.simulatePay('c1', { month: 10, year: 2026, scenario: {}, ...body });
  return r.breakdown_json.earnings.map((e) => [e.name, e.amount]);
};
beforeAll(() => {
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] }).setSystemTime(new Date('2026-11-03T10:00:00+05:30'));
});
afterAll(() => { jest.useRealTimers(); delete global.__db; });

test('the standard structure: ₹30,000 → Basic 15,000 (50%), HRA 6,000 (40%), DA 1,500 (10%), Special 7,500', async () => {
  await withSettings({ hra_percent: 40, da_percent: 10 });
  expect(await lines({ gross: 30000 })).toEqual([['Basic', 15000], ['HRA', 6000], ['DA', 1500], ['Special Allowance', 7500]]);
});

test('HRA, DA and Special Allowance switched off: ₹12 lakh a year ÷ 12 is all Basic, and no HRA ₹0 line', async () => {
  await withSettings({ components: { hra: false, da: false, special: false } });
  expect(await lines({ gross: 100000 })).toEqual([['Basic', 100000]]);
});

test('Special Allowance off: Basic takes the rest — ₹28,000 → Basic 20,000 + HRA 40% 8,000', async () => {
  await withSettings({ hra_percent: 40, components: { hra: true, da: false, special: false } });
  expect(await lines({ gross: 28000 })).toEqual([['Basic', 20000], ['HRA', 8000]]);
});

test('the structure on screen, not saved yet, wins: Basic 40%, HRA 50%, DA off — ₹50,000 → 20,000 + 10,000 + 20,000', async () => {
  await withSettings({ hra_percent: 40, da_percent: 10 });
  const overrides = { components: { hra: true, da: false, special: true }, hraPercent: 50, calc: { ctcTemplate: { basicPercent: 40 } } };
  expect(await lines({ gross: 50000, overrides })).toEqual([['Basic', 20000], ['HRA', 10000], ['Special Allowance', 20000]]);
});

test('never more than the pay: HRA and DA 100% of Basic — ₹10,000 → Basic 5,000 + HRA 5,000, DA and Special nothing', async () => {
  await withSettings();
  expect(await lines({ gross: 10000, overrides: { hraPercent: 100, daPercent: 100 } })).toEqual([['Basic', 5000], ['HRA', 5000]]);
});

test('a payslip shows HRA at ₹0 while HRA is on, and not once the company switched it off', async () => {
  await withSettings();
  expect(await lines({ salary: { basic: 20000 } })).toEqual([['Basic', 20000], ['HRA', 0]]);
  await withSettings({ components: { hra: false } });
  expect(await lines({ salary: { basic: 20000 } })).toEqual([['Basic', 20000]]);
  // An HRA amount still saved on the employee is paid and shown, switched off or not.
  expect(await lines({ salary: { basic: 20000, hra: 8000 } })).toEqual([['Basic', 20000], ['HRA', 8000]]);
});
