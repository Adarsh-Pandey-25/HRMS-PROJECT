/**
 * TDS without a PAN (Income-tax Act 2025 s.397(2), was s.206AA): the year's
 * TDS is the higher of the normal tax and 20% of the projected taxable
 * income — nothing when no tax is due — spread over the months left, so a
 * PAN added mid-year brings it back to normal from that month. A company
 * setting, on by default. The database is a stand-in: each table returns the
 * rows in global.__mockTables (filters not applied). Expected rupee figures
 * were worked out by hand first.
 */
// Never read backend/.env (the live database's keys) in a test.
jest.mock('dotenv', () => ({ config: () => ({ parsed: {} }) }));
jest.mock('../../src/config/supabase', () => {
  const builder = (table) => {
    const rows = () => (global.__mockTables?.[table] || []);
    const q = {};
    for (const m of ['select', 'eq', 'neq', 'in', 'gte', 'lte', 'gt', 'lt', 'order', 'range', 'limit', 'is', 'not', 'or', 'ilike', 'filter', 'match']) {
      q[m] = () => q;
    }
    q.maybeSingle = () => Promise.resolve({ data: rows()[0] ?? null, error: null });
    q.single = () => Promise.resolve({ data: rows()[0] ?? null, error: null });
    q.then = (resolve, reject) => Promise.resolve({ data: rows(), error: null }).then(resolve, reject);
    return q;
  };
  return { supabaseAdmin: { from: (t) => builder(t) } };
});
jest.mock('../../src/services/email.service', () => new Proxy({}, {
  get: (_t, prop) => (prop === '__esModule' || prop === 'then' ? undefined : () => Promise.resolve()),
}));
jest.mock('../../src/services/storage.service', () => ({
  uploadPayslip: async () => ({ path: 'x' }), getSignedUrl: async () => 'x', STORAGE_BUCKETS: { payslips: 'payslips' },
}));
jest.mock('../../src/utils/logger', () => new Proxy({}, {
  get: (_t, prop) => (prop === '__esModule' || prop === 'then' ? undefined : () => {}),
}));

const payroll = require('../../src/services/payroll.service');
const companyRules = require('../../src/payroll/companyRules');
const { resolveTaxProfile, projectMonthlyTds, hasValidPan } = require('../../src/payroll/tds');
const { getTdsRegister, getForm138Csv } = require('../../src/services/tdsRegister.service');
const { normalizePayrollRules } = require('../../src/utils/payrollRules');
const { normalizeWorkWeek } = require('../../src/utils/workWeek');

const R = (rupees) => Math.round(rupees * 100);
const NEW = resolveTaxProfile({}, '2026-27');
const OLD = resolveTaxProfile({ tax_profile: { years: { '2026-27': { regime: 'old' } } } }, '2026-27');
const history = (h = {}) => ({
  salaryPaid: 0, tdsPaid: 0, ptPaid: 0, earlierDrafts: [], monthsCounted: [], ...h,
});
/** April 2026, the same pay all year, nothing paid before. */
const april = (profile, monthly, extra = {}) => projectMonthlyTds({
  month: 4, year: 2026, profile, thisMonth: R(monthly), futureMonthly: R(monthly), futureMonths: 11, history: history(), ...extra,
});

