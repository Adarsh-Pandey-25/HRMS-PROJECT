/**
 * A yearly CTC split into a monthly salary by the company's template: Basic a
 * % of CTC, HRA and DA a % of Basic, Special Allowance balancing — worked out
 * with the real calculation, the company's CTC composition included. Figures
 * by hand first. The database is an in-memory stand-in. Nothing is sent.
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

const withSettings = async (config, calc = null) => {
  global.__db = {
    payroll_components: [],
    system_settings: [
      { key: settingsKey('c1', 'payroll_config'), value: { pt_state: 'Karnataka', pt_state_set: true, ...config } },
      ...(calc ? [{ key: settingsKey('c1', 'payroll_calc'), value: calc }] : []),
    ],
  };
  await settingsService.ensureCache(true);
};
beforeAll(() => {
  // EPF rules of November 2026 (₹25,000 ceiling), whenever the test runs.
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] }).setSystemTime(new Date('2026-11-03T10:00:00+05:30'));
});
afterAll(() => { jest.useRealTimers(); delete global.__db; });

test('₹6,00,000 a year: Basic 25,000, HRA 10,000, DA 2,500, Special 7,927 → CTC 49,999.12 a month', async () => {
  // Employer PF on 25,000 (Basic + DA 27,500, capped): 3,000 + EDLI 125 + admin 125 = 3,250; no ESI (over ₹21,000);
  // gratuity 27,500 × 15 ÷ 312 = 1,322.12; no bonus (wages over ₹21,000). 37,500 + S + 4,572.12 ≤ 50,000 → S = 7,927.
  await withSettings({ hra_percent: 40, da_percent: 10 });
  expect(await payroll.splitCtc('c1', { annualCtc: 600000 })).toEqual({
    annualCtc: 600000,
    basicPercent: 50,
    monthly: { basic: 25000, hra: 10000, da: 2500, special: 7927 },
    monthlyGross: 45427,
    monthlyCtc: 49999.12,
    leftOver: 0.88,
  });
});

test('₹2,40,000 a year (inside ESI): Special 1,908 → CTC 19,999.95', async () => {
  // Basic 10,000, HRA 4,000, DA 1,000: PF on 11,000 → 1,320 + EDLI 55 + admin 55 = 1,430; gratuity 528.85;
  // bonus 8.33% × 7,000 = 583.10; employer ESI 3.25% × 16,908 = 549.51 → 550. 15,000 + 1,908 + 3,091.95 = 19,999.95.
  await withSettings({ hra_percent: 40, da_percent: 10 });
  const r = await payroll.splitCtc('c1', { annualCtc: 240000 });
  expect(r.monthly).toEqual({ basic: 10000, hra: 4000, da: 1000, special: 1908 });
  expect(r).toMatchObject({ monthlyCtc: 19999.95, leftOver: 0.05 });
});

test('the company\'s own template and CTC composition; what can\'t work is refused', async () => {
  // 40% Basic, no DA, the CTC without gratuity: Basic 20,000, HRA 8,000. Basic is under half of the pay, so the
  // 50% rule adds back (S − 12,000) ÷ 2. At S = 18,949: gross 46,949, PF wages 20,000 + 3,474.50 = 23,474.50;
  // employer PF 2,817 (EPS 1,955 + EPF 862) + EDLI 117 + admin 117 = 3,051 → CTC 50,000.00 exactly.
  // (At 18,950: PF wages 23,475, same 3,051 → 50,001, over.) Wages over ₹21,000: no bonus.
  await withSettings({ hra_percent: 40, components: { da: false } }, { ctcTemplate: { basicPercent: 40 }, ctc: { gratuity: false } });
  const r = await payroll.splitCtc('c1', { annualCtc: 600000 });
  expect(r.monthly).toEqual({ basic: 20000, hra: 8000, da: 0, special: 18949 });
  expect(r).toMatchObject({ basicPercent: 40, monthlyCtc: 50000, leftOver: 0 });
  await expect(payroll.splitCtc('c1', { annualCtc: 'abc' })).rejects.toThrow(/yearly CTC/);
  await expect(payroll.splitCtc('c1', { annualCtc: 600000, basicPercent: 0 })).rejects.toThrow(/between 0% and 100%/);
});
