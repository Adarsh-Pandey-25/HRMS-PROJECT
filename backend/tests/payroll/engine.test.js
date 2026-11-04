/**
 * Golden tests for the payslip engine. Every expected rupee figure was
 * worked out by hand before the engine ran; the working is in the comments.
 * Money in the engine is paise, so ₹ in comments × 100 = the value asserted.
 */
const { computePayslip } = require('../../src/payroll/engine');
const statutory = require('../../src/payroll/statutory');

const R = (rupees) => Math.round(rupees * 100); // ₹ → paise for readability

const component = (code, name, rupees, extra = {}) => ({
  code, name, monthly: R(rupees), pfWage: code === 'BASIC' || code === 'DA', ...extra,
});

/** A Bengaluru (Karnataka) employee in October 2026 on a working-day basis — the report's setting. */
const base = (overrides = {}) => {
  const period = overrides.period || { year: 2026, month: 10 };
  const date = `${period.year}-${String(period.month).padStart(2, '0')}-28`;
  const pt = statutory.ptRule(overrides.ptState !== undefined ? overrides.ptState : 'Karnataka', date);
  return {
    period,
    employee: { gender: 'male', isPwd: false, epsEligible: true, ...(overrides.employee || {}) },
    components: overrides.components || [],
    days: { basisDays: 22, unpaidHalfDays: 0, ...(overrides.days || {}) },
    overtime: overrides.overtime || { mode: 'off' },
    policy: {
      pf: 'statutory_ceiling',
      esi: true,
      tds: 'fixed_per_employee',
      pt: { kind: pt.kind, rule: pt.rule, stateName: pt.state?.name, ...(overrides.pt || {}) },
      ...(overrides.policy || {}),
    },
    setup: { pf: true, esi: true, pt: true, tdsMode: 'company', tdsFixed: 0, optouts: [], ...(overrides.setup || {}) },
    customDeductions: overrides.customDeductions || [],
    rules: {
      epf: statutory.epfRule(date),
      esi: statutory.esiRule(date),
      overtime: statutory.overtimeRule(date),
      ...(overrides.rules || {}),
    },
    ptHistory: overrides.ptHistory || null,
    esiCoveredEarlierInPeriod: Boolean(overrides.esiCoveredEarlierInPeriod),
  };
};

const line = (list, code) => list.find((x) => x.code === code)?.amount ?? 0;
const earnedOf = (out, code) => out.earnings.find((e) => e.code === code)?.earned ?? 0;