describe('the rule (payroll/tds.js)', () => {
  test('₹12 lakh a year on the old regime, no PAN: the higher of the tax ₹1,63,800 and 20% of ₹11,50,000 = ₹2,30,000', () => {
    // 12,00,000 − 50,000 = 11,50,000 taxable; 12,500 + 1,00,000 + 30% × 1,50,000 (45,000) = 1,57,500 + cess 6,300 = 1,63,800.
    const normal = april(OLD, 100000);
    expect(normal.tds).toBe(R(13650)); // 1,63,800 ÷ 12
    const noPan = april(OLD, 100000, { noPan: true });
    expect(noPan.worksheet).toMatchObject({
      taxable_income: R(1150000), annual_tax: R(163800), no_pan: true, no_pan_tds: R(230000), tds_target: R(230000), higher_rate_applied: true,
    });
    expect(noPan.tds).toBe(R(19167)); // 2,30,000 ÷ 12 = 19,166.67
  });

  test('₹18 lakh a year on the new regime: 20% of ₹17,25,000 = ₹3,45,000 instead of ₹1,50,800', () => {
    // 17,25,000 taxable: 20,000 + 40,000 + 60,000 + 20% × 1,25,000 (25,000) = 1,45,000 + cess 5,800 = 1,50,800.
    const t = april(NEW, 150000, { noPan: true });
    expect(t.worksheet).toMatchObject({ annual_tax: R(150800), no_pan_tds: R(345000), tds_target: R(345000) });
    expect(t.tds).toBe(R(28750));
  });

  test('₹12 lakh a year on the new regime is covered by the rebate: no tax, so no TDS, PAN or not', () => {
    const t = april(NEW, 100000, { noPan: true });
    expect(t.worksheet).toMatchObject({
      taxable_income: R(1125000), annual_tax: 0, no_pan_tds: 0, tds_target: 0, higher_rate_applied: false,
    });
    expect(t.tds).toBe(0);
  });

  test('when the normal tax is above 20% of the income, it stays the normal tax', () => {
    const normal = april(NEW, 1000000);
    const t = april(NEW, 1000000, { noPan: true });
    expect(t.worksheet.higher_rate_applied).toBe(false);
    expect(t.worksheet.tds_target).toBe(t.worksheet.annual_tax);
    expect(t.tds).toBe(normal.tds);
  });

  test('a PAN added in May: from then on the normal tax, less what April deducted at 20%', () => {
    // April deducted 28,750 at 20%. May with a PAN: (1,50,800 − 28,750) ÷ 11 = 11,095.45 → 11,095.
    const may = (noPan) => projectMonthlyTds({
      month: 5, year: 2026, profile: NEW, thisMonth: R(150000), futureMonthly: R(150000), futureMonths: 10, history: history({ salaryPaid: R(150000), tdsPaid: R(28750) }), noPan,
    });
    expect(may(false).tds).toBe(R(11095));
    expect(may(true).tds).toBe(R(28750)); // still none: (3,45,000 − 28,750) ÷ 11
  });

  test('a PAN is 5 letters, 4 digits and a letter; anything else is no PAN', () => {
    expect(hasValidPan('ABCDE1234F')).toBe(true);
    expect(hasValidPan('abcde1234f')).toBe(true);
    expect(hasValidPan('ABCD1234')).toBe(false);
    expect(hasValidPan('ABCDE12345')).toBe(false);
    expect(hasValidPan('')).toBe(false);
    expect(hasValidPan(null)).toBe(false);
  });

  test('the company setting: on unless switched off', () => {
    expect(companyRules.resolveCompanyCalc(null).tds.noPanHigherTds).toBe(true);
    expect(companyRules.resolveCompanyCalc({ tds: { noPanHigherTds: false } }).tds.noPanHigherTds).toBe(false);
    expect(companyRules.normalizeCompanyCalc({ tds: { noPanHigherTds: 'no' } }).tds.noPanHigherTds).toBeNull();
  });
});

