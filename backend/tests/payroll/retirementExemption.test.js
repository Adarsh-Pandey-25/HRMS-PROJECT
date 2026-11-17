/**
 * The tax-free part of a leaver's gratuity and leave encashment (audit #14):
 * the exemption rules themselves (pure), and the payslip's TDS on what is
 * left. Every figure was worked out by hand first. Both regimes; employees
 * other than government's.
 */
// Never read backend/.env (the live database's keys) in a test.
jest.mock('dotenv', () => ({ config: () => ({ parsed: {} }) }));
jest.mock('../../src/config/supabase', () => ({ supabaseAdmin: { from: () => { throw new Error('no database in these tests'); } } }));
jest.mock('../../src/services/email.service', () => new Proxy({}, {
  get: (_t, prop) => (prop === '__esModule' || prop === 'then' ? undefined : () => Promise.resolve()),
}));
jest.mock('../../src/utils/logger', () => new Proxy({}, {
  get: (_t, prop) => (prop === '__esModule' || prop === 'then' ? undefined : () => {}),
}));

const { gratuityExemption, leaveEncashmentExemption, exemptOneTimePaise } = require('../../src/payroll/retirementExemption');
const { RETIREMENT_EXEMPTIONS, TAX_YEARS, retirementExemptionsFor } = require('../../src/payroll/taxRules');
const { computeFullAndFinal } = require('../../src/payroll/fullAndFinal');
const payroll = require('../../src/services/payroll.service');
const { normalizePayrollRules } = require('../../src/utils/payrollRules');
const { normalizeWorkWeek } = require('../../src/utils/workWeek');

const R = (rupees) => Math.round(rupees * 100);
const L = R(100000);

describe('the limits are yearly figures in the tax rules, not numbers in the calculation', () => {
  test('₹20 lakh gratuity, ₹25 lakh encashment, 10 months, 30 days a year — every tax year', () => {
    expect(RETIREMENT_EXEMPTIONS).toMatchObject({
      gratuityLimit: 20 * L, leaveEncashmentLimit: 25 * L, averageSalaryMonths: 10, leaveDaysPerCompletedYear: 30,
    });
    for (const year of TAX_YEARS) expect(year.retirement.gratuityLimit).toBe(20 * L);
    expect(retirementExemptionsFor(10, 2026)).toBe(TAX_YEARS.find((t) => t.taxYear === '2026-27').retirement);
    // A year not set up yet: the latest year's limits.
    expect(retirementExemptionsFor(6, 2031).gratuityLimit).toBe(20 * L);
  });
});

describe('gratuity', () => {
  test('the audit example: ₹2,88,000 gratuity after 10 years on ₹49,920 Basic — all of it tax-free', () => {
    // 49,920 × 15/26 = 28,800 a year × 10 = 2,88,000 = the statutory gratuity.
    const ex = gratuityExemption({
      amount: R(288000), joinedOn: '2016-10-01', lastWorkingDay: '2026-09-30', lastBasicDa: R(49920), averageBasicDa: R(49920),
    });
    expect(ex).toMatchObject({
      basis: 'act', statutory: R(288000), exempt: R(288000), taxable: 0, limit: 20 * L, completedYears: 10,
    });
  });

  test('above ₹20 lakh only the excess is taxed', () => {
    // A company scheme paying ₹30 lakh; the statutory gratuity is 3,00,000 × 15/26 × 25 = 43,26,923 → limited to ₹20 lakh.
    const ex = gratuityExemption({
      amount: 30 * L, joinedOn: '2001-07-01', lastWorkingDay: '2026-06-30', lastBasicDa: R(300000), averageBasicDa: R(300000),
    });
    expect(ex.statutory).toBe(R(4326923));
    expect(ex.exempt).toBe(20 * L);
    expect(ex.taxable).toBe(10 * L);
  });

  test('more than the statutory formula (a generous company scheme): the extra is taxed', () => {
    // 30 days a year instead of 15: 5,76,000 paid, 2,88,000 statutory.
    const ex = gratuityExemption({
      amount: R(576000), joinedOn: '2016-10-01', lastWorkingDay: '2026-09-30', lastBasicDa: R(49920), averageBasicDa: R(49920),
    });
    expect(ex).toMatchObject({ exempt: R(288000), taxable: R(288000) });
  });

  test('an exemption already used with a previous employer reduces the limit', () => {
    const ex = gratuityExemption({
      amount: R(288000), joinedOn: '2016-10-01', lastWorkingDay: '2026-09-30', lastBasicDa: R(49920), averageBasicDa: R(49920), alreadyUsed: 19 * L,
    });
    expect(ex).toMatchObject({ limit: 1 * L, exempt: 1 * L, taxable: R(188000) });
    // Used up entirely: all of it taxable.
    expect(gratuityExemption({
      amount: R(288000), joinedOn: '2016-10-01', lastWorkingDay: '2026-09-30', lastBasicDa: R(49920), alreadyUsed: 25 * L,
    })).toMatchObject({ exempt: 0, taxable: R(288000) });
  });

  test('not covered by the Act: half a month\'s average salary for each completed year', () => {
    // 10 years 8 months: 10 completed years × 40,000 ÷ 2 = 2,00,000.
    const ex = gratuityExemption({
      amount: R(250000), joinedOn: '2016-02-01', lastWorkingDay: '2026-09-30', lastBasicDa: R(45000), averageBasicDa: R(40000), covered: false,
    });
    expect(ex).toMatchObject({ basis: 'not_covered', completedYears: 10, statutory: R(200000), exempt: R(200000), taxable: R(50000) });
  });
});