describe("the report's worked examples (§5), October 2026, Bengaluru", () => {
  test('Example 1: ₹40,000 a month, 2 days absent (20 of 22 paid)', () => {
    const out = computePayslip(base({
      components: [component('BASIC', 'Basic', 22000), component('HRA', 'HRA', 8800), component('SPECIAL', 'Special Allowance', 9200)],
      days: { basisDays: 22, unpaidHalfDays: 4 },
    }));
    // Basic 22,000 × 20/22 = 20,000; HRA 8,800 × 20/22 = 8,000; Special 9,200 × 20/22 = 8,363.64 → 8,364
    expect(earnedOf(out, 'BASIC')).toBe(R(20000));
    expect(earnedOf(out, 'HRA')).toBe(R(8000));
    expect(earnedOf(out, 'SPECIAL')).toBe(R(8364));
    expect(out.gross).toBe(R(36364));
    // PF wages 20,000 (< 25,000) → 12% = 2,400
    expect(line(out.deductions, 'PF')).toBe(R(2400));
    // Contract gross 40,000 > 21,000 → no ESI
    expect(out.esi.covered).toBe(false);
    expect(line(out.deductions, 'ESI')).toBe(0);
    // Karnataka, October, ≥ 25,000 → ₹200
    expect(line(out.deductions, 'PT')).toBe(R(200));
    expect(line(out.deductions, 'TDS')).toBe(0);
    // Net 36,364 − 2,400 − 200 = 33,764
    expect(out.net).toBe(R(33764));
    // Employer: EPS 8.33% × 20,000 = 1,666; EPF 2,400 − 1,666 = 734; EDLI 100; admin 100 → 2,600
    expect(line(out.employer, 'EPS')).toBe(R(1666));
    expect(line(out.employer, 'EPF_ER')).toBe(R(734));
    expect(line(out.employer, 'EDLI')).toBe(R(100));
    expect(line(out.employer, 'EPF_ADMIN')).toBe(R(100));
    expect(out.employerTotal).toBe(R(2600));
    expect(out.blockers).toEqual([]);
  });

  test('Example 2: ₹2,00,000 a month, full month, TDS ₹24,375 typed by HR', () => {
    const out = computePayslip(base({
      components: [component('BASIC', 'Basic', 80000), component('HRA', 'HRA', 32000), component('SPECIAL', 'Special Allowance', 88000)],
      setup: { tdsFixed: R(24375) },
    }));
    expect(out.gross).toBe(R(200000));
    // PF wages 80,000 capped at 25,000 → 3,000
    expect(out.pf.wagesUsed).toBe(R(25000));
    expect(line(out.deductions, 'PF')).toBe(R(3000));
    expect(line(out.deductions, 'PT')).toBe(R(200));
    expect(line(out.deductions, 'TDS')).toBe(R(24375));
    // 2,00,000 − 3,000 − 200 − 24,375 = 1,72,425
    expect(out.net).toBe(R(172425));
    // EPS 8.33% × 25,000 = 2,082.50 → 2,083; EPF 917; EDLI 125; admin 125 → 3,250
    expect(line(out.employer, 'EPS')).toBe(R(2083));
    expect(line(out.employer, 'EPF_ER')).toBe(R(917));
    expect(line(out.employer, 'EDLI')).toBe(R(125));
    expect(line(out.employer, 'EPF_ADMIN')).toBe(R(125));
    expect(out.employerTotal).toBe(R(3250));
  });

  test('Example 3: ₹18,000 a month, ESI-covered, 1 day absent — each part rounded to ₹1 (owner\'s choice)', () => {
    const out = computePayslip(base({
      components: [component('BASIC', 'Basic', 10000), component('HRA', 'HRA', 4000), component('SPECIAL', 'Special Allowance', 4000)],
      days: { basisDays: 22, unpaidHalfDays: 2 },
    }));
    // 10,000 × 21/22 = 9,545.45 → 9,545; 4,000 × 21/22 = 3,818.18 → 3,818 (twice) → gross 17,181
    expect(earnedOf(out, 'BASIC')).toBe(R(9545));
    expect(earnedOf(out, 'HRA')).toBe(R(3818));
    expect(earnedOf(out, 'SPECIAL')).toBe(R(3818));
    expect(out.gross).toBe(R(17181));
    // PF 12% × 9,545 = 1,145.40 → 1,145
    expect(line(out.deductions, 'PF')).toBe(R(1145));
    // ESI covered (18,000 ≤ 21,000): 0.75% × 17,181 = 128.86 → up to 129
    expect(out.esi.covered).toBe(true);
    expect(line(out.deductions, 'ESI')).toBe(R(129));
    // PT: 17,181 < 25,000 → 0
    expect(line(out.deductions, 'PT')).toBe(0);
    // Net 17,181 − 1,145 − 129 = 15,907 (the report rounds the total instead and shows 15,908)
    expect(out.net).toBe(R(15907));
    // Employer: EPS 8.33% × 9,545 = 795.10 → 795; EPF 1,145 − 795 = 350; EDLI 47.73 → 48; admin 48; ESI 3.25% × 17,181 = 558.38 → up to 559
    expect(line(out.employer, 'EPS')).toBe(R(795));
    expect(line(out.employer, 'EPF_ER')).toBe(R(350));
    expect(line(out.employer, 'EDLI')).toBe(R(48));
    expect(line(out.employer, 'EPF_ADMIN')).toBe(R(48));
    expect(line(out.employer, 'ESI_ER')).toBe(R(559));
    expect(out.employerTotal).toBe(R(1800));
  });
});