describe('on the payslip', () => {
  const ctxWith = (extra = {}) => ({
    companyId: 'c1',
    workingDaysSetting: 26,
    payrollConfig: {},
    pfPolicy: 'statutory_ceiling',
    esiApplicable: false,
    tdsPolicy: 'projected',
    ptState: 'Karnataka',
    ptManualAmount: null,
    ptManualSlabs: null,
    ptStateUnconfirmed: false,
    choicesMade: { pf: true, esi: true, tds: true, pt: true },
    rules: normalizePayrollRules({}),
    workWeek: normalizeWorkWeek(null),
    leaveFirst: false,
    components: [],
    ...extra,
  });
  // ₹1,50,000 a month (₹18 lakh a year), new regime; no PT, so PT tables don't matter here.
  const salary = {
    basic: 75000, hra: 30000, special: 45000, pt_applicable: false,
  };
  const slip = (ctx, pan, { month = 4, h = {} } = {}) => payroll.computePayslip(ctx, {
    employee: { id: 'e1', gender: 'male', salary_details: { ...salary, ...(pan === undefined ? {} : { statutory_ids: { pan } }) } },
    summary: {},
    records: [],
    month,
    year: 2026,
    history: { tax: history(h) },
  });
  const cfg = (out) => out.breakdown_json.config;

  test('no PAN: TDS at 20% (₹28,750 in April), with the line on the payslip and a warning for HR', () => {
    const out = slip(ctxWith());
    expect(out.tds).toBe(28750);
    expect(cfg(out).tax).toMatchObject({
      annual_tax: 150800, no_pan: true, no_pan_tds: 345000, tds_target: 345000, higher_rate_applied: true, tds: 28750, applied: true,
    });
    expect(cfg(out).payslip_notes).toEqual([
      'TDS at 20% — no PAN on file (Income-tax Act 2025 s.397(2)). Once a PAN is recorded, TDS goes back to the normal rate from that month.',
    ]);
    expect(cfg(out).warnings.find((w) => w.code === 'tds_no_pan').message).toMatch(/higher of the tax \(₹1,50,800\) and 20% of the taxable income \(₹3,45,000\)/);
  });

  test('a PAN that isn\'t one counts as none; a valid PAN pays the normal rate (₹1,50,800 ÷ 12 = 12,567)', () => {
    expect(slip(ctxWith(), 'ABCD1234').tds).toBe(28750);
    expect(slip(ctxWith(), 'ABCDE12345').tds).toBe(28750);
    const withPan = slip(ctxWith(), 'ABCDE1234F');
    expect(withPan.tds).toBe(12567);
    expect(cfg(withPan).tax.no_pan).toBe(false);
    expect(cfg(withPan).payslip_notes).toBeNull();
  });

  test('the setting switched off: the normal rate, recorded as departing from the law', () => {
    const out = slip(ctxWith({ calc: { tds: { noPanHigherTds: false } } }));
    expect(out.tds).toBe(12567);
    expect(cfg(out).company_values).toEqual([{
      key: 'tds.noPanHigherTds', label: 'TDS without a PAN', law: 'at least 20%', company: 'the normal rate',
    }]);
    expect(cfg(out).warnings.map((w) => w.code)).toEqual(['company_values']);
  });

  test('a PAN added in May: TDS back to normal from that month (₹11,095)', () => {
    expect(slip(ctxWith(), 'ABCDE1234F', { month: 5, h: { salaryPaid: R(150000), tdsPaid: R(28750) } }).tds).toBe(11095);
  });

  test('income covered by the rebate: no TDS without a PAN either', () => {
    const out = payroll.computePayslip(ctxWith(), {
      employee: { id: 'e1', salary_details: { basic: 50000, special: 50000, pt_applicable: false } },
      summary: {},
      records: [],
      month: 4,
      year: 2026,
      history: { tax: history() },
    });
    expect(out.tds).toBe(0);
    expect(cfg(out).payslip_notes).toBeNull();
  });

  test('a sample salary (no employee on record) is worked out as if it had a PAN', () => {
    const out = payroll.computePayslip(ctxWith(), {
      employee: { id: null, salary_details: salary }, summary: {}, records: [], month: 4, year: 2026, history: { tax: history() },
    });
    expect(out.tds).toBe(12567);
  });
});

describe('the TDS register and the Form 138 data file', () => {
  beforeAll(() => {
    const tax = (extra) => ({ tax: { regime: 'new', annual_tax: 150800, ...extra } });
    global.__mockTables = {
      payroll: [
        {
          id: 'p1', employee_id: 'e1', company_id: 'c1', month: 4, year: 2026, gross_salary: 150000, tds: 28750, payslip_status: 'PUBLISHED',
          published_at: '2026-05-05T05:00:00Z', breakdown_json: { config: tax({ no_pan: true, higher_rate_applied: true }) },
        },
        {
          id: 'p2', employee_id: 'e2', company_id: 'c1', month: 4, year: 2026, gross_salary: 150000, tds: 12567, payslip_status: 'PUBLISHED',
          published_at: '2026-05-05T05:00:00Z', breakdown_json: { config: tax({ no_pan: false }) },
        },
      ],
      employees: [
        { id: 'e1', first_name: 'Asha', last_name: 'Rao', employee_code: 'E1', salary_details: { statutory_ids: { pan: 'ABCD1234' } } },
        { id: 'e2', first_name: 'Ravi', last_name: 'K', employee_code: 'E2', salary_details: { statutory_ids: { pan: 'ABCDE1234F' } } },
      ],
    };
  });
  afterAll(() => { delete global.__mockTables; });

  test('a PAN that isn\'t valid is written as PANNOTAVBL and counted as missing', async () => {
    const { csv } = await getForm138Csv('c1', '2026-27', 'Q1');
    const lines = csv.trim().split('\r\n');
    expect(lines.find((l) => l.startsWith('E1,'))).toBe('E1,Asha Rao,PANNOTAVBL,Apr 2026,2026-05-05,150000.00,28750.00,392 (salary),new');
    expect(lines.find((l) => l.startsWith('E2,'))).toMatch(/^E2,Ravi K,ABCDE1234F,/);
    const r = await getTdsRegister('c1', '2026-27');
    expect(r.withoutPan).toBe(1);
    expect(r.employees.find((e) => e.employeeId === 'e1')).toMatchObject({ pan: 'ABCD1234', panValid: false, higherRateNoPan: true });
    expect(r.employees.find((e) => e.employeeId === 'e2')).toMatchObject({ panValid: true, higherRateNoPan: false });
  });
});