describe('leave encashment on leaving', () => {
  test('capped by 10 months\' average salary', () => {
    // Average 40,000: 10 months = 4,00,000. 330 days (11 years allow 330) × 40,000 ÷ 30 = 4,40,000 paid.
    const ex = leaveEncashmentExemption({
      amount: R(440000), leaveDays: 330, completedYears: 11, averageBasicDa: R(40000),
    });
    expect(ex).toMatchObject({ tenMonths: R(400000), cashValue: R(440000), exempt: R(400000), taxable: R(40000) });
  });

  test('capped at 30 days for each completed year of service', () => {
    // 3 completed years: at most 90 of the 120 days count; 90 × 30,000 ÷ 30 = 90,000.
    const ex = leaveEncashmentExemption({
      amount: R(120000), leaveDays: 120, completedYears: 3, averageBasicDa: R(30000),
    });
    expect(ex).toMatchObject({ daysCounted: 90, cashValue: R(90000), exempt: R(90000), taxable: R(30000) });
  });

  test('half days count; within every limit, all of it is tax-free', () => {
    const ex = leaveEncashmentExemption({
      amount: R(8885), leaveDays: 10.5, completedYears: 7, averageBasicDa: R(22000),
    });
    // 10.5 × 22,000 ÷ 30 = 7,700 is the cash value at the average salary.
    expect(ex).toMatchObject({ daysCounted: 10.5, cashValue: R(7700), exempt: R(7700), taxable: R(1185) });
  });

  test('₹25 lakh for a whole working life: an exemption already used reduces it', () => {
    const ex = leaveEncashmentExemption({
      amount: 2 * L, leaveDays: 300, completedYears: 30, averageBasicDa: R(200000), alreadyUsed: R(2450000),
    });
    expect(ex).toMatchObject({ limit: R(50000), exempt: R(50000), taxable: R(150000) });
  });

  test('encashed while still employed: taxable in full', () => {
    expect(leaveEncashmentExemption({
      amount: R(50000), onLeaving: false, leaveDays: 15, completedYears: 5, averageBasicDa: R(100000),
    })).toMatchObject({ exempt: 0, taxable: R(50000) });
  });
});

describe('the settlement carries both parts', () => {
  test('full and final: gratuity and encashment with their exempt and taxable parts', () => {
    const out = computeFullAndFinal({
      joinedOn: '2016-10-01',
      lastWorkingDay: '2026-09-30',
      monthlyBasicDa: R(49920),
      monthlyWages: R(49920),
      monthlyGross: R(99840),
      leaveDays: 30,
      tax: { rules: RETIREMENT_EXEMPTIONS, averageBasicDa: R(49920), exemptionUsed: { gratuity: 0, leaveEncashment: 0 } },
    });
    const g = out.items.find((i) => i.code === 'GRATUITY');
    expect(g).toMatchObject({ amount: R(288000), exempt: R(288000), taxable: 0, exemption: { basis: 'act', statutory: R(288000) } });
    // 30 days × 49,920 ÷ 26 (the company's encashment divisor) = 57,600; tax-free up to 30 × 49,920 ÷ 30 = 49,920.
    const e = out.items.find((i) => i.code === 'LEAVE_ENCASHMENT');
    expect(e).toMatchObject({ amount: R(57600), exempt: R(49920), taxable: R(7680) });
  });

  test('without tax inputs nothing changes (older callers)', () => {
    const out = computeFullAndFinal({
      joinedOn: '2016-10-01', lastWorkingDay: '2026-09-30', monthlyBasicDa: R(49920), monthlyWages: R(49920), monthlyGross: R(99840),
    });
    expect(out.items[0].exempt).toBeUndefined();
  });

  test('a payslip\'s tax-free one-time pay: items not taxable, and the exempt part of the others', () => {
    expect(exemptOneTimePaise([
      { earning: true, amount: 288000, taxable: true, exempt: 288000 },
      { earning: true, amount: 57600, taxable: true, exempt: 49920 },
      { earning: true, amount: 1000, taxable: false },
      { earning: true, amount: 5000, taxable: true },
      { earning: false, amount: 700 },
    ])).toBe(R(288000 + 49920 + 1000));
    expect(exemptOneTimePaise(null)).toBe(0);
  });
});