describe('EPF', () => {
  const pfFor = (basic, overrides = {}) => computePayslip(base({ components: [component('BASIC', 'Basic', basic)], ...overrides }));

  test.each([
    // [PF wages, employee PF, EPS, employer EPF]
    // 24,999: 12% = 2,999.88 → 3,000; EPS 8.33% = 2,082.42 → 2,082; EPF 3,000 − 2,082 = 918
    [24999, 3000, 2082, 918],
    // 25,000: 3,000; EPS 2,082.50 → 2,083; EPF 917
    [25000, 3000, 2083, 917],
    // 25,001: capped at 25,000 → same as 25,000
    [25001, 3000, 2083, 917],
  ])('ceiling edge at ₹%i', (wages, employeePf, eps, epfEr) => {
    const out = pfFor(wages);
    expect(line(out.deductions, 'PF')).toBe(R(employeePf));
    expect(line(out.employer, 'EPS')).toBe(R(eps));
    expect(line(out.employer, 'EPF_ER')).toBe(R(epfEr));
  });

  test('full Basic + DA by company policy: employee 12% of 40,000; EPS still on the ceiling', () => {
    const out = computePayslip(base({
      components: [component('BASIC', 'Basic', 30000), component('DA', 'DA', 10000), component('HRA', 'HRA', 12000)],
      policy: { pf: 'full_wages' },
    }));
    // PF wages = Basic + DA = 40,000 (HRA is not PF wages) → 4,800
    expect(out.pf.wages).toBe(R(40000));
    expect(line(out.deductions, 'PF')).toBe(R(4800));
    // EPS 8.33% × 25,000 = 2,083; EPF 4,800 − 2,083 = 2,717; EDLI on 25,000 = 125; admin 0.5% × 40,000 = 200
    expect(line(out.employer, 'EPS')).toBe(R(2083));
    expect(line(out.employer, 'EPF_ER')).toBe(R(2717));
    expect(line(out.employer, 'EDLI')).toBe(R(125));
    expect(line(out.employer, 'EPF_ADMIN')).toBe(R(200));
  });

  test('DA counts as PF wages (defect D3)', () => {
    const out = computePayslip(base({ components: [component('BASIC', 'Basic', 10000), component('DA', 'DA', 2000)] }));
    // (10,000 + 2,000) × 12% = 1,440
    expect(line(out.deductions, 'PF')).toBe(R(1440));
  });

  test('before 17 Sep 2026 the ceiling is ₹15,000 (August 2026)', () => {
    const out = pfFor(20000, { period: { year: 2026, month: 8 } });
    // 15,000 × 12% = 1,800; EPS 8.33% × 15,000 = 1,249.50 → 1,250; EPF 550; EDLI 75; admin 75
    expect(line(out.deductions, 'PF')).toBe(R(1800));
    expect(line(out.employer, 'EPS')).toBe(R(1250));
    expect(line(out.employer, 'EPF_ER')).toBe(R(550));
    expect(line(out.employer, 'EDLI')).toBe(R(75));
    expect(line(out.employer, 'EPF_ADMIN')).toBe(R(75));
  });

  test('not applicable to the company, or switched off for the employee → no PF at all', () => {
    for (const out of [pfFor(20000, { policy: { pf: 'not_applicable' } }), pfFor(20000, { setup: { pf: false } })]) {
      expect(line(out.deductions, 'PF')).toBe(0);
      expect(out.employer.filter((e) => e.code.startsWith('EP') || e.code === 'EDLI')).toEqual([]);
    }
  });

  test('not in EPS (e.g. joined after Sep 2014 above the ceiling): the whole 12% goes to EPF', () => {
    const out = pfFor(20000, { employee: { epsEligible: false } });
    expect(line(out.employer, 'EPS')).toBe(0);
    expect(line(out.employer, 'EPF_ER')).toBe(R(2400));
  });

  test('VPF 5% on top, employee only', () => {
    const out = pfFor(20000, { setup: { vpf: { num: 5, den: 100 } } });
    expect(line(out.deductions, 'VPF')).toBe(R(1000));
    expect(line(out.employer, 'EPF_ER') + line(out.employer, 'EPS')).toBe(R(2400));
  });
});

