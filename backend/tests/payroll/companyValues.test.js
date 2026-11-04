/**
 * A company's own calculation values (Settings → Payroll → Calculation;
 * owner, 3 Nov 2026): every legal value can be changed per company, the law
 * stays the default, and a payslip worked out with different values records
 * them and warns. Every expected figure was worked out by hand first.
 */
// Never read backend/.env (the live database's keys) in a test.
jest.mock('dotenv', () => ({ config: () => ({ parsed: {} }) }));
jest.mock('../../src/config/supabase', () => ({ supabaseAdmin: { from: () => { throw new Error('no database in these tests'); } } }));
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
const statutory = require('../../src/payroll/statutory');
const { normalizePayrollRules } = require('../../src/utils/payrollRules');
const { normalizeWorkWeek } = require('../../src/utils/workWeek');

const ctxWith = (calc = null, extra = {}) => ({
  companyId: 'c1',
  workingDaysSetting: 26,
  payrollConfig: {},
  pfPolicy: 'statutory_ceiling',
  esiApplicable: true,
  tdsPolicy: 'fixed_per_employee',
  ptState: 'Karnataka',
  ptManualAmount: null,
  ptManualSlabs: null,
  ptStateUnconfirmed: false,
  choicesMade: { pf: true, esi: true, tds: true, pt: true },
  rules: normalizePayrollRules({}),
  workWeek: normalizeWorkWeek(null),
  leaveFirst: false,
  components: [],
  calc,
  ...extra,
});
const slip = (ctx, salary, summary = { workingDays: 22 }) => payroll.computePayslip(ctx, {
  employee: { id: 'e1', gender: 'male', salary_details: salary }, summary, records: [], month: 10, year: 2026,
});
const ded = (out, name) => out.breakdown_json.deductions.find((d) => d.name === name)?.amount ?? 0;
const employer = (out, name) => out.breakdown_json.employer_contributions.find((d) => d.name === name)?.amount ?? 0;
const cfg = (out) => out.breakdown_json.config;
const example1 = { basic: 22000, hra: 8800, special: 9200 };

describe('the stored values', () => {
  test('anything that is not a sensible value is left to the law', () => {
    const c = companyRules.normalizeCompanyCalc({
      pf: { employeeRate: '10', employerRate: -1, epsRate: 'abc', wageCeiling: '30000' },
      esi: { coverageCeiling: 0, exemptDailyWage: 176.4 },
      wages: { components: ['DA', 'SPECIAL', 'NOPE', 'ALLOW:bonus pay'], fiftyPercentRule: 'yes' },
      tds: { defaultRegime: 'old' },
      rounding: { earnings: 'tenth' },
      gratuity: { divisor: 26.5 },
    });
    expect(c.pf).toEqual({
      employeeRate: 10, employerRate: null, epsRate: null, edliRate: null, adminRate: null, wageCeiling: 30000,
    });
    expect(c.esi).toMatchObject({ coverageCeiling: null, exemptDailyWage: 176 });
    // Basic is always wages; unknown codes are dropped.
    expect(c.wages).toEqual({ components: ['BASIC', 'DA', 'SPECIAL', 'ALLOW:bonus pay'], fiftyPercentRule: null });
    expect(c.tds.defaultRegime).toBe('old');
    expect(c.rounding.earnings).toBeNull();
    expect(c.gratuity.divisor).toBeNull();
    expect(companyRules.normalizeCompanyCalc('rubbish').pf.employeeRate).toBeNull();
  });

  test('the standard fills in what a company left empty', () => {
    const r = companyRules.resolveCompanyCalc(null);
    expect(r.wages).toEqual({ components: ['BASIC', 'DA'], fiftyPercentRule: true });
    expect(r.gratuity).toEqual({ daysPerYear: 15, divisor: 26, minYears: 5, ceiling: 2000000 });
    expect(r.bonus).toMatchObject({ percent: 8.33, eligibilityCeiling: 21000, calculationCeiling: 7000 });
    expect(r.ctc).toEqual({ employerPf: true, employerEsi: true, gratuity: true, bonus: true });
    expect(r.tds.defaultRegime).toBe('new');
  });

  test('a value equal to the law is not a change; the pension stays on the legal ceiling', () => {
    const legal = statutory.epfRule('2026-10-31');
    expect(companyRules.companyEpf(legal, { pf: { employeeRate: 12, wageCeiling: 25000 } }).changed).toEqual([]);
    const { rule, changed } = companyRules.companyEpf(legal, { pf: { wageCeiling: 30000 } });
    expect(rule.wageCeiling).toBe(30000_00);
    expect(rule.epsWageCeiling).toBe(25000_00);
    expect(changed).toEqual([{ key: 'pf.wageCeiling', label: 'PF wage limit', law: '₹25,000', company: '₹30,000' }]);
  });
});