describe('TDS on the final payslip counts only the taxable part', () => {
  const ctx = {
    companyId: 'c1',
    workingDaysSetting: 26,
    payrollConfig: {},
    pfPolicy: 'statutory_ceiling',
    esiApplicable: true,
    tdsPolicy: 'projected',
    ptState: 'Karnataka',
    ptManualAmount: null,
    ptManualSlabs: null,
    ptStateUnconfirmed: false,
    choicesMade: { pf: true, esi: true, tds: true, pt: true },
    rules: normalizePayrollRules({ dayRateBasis: 'calendar' }),
    workWeek: normalizeWorkWeek(null),
    leaveFirst: false,
    components: [],
  };
  // ₹12 lakh a year (₹1,00,000 a month): April–February paid, leaving 31 March —
  // without the gratuity 11,25,000 taxable after the standard deduction: nil after the rebate.
  const salary = { basic: 49920, special: 50080 };
  const history = { tax: { salaryPaid: R(1100000), tdsPaid: 0, ptPaid: R(2200), earlierDrafts: [], monthsCounted: [] } };
  const gratuity = (extra) => ({
    id: 'g1', kind: 'gratuity', name: 'Gratuity', earning: true, amount: R(288000), taxable: true, pfWage: false, esiWage: false, ...extra,
  });
  const slip = (oneTime) => payroll.computePayslip(ctx, {
    // A PAN on file: TDS at the normal rate (without one it is at least 20%).
    employee: { id: 'e1', gender: 'male', salary_details: { ...salary, statutory_ids: { pan: 'ABCDE1234F' } }, last_working_day: '2027-03-31' },
    summary: {},
    records: [],
    month: 3,
    year: 2027,
    lastWorkingDay: '2027-03-31',
    oneTime,
    history,
  });

  test('the audit example: ₹12 lakh salary and ₹2,88,000 gratuity — no extra TDS', () => {
    const without = slip([]);
    const exempt = slip([gratuity({ exempt: R(288000) })]);
    expect(exempt.tds).toBe(without.tds);
    expect(exempt.breakdown_json.config.tax).toMatchObject({ one_time: 0, one_time_tax: 0 });
    // The payslip shows the gratuity as its tax-free part.
    expect(exempt.breakdown_json.earnings).toContainEqual({ name: 'Gratuity (exempt)', amount: 288000, rate: 0 });
    expect(exempt.breakdown_json.earnings.find((e) => e.name === 'Gratuity (taxable)')).toBeUndefined();
    expect(exempt.breakdown_json.config.one_time[0]).toMatchObject({ amount: 288000, exempt: 288000, taxable_amount: 0 });
    expect(exempt.gross_salary).toBe(without.gross_salary + 288000);
    // Taxed in full (as before the fix): 14,13,000 taxable → 91,950 + 4% cess = 95,628 → ₹95,630 more.
    const taxedInFull = slip([gratuity()]);
    expect(taxedInFull.tds - without.tds).toBe(95630);
  });

  test('partly tax-free: the payslip shows both parts, and TDS is on the taxable part only', () => {
    const part = slip([gratuity({ exempt: R(188000) })]);
    const asTaxable = slip([{ ...gratuity(), amount: R(100000) }]);
    expect(part.breakdown_json.config.tax.one_time).toBe(100000);
    expect(part.tds).toBe(asTaxable.tds);
    expect(part.breakdown_json.earnings).toEqual(expect.arrayContaining([
      { name: 'Gratuity (exempt)', amount: 188000, rate: 0 },
      { name: 'Gratuity (taxable)', amount: 100000, rate: 0 },
    ]));
  });

  test('leave encashed while still employed (no exempt part): taxed in full', () => {
    const encashed = slip([{
      id: 'l1', kind: 'leave_encashment', name: 'Leave encashment', earning: true, amount: R(100000), taxable: true, pfWage: false, esiWage: false,
    }]);
    expect(encashed.breakdown_json.config.tax.one_time).toBe(100000);
    expect(encashed.tds).toBeGreaterThan(slip([]).tds);
  });
});