describe('ESI', () => {
  const esiFor = (gross, overrides = {}) => computePayslip(base({ components: [component('BASIC', 'Basic', gross)], ...overrides }));

  test('coverage edge: ₹21,000 covered, ₹21,001 not', () => {
    const covered = esiFor(21000);
    // 0.75% × 21,000 = 157.50 → up 158; 3.25% = 682.50 → up 683
    expect(line(covered.deductions, 'ESI')).toBe(R(158));
    expect(line(covered.employer, 'ESI_ER')).toBe(R(683));
    expect(esiFor(21001).esi.covered).toBe(false);
  });

  test('persons with disability are covered up to ₹25,000', () => {
    expect(esiFor(24000, { employee: { isPwd: true } }).esi.covered).toBe(true);
    expect(esiFor(24000).esi.covered).toBe(false);
  });

  test('coverage holds to the end of the contribution period', () => {
    expect(esiFor(22000, { esiCoveredEarlierInPeriod: true }).esi.covered).toBe(true);
  });

  test('average daily wage up to ₹176: employee pays nothing, employer still pays', () => {
    // Calendar basis, 30 of 30 days: 5,280 ÷ 30 = 176.00 → exempt; employer 3.25% × 5,280 = 171.60 → up 172
    const at = esiFor(5280, { days: { basisDays: 30, unpaidHalfDays: 0 } });
    expect(at.esi.exempt).toBe(true);
    expect(line(at.deductions, 'ESI')).toBe(0);
    expect(line(at.employer, 'ESI_ER')).toBe(R(172));
    // 5,310 ÷ 30 = 177 → pays: 0.75% × 5,310 = 39.83 → up 40
    const above = esiFor(5310, { days: { basisDays: 30, unpaidHalfDays: 0 } });
    expect(above.esi.exempt).toBe(false);
    expect(line(above.deductions, 'ESI')).toBe(R(40));
  });

  test('company not covered by ESIC → none', () => {
    expect(line(esiFor(15000, { policy: { esi: false } }).deductions, 'ESI')).toBe(0);
  });
});