describe('payslips with company values (October 2026, Bengaluru, 22 working days)', () => {
  test('PF at 10% (an establishment the 10% rate applies to): Example 1', () => {
    // Earned 20,000 + 8,000 + 8,364 = 36,364; PF 10% × 20,000 = 2,000; employer 10% = 2,000:
    // EPS 8.33% × 20,000 = 1,666, EPF 334, EDLI 100, admin 100. Net 36,364 − 2,000 − 200 = 34,164.
    const out = slip(ctxWith({ pf: { employeeRate: 10, employerRate: 10 } }), example1, { workingDays: 22, absent: 2 });
    expect(out.gross_salary).toBe(36364);
    expect(out.pf_deduction).toBe(2000);
    expect(employer(out, 'Employer PF — pension (EPS)')).toBe(1666);
    expect(employer(out, 'Employer PF — EPF')).toBe(334);
    expect(out.net_salary).toBe(34164);
    expect(cfg(out).company_values.map((c) => [c.key, c.law, c.company])).toEqual([
      ['pf.employeeRate', '12%', '10%'], ['pf.employerRate', '12%', '10%'],
    ]);
    expect(cfg(out).rules.epf.company_values).toEqual(['pf.employeeRate', 'pf.employerRate']);
    expect(cfg(out).warnings.find((w) => w.code === 'company_values').message).toMatch(/Employee PF 10% \(law: 12%\)/);
    expect(cfg(out).blockers).toEqual([]);
  });

  describe('Labour Code wages: Basic 12,000, HRA 6,000, Special 12,000 (₹30,000)', () => {
    const lowBasic = { basic: 12000, hra: 6000, special: 12000 };

    test('the 50% rule (the law, on by default) adds back what the other pay takes above half', () => {
      // Excluded 18,000 − half of 30,000 (15,000) = 3,000 added back → wages 15,000 → PF 12% = 1,800;
      // EPS 8.33% × 15,000 = 1,249.50 → 1,250; EPF 550.
      const out = slip(ctxWith(), lowBasic);
      expect(out.pf_deduction).toBe(1800);
      expect(cfg(out)).toMatchObject({ pf_wages: 15000, wages_add_back: 3000, fifty_percent_rule: true, company_values: null });
      expect(employer(out, 'Employer PF — pension (EPS)')).toBe(1250);
      expect(employer(out, 'Employer PF — EPF')).toBe(550);
    });

    test('switched off: PF on Basic + DA only (12% × 12,000 = 1,440), with a warning', () => {
      const out = slip(ctxWith({ wages: { fiftyPercentRule: false } }), lowBasic);
      expect(out.pf_deduction).toBe(1440);
      expect(cfg(out).wages_add_back).toBe(0);
      expect(cfg(out).company_values.map((c) => c.key)).toEqual(['wages.fiftyPercentRule']);
    });

    test('Special Allowance counted as wages: 24,000, nothing added back → PF 2,880', () => {
      const out = slip(ctxWith({ wages: { components: ['BASIC', 'DA', 'SPECIAL'] } }), lowBasic);
      expect(out.pf_deduction).toBe(2880);
      expect(cfg(out).company_values).toEqual([{
        key: 'wages.components', label: 'Wages for PF, gratuity and bonus', law: 'Basic + DA', company: 'Basic + DA + Special Allowance',
      }]);
    });
  });

  test('a PF wage limit of ₹30,000: EPS and EDLI stay on the legal ₹25,000', () => {
    // Basic 40,000: PF 12% × 30,000 = 3,600; EPS 8.33% × 25,000 = 2,082.50 → 2,083; EPF 3,600 − 2,083 = 1,517;
    // EDLI 0.5% × 25,000 = 125; admin 0.5% × 30,000 = 150.
    const out = slip(ctxWith({ pf: { wageCeiling: 30000 } }), { basic: 40000 });
    expect(out.pf_deduction).toBe(3600);
    expect(employer(out, 'Employer PF — pension (EPS)')).toBe(2083);
    expect(employer(out, 'Employer PF — EPF')).toBe(1517);
    expect(employer(out, 'EDLI')).toBe(125);
    expect(employer(out, 'EPF admin charges')).toBe(150);
    expect(cfg(out)).toMatchObject({ pf_ceiling: 30000, eps_wages: 25000, edli_wages: 25000 });
  });

  test('ESI with a company coverage limit of ₹25,000 (a ₹24,000 salary is then covered)', () => {
    // 0.75% × 24,000 = 180 (employee), 3.25% = 780 (employer), both rounded up.
    const out = slip(ctxWith({ esi: { coverageCeiling: 25000 } }), { basic: 24000 });
    expect(out.esi_deduction).toBe(180);
    expect(employer(out, 'Employer ESI')).toBe(780);
    expect(cfg(out).company_values.map((c) => c.key)).toEqual(['esi.coverageCeiling']);
    // By law it isn't.
    expect(slip(ctxWith(), { basic: 24000 }).esi_deduction).toBe(0);
  });

  test('round only the total paid: the report\'s Example 3 (₹18,000, 21 of 22 days)', () => {
    // Each part to the paisa: 9,545.45 + 3,818.18 + 3,818.18 = 17,181.81; PF 12% × 9,545.45 = 1,145.45 → 1,145;
    // ESI 0.75% × 17,181.81 = 128.86 → 129 (up). Net 17,181.81 − 1,274 = 15,907.81, paid as ₹15,908.
    const out = slip(ctxWith({ rounding: { earnings: 'paise' } }), { basic: 10000, hra: 4000, special: 4000 }, { workingDays: 22, absent: 1 });
    expect([out.basic_salary, out.hra, out.special_allowance]).toEqual([9545.45, 3818.18, 3818.18]);
    expect(out.gross_salary).toBe(17181.81);
    expect(out.pf_deduction).toBe(1145);
    expect(out.esi_deduction).toBe(129);
    expect(out.net_salary).toBe(15907.81);
    expect(cfg(out).rounding).toBe('each_part_to_paisa');
    // A choice of method, not a change to the law: no warning.
    expect(cfg(out).company_values).toBeNull();
  });

  describe('cost to company', () => {
    // Basic 15,000, HRA 3,000: employer PF on 15,000 = EPS 1,250 + EPF 550 + EDLI 75 + admin 75 = 1,950;
    // employer ESI 3.25% × 18,000 = 585; gratuity 15,000 × 15 ÷ 312 = 721.15;
    // bonus (wages ≤ ₹21,000) 8.33% × 7,000 = 583.10.
    const lowPay = { basic: 15000, hra: 3000 };

    test('the standard: gross + employer PF and ESI + gratuity + bonus = 21,839.25', () => {
      const out = slip(ctxWith(), lowPay);
      expect(cfg(out).ctc_monthly).toBe(21839.25);
      expect(cfg(out).ctc_provisions).toEqual({ gratuity: 721.15, bonus: 583.1, lwf: 0 });
    });

    test('without the bonus: 21,256.15; with a minimum wage of ₹12,000 the bonus is 8.33% × 12,000 = 999.60', () => {
      expect(cfg(slip(ctxWith({ ctc: { bonus: false } }), lowPay)).ctc_monthly).toBe(21256.15);
      expect(cfg(slip(ctxWith({ bonus: { minimumWage: 12000 } }), lowPay)).ctc_monthly).toBe(22255.75);
    });

    test('Example 1 without the gratuity provision: 42,860', () => {
      expect(cfg(slip(ctxWith({ ctc: { gratuity: false } }), example1)).ctc_monthly).toBe(42860);
    });
  });

  test('the old regime for employees who haven\'t chosen; one who chose the new regime keeps it', () => {
    const ctx = ctxWith({ tds: { defaultRegime: 'old' } }, { tdsPolicy: 'projected' });
    const notChosen = slip(ctx, { basic: 100000 });
    expect(cfg(notChosen).tax.regime).toBe('old');
    expect(cfg(notChosen).company_values.map((c) => c.key)).toEqual(['tds.defaultRegime']);
    const chose = slip(ctx, { basic: 100000, tax_profile: { years: { '2026-27': { regime: 'new' } } } });
    expect(cfg(chose).tax.regime).toBe('new');
  });
});

test('an employer PF rate below the pension rate: the pension is the employer share, never more (review, 3 Nov)', () => {
  // Basic 25,000: employer 5% = 1,250; EPS 8.33% would be 2,083 → capped at 1,250; EPF 0.
  const out = slip(ctxWith({ pf: { employerRate: 5 } }), { basic: 25000 });
  expect(employer(out, 'Employer PF — pension (EPS)')).toBe(1250);
  expect(employer(out, 'Employer PF — EPF')).toBe(0);
  expect(cfg(out).company_values.map((c) => c.key)).toEqual(['pf.employerRate', 'pf.epsCapped']);
});