describe('Professional Tax', () => {
  const ptFor = (gross, state, overrides = {}) => line(
    computePayslip(base({ components: [component('BASIC', 'Basic', gross)], ptState: state, ...overrides })).deductions,
    'PT',
  );

  test('Karnataka: nil below ₹25,000, ₹200 from it, ₹300 in February', () => {
    expect(ptFor(24999, 'Karnataka')).toBe(0);
    expect(ptFor(25000, 'Karnataka')).toBe(R(200));
    expect(ptFor(25000, 'Karnataka', { period: { year: 2027, month: 2 } })).toBe(R(300));
  });

  test('Maharashtra: men 7,500 / 10,000 bands; women exempt up to ₹25,000', () => {
    expect(ptFor(7500, 'Maharashtra')).toBe(0);
    expect(ptFor(7501, 'Maharashtra')).toBe(R(175));
    expect(ptFor(10000, 'Maharashtra')).toBe(R(175));
    expect(ptFor(10001, 'Maharashtra')).toBe(R(200));
    expect(ptFor(10001, 'Maharashtra', { period: { year: 2027, month: 2 } })).toBe(R(300));
    expect(ptFor(25000, 'Maharashtra', { employee: { gender: 'female' } })).toBe(0);
    expect(ptFor(25001, 'Maharashtra', { employee: { gender: 'female' } })).toBe(R(200));
  });

  test('Telangana bands', () => {
    expect(ptFor(15000, 'Telangana')).toBe(0);
    expect(ptFor(15001, 'Telangana')).toBe(R(150));
    expect(ptFor(20000, 'Telangana')).toBe(R(150));
    expect(ptFor(20001, 'Telangana')).toBe(R(200));
  });

  test('Tamil Nadu: half-yearly slab spread over the months, the last month settles the rest', () => {
    // First month of the half (October), ₹10,000 a month → projected 60,000 → ₹930 → 930 ÷ 6 = 155
    expect(ptFor(10000, 'Tamil Nadu', { ptHistory: { grossBefore: 0, paidBefore: 0, monthsLeft: 6 } })).toBe(R(155));
    // Last month (March): 5 × 10,000 earned and 5 × 155 paid → 930 − 775 = 155
    expect(ptFor(10000, 'Tamil Nadu', { period: { year: 2027, month: 3 }, ptHistory: { grossBefore: R(50000), paidBefore: R(775), monthsLeft: 1 } })).toBe(R(155));
    // ₹6,000 a month → projected 36,000 → ₹425: 425 ÷ 6 = 70.83 → 71; last month 425 − 5 × 71 = 70
    expect(ptFor(6000, 'Tamil Nadu', { ptHistory: { grossBefore: 0, paidBefore: 0, monthsLeft: 6 } })).toBe(R(71));
    expect(ptFor(6000, 'Tamil Nadu', { period: { year: 2027, month: 3 }, ptHistory: { grossBefore: R(30000), paidBefore: R(355), monthsLeft: 1 } })).toBe(R(70));
    // Up to 21,000 a half-year: nil
    expect(ptFor(3500, 'Tamil Nadu', { ptHistory: { grossBefore: 0, paidBefore: 0, monthsLeft: 6 } })).toBe(0);
  });

  test('states with no PT are ₹0, never a flat ₹200 (defect D5)', () => {
    for (const state of ['Delhi', 'Haryana', 'Uttar Pradesh', 'Rajasthan']) expect(ptFor(80000, state)).toBe(0);
  });

  test('a PT state without a built-in table needs the company\'s amount — otherwise the slip is blocked', () => {
    const blocked = computePayslip(base({ components: [component('BASIC', 'Basic', 30000)], ptState: 'West Bengal' }));
    expect(blocked.blockers.map((b) => b.code)).toContain('pt_amount_missing');
    expect(ptFor(30000, 'West Bengal', { pt: { manualAmount: R(150) } })).toBe(R(150));
    // "No PT" chosen for an unclear state = amount 0
    expect(ptFor(30000, 'Punjab', { pt: { manualAmount: 0 } })).toBe(0);
  });

  test('no state chosen → blocked', () => {
    const out = computePayslip(base({ components: [component('BASIC', 'Basic', 30000)], ptState: '' }));
    expect(out.blockers.map((b) => b.code)).toContain('pt_state_missing');
  });

  test('switched off for the employee → none', () => {
    expect(ptFor(30000, 'Karnataka', { setup: { pt: false } })).toBe(0);
  });
});

describe('days and loss of pay', () => {
  test('calendar basis: 31,000 with 2 of 31 days unpaid → 29,000', () => {
    const out = computePayslip(base({ components: [component('BASIC', 'Basic', 31000)], days: { basisDays: 31, unpaidHalfDays: 4 } }));
    expect(out.gross).toBe(R(29000));
  });

  test('fixed 26 basis with a half day unpaid → 26,000 × 25.5/26 = 25,500', () => {
    const out = computePayslip(base({ components: [component('BASIC', 'Basic', 26000)], days: { basisDays: 26, unpaidHalfDays: 1 } }));
    expect(out.gross).toBe(R(25500));
  });

  test('whole month unpaid → nothing earned, nothing deducted', () => {
    const out = computePayslip(base({
      components: [component('BASIC', 'Basic', 18000), component('HRA', 'HRA', 2000)],
      days: { basisDays: 22, unpaidHalfDays: 44 },
    }));
    expect(out.gross).toBe(0);
    expect(out.deductions).toEqual([]);
    expect(out.employer).toEqual([]);
    expect(out.net).toBe(0);
  });

  test('an exact paid share: joined on the 16th of a 31-day month → 16/31 of each part', () => {
    const out = computePayslip(base({
      components: [component('BASIC', 'Basic', 30000), component('HRA', 'HRA', 12000)],
      days: { basisDays: 30, paid: { num: 16, den: 31 } },
      ptState: 'Delhi',
    }));
    // 30,000 × 16/31 = 15,483.87 → 15,484; 12,000 × 16/31 = 6,193.55 → 6,194
    expect(earnedOf(out, 'BASIC')).toBe(R(15484));
    expect(earnedOf(out, 'HRA')).toBe(R(6194));
    expect(out.paidDays).toBeCloseTo(30 * 16 / 31, 10);
  });

  test('ESI ₹176 a day uses the paid days of a part month', () => {
    // 10 of 30 days paid on ₹5,280 a month → earned 1,760 over 10 days = ₹176 a day → exempt
    const out = computePayslip(base({
      components: [component('BASIC', 'Basic', 5280)],
      days: { basisDays: 30, paid: { num: 10, den: 30 } },
      ptState: 'Delhi',
    }));
    expect(out.gross).toBe(R(1760));
    expect(out.esi.exempt).toBe(true);
    expect(line(out.employer, 'ESI_ER')).toBe(R(58)); // 3.25% × 1,760 = 57.20 → up 58
  });

  test('more unpaid days than the basis are capped at the basis', () => {
    const out = computePayslip(base({ components: [component('BASIC', 'Basic', 18000)], days: { basisDays: 22, unpaidHalfDays: 60 } }));
    expect(out.gross).toBe(0);
  });
});

describe('overtime', () => {
  test('2× on gross: 26,000 ÷ 26 days ÷ 8 h = ₹125 an hour; 10 h × 125 × 2 = 2,500', () => {
    const out = computePayslip(base({
      components: [component('BASIC', 'Basic', 13000), component('SPECIAL', 'Special Allowance', 13000)],
      days: { basisDays: 26, unpaidHalfDays: 0 },
      overtime: { mode: 'pay', hundredthHours: 1000, shiftHundredthHours: 800, multiplier: { num: 2, den: 1 }, base: 'gross' },
    }));
    expect(out.overtimePay).toBe(R(2500));
    expect(out.gross).toBe(R(28500));
    expect(out.warnings).toEqual([]);
  });

  test('on Basic + DA only: 13,000 ÷ 26 ÷ 8 = 62.50 an hour → 10 h × 2 = 1,250', () => {
    const out = computePayslip(base({
      components: [component('BASIC', 'Basic', 13000), component('SPECIAL', 'Special Allowance', 13000)],
      days: { basisDays: 26, unpaidHalfDays: 0 },
      overtime: { mode: 'pay', hundredthHours: 1000, shiftHundredthHours: 800, multiplier: { num: 2, den: 1 }, base: 'basic_da' },
    }));
    expect(out.overtimePay).toBe(R(1250));
  });

  test('below 2× is allowed but warned', () => {
    const out = computePayslip(base({
      components: [component('BASIC', 'Basic', 26000)],
      days: { basisDays: 26, unpaidHalfDays: 0 },
      overtime: { mode: 'pay', hundredthHours: 1000, shiftHundredthHours: 800, multiplier: { num: 3, den: 2 }, base: 'gross' },
    }));
    // 125 × 10 × 1.5 = 1,875
    expect(out.overtimePay).toBe(R(1875));
    expect(out.warnings.map((w) => w.code)).toContain('ot_below_minimum');
  });

  test('overtime counts for ESI but not for ESI coverage', () => {
    const out = computePayslip(base({
      components: [component('BASIC', 'Basic', 20800)],
      days: { basisDays: 26, unpaidHalfDays: 0 },
      overtime: { mode: 'pay', hundredthHours: 1000, shiftHundredthHours: 800, multiplier: { num: 2, den: 1 }, base: 'gross' },
    }));
    // OT 20,800 ÷ 26 ÷ 8 = 100/h × 10 × 2 = 2,000; covered on 20,800; ESI 0.75% × 22,800 = 171
    expect(out.esi.covered).toBe(true);
    expect(line(out.deductions, 'ESI')).toBe(R(171));
  });
});

describe('TDS, company deductions and net', () => {
  test('TDS is the fixed amount HR typed; none when switched off', () => {
    const typed = computePayslip(base({ components: [component('BASIC', 'Basic', 50000)], setup: { tdsFixed: R(1234) } }));
    expect(line(typed.deductions, 'TDS')).toBe(R(1234));
    const none = computePayslip(base({ components: [component('BASIC', 'Basic', 50000)], setup: { tdsMode: 'none', tdsFixed: R(1234) } }));
    expect(line(none.deductions, 'TDS')).toBe(0);
    const companyNone = computePayslip(base({ components: [component('BASIC', 'Basic', 50000)], policy: { tds: 'none' }, setup: { tdsFixed: R(1234) } }));
    expect(line(companyNone.deductions, 'TDS')).toBe(0);
  });

  test('company deductions: % of gross, fixed amounts in whole rupees, opt-outs', () => {
    const out = computePayslip(base({
      components: [component('BASIC', 'Basic', 22000), component('HRA', 'HRA', 8800), component('SPECIAL', 'Special Allowance', 9200)],
      days: { basisDays: 22, unpaidHalfDays: 4 },
      customDeductions: [
        { key: 'canteen', name: 'Canteen', valueType: 'percent', rate: { num: 2, den: 100 }, base: 'gross' },
        { key: 'club', name: 'Club', valueType: 'fixed', amount: R(500.5) },
        { key: 'bus', name: 'Bus', valueType: 'fixed', amount: R(300) },
      ],
      setup: { optouts: ['bus'] },
    }));
    // 2% × 36,364 = 727.28 → 727; 500.50 → 501; Bus opted out
    expect(line(out.deductions, 'CUSTOM:canteen')).toBe(R(727));
    expect(line(out.deductions, 'CUSTOM:club')).toBe(R(501));
    expect(line(out.deductions, 'CUSTOM:bus')).toBe(0);
    expect(out.skippedCustom).toEqual(['Bus']);
  });

  test('deductions larger than the pay block the slip', () => {
    const out = computePayslip(base({ components: [component('BASIC', 'Basic', 30000)], setup: { tdsFixed: R(50000) } }));
    expect(out.blockers.map((b) => b.code)).toContain('negative_net');
  });
});

/* ── Properties over many random payslips, checked against a separate,
 *    deliberately plain reference calculation. ─────────────────────────── */
const rng = (seed) => () => {
  seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

/** Round a/b to the nearest whole number, halves up — plain BigInt, no shared code with the engine. */
const roundDiv = (a, b) => {
  const A = BigInt(a); const B = BigInt(b);
  return Number((2n * A + B) / (2n * B));
};
const ceilDiv = (a, b) => {
  const A = BigInt(a); const B = BigInt(b);
  return Number((A + B - 1n) / B);
};

describe('properties (2,000 random payslips)', () => {
  const next = rng(20261102);
  const pick = (list) => list[Math.floor(next() * list.length)];
  const cases = Array.from({ length: 2000 }, () => {
    const basisDays = pick([22, 26, 30, 31, 20]);
    const rupees = () => Math.floor(next() * 60000);
    const comps = [
      component('BASIC', 'Basic', rupees()),
      component('HRA', 'HRA', rupees()),
      component('DA', 'DA', next() < 0.3 ? rupees() : 0),
      component('SPECIAL', 'Special Allowance', rupees()),
    ];
    return {
      input: base({
        components: comps,
        days: { basisDays, unpaidHalfDays: Math.floor(next() * (basisDays * 2 + 1)) },
        ptState: pick(['Karnataka', 'Maharashtra', 'Telangana', 'Delhi']),
        policy: { pf: pick(['statutory_ceiling', 'full_wages', 'not_applicable']) },
        employee: { gender: pick(['male', 'female']) },
      }),
    };
  });

  test('each part is paid at most its rate and in whole rupees; gross is their sum', () => {
    for (const { input } of cases) {
      const out = computePayslip(input);
      for (const e of out.earnings) {
        expect(e.earned).toBeLessThanOrEqual(e.rate + 50); // rounding can lift a part by under ₹0.50
        expect(e.earned % 100).toBe(0);
      }
      expect(out.gross).toBe(out.earnings.reduce((s, e) => s + e.earned, 0) + out.overtimePay);
    }
  });

  test('net = gross − deductions, every line whole rupees and never negative', () => {
    for (const { input } of cases) {
      const out = computePayslip(input);
      expect(out.blockers).toEqual([]);
      for (const l of [...out.deductions, ...out.employer]) {
        expect(l.amount).toBeGreaterThan(0);
        expect(l.amount % 100).toBe(0);
      }
      expect(out.net).toBe(out.gross - out.deductions.reduce((s, d) => s + d.amount, 0));
    }
  });

  test('the engine agrees with a plain reference calculation', () => {
    for (const { input } of cases) {
      const out = computePayslip(input);
      const { basisDays, unpaidHalfDays } = input.days;
      const paidHalf = basisDays * 2 - Math.min(basisDays * 2, unpaidHalfDays);
      // Earned parts: rate × paid ÷ basis, to the rupee
      const ref = input.components.map((c) => roundDiv(c.monthly * paidHalf, basisDays * 2 * 100) * 100);
      expect(out.earnings.map((e) => e.earned)).toEqual(ref);
      const gross = ref.reduce((s, x) => s + x, 0);
      // PF
      const pfWages = ref[0] + ref[2];
      const capped = input.policy.pf === 'full_wages' ? pfWages : Math.min(pfWages, 2500000);
      const pf = input.policy.pf === 'not_applicable' ? 0 : roundDiv(capped * 12, 100 * 100) * 100;
      expect(out.deductions.find((d) => d.code === 'PF')?.amount ?? 0).toBe(pf);
      // ESI
      const contract = input.components.reduce((s, c) => s + c.monthly, 0);
      const exempt = gross * 2 <= 17600 * paidHalf;
      const esi = contract <= 2100000 && gross > 0 && !exempt ? ceilDiv(gross * 75, 10000 * 100) * 100 : 0;
      expect(out.deductions.find((d) => d.code === 'ESI')?.amount ?? 0).toBe(esi);
    }
  });
});

describe('a month split by a salary revision (final review, 3 Nov)', () => {
  test('a component missing from one part earns nothing in it', () => {
    // 1–15 Oct: Basic 20,000 only; 16–31 Oct: Basic 22,000 and a ₹1,000 allowance. Calendar shares 15/31 and 16/31.
    // Basic (20,000 × 15 + 22,000 × 16) ÷ 31 = 21,032.26 → 21,032; the allowance 1,000 × 16/31 = 516.13 → 516
    // (it used to be paid for the whole month: 1,000).
    const out = computePayslip(base({
      components: [component('BASIC', 'Basic', 22000), component('ALLOW:x', 'Allowance', 1000)],
      days: {
        basisDays: 31,
        paid: { num: 31, den: 31 },
        segments: [
          { from: '2026-10-01', to: '2026-10-15', paid: { num: 15, den: 31 }, rates: { BASIC: R(20000) } },
          { from: '2026-10-16', to: '2026-10-31', paid: { num: 16, den: 31 }, rates: { BASIC: R(22000), 'ALLOW:x': R(1000) } },
        ],
      },
    }));
    expect(earnedOf(out, 'BASIC')).toBe(R(21032));
    expect(earnedOf(out, 'ALLOW:x')).toBe(R(516));
  });
});
