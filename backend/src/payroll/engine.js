/**
 * The payslip calculation — pure: inputs in, payslip out, no database.
 * Every amount is in paise (integers); see money.js. The steps follow the
 * report's order (docs/Payroll-Industry-Standard-Comparison.txt §7.4):
 *
 *   1. Earnings     each salary part × paid days ÷ basis days, rounded to ₹1
 *                   (owner's choice, 2 Nov 2026; a company may instead keep
 *                   the paise and round only the total paid); gross = their
 *                   sum + overtime
 *   2. Overtime     base ÷ basis days ÷ shift hours × hours × multiplier
 *      One-time     arrears, bonus, encashment, … paid as entered (not by
 *                   days); arrears of wages count for PF, items flagged for
 *                   ESI count for ESI; PT is on the whole month's gross
 *   3. Wage bases   Labour Code wages = earned parts flagged pfWage (Basic + DA
 *                   by default) + under the 50% rule whatever the other pay
 *                   takes above half of the total; PF on those wages;
 *                   ESI and PT on earned gross including overtime
 *   4. Employee     PF (12%, up to the ceiling or on full wages by company
 *                   policy), VPF, ESI (rounded up), PT (state rule), LWF
 *                   (in the state's months), TDS, company deductions
 *   5. Employer     EPS, EPF, EDLI, EPF admin, ESI, LWF — shown, never deducted
 *   6. Net          gross − deductions, in whole rupees
 *
 * Anything that would make a wrong payslip — PT not set up for the state,
 * deductions larger than the pay — is a `blocker`; payroll refuses to save
 * such a slip, while the simulator shows it.
 */
const { mulDiv, rateRupees, roundRupees, sum } = require('./money');

const pickSlab = (slabs, amount) => slabs.find((s) => s.upTo == null || amount <= s.upTo) || slabs[slabs.length - 1];

/** Monthly-basis PT for one month's gross. */
const monthlyPt = (rule, gross, { month, gender }) => {
  const slabs = (gender && rule.slabsByGender?.[gender]) || rule.slabs;
  const s = pickSlab(slabs, gross);
  return month === 2 && s.februaryAmount != null ? s.februaryAmount : s.amount;
};

/**
 * Half-yearly PT (Tamil Nadu): the half-year's amount comes from the slab of
 * the half-year's income — the months already paid, this month, and this
 * month's contract pay for the months still to come. What hasn't been
 * deducted yet is spread over the months left; the last month settles the
 * exact remainder.
 */
const halfYearlyPt = (rule, gross, contractGross, history) => {
  const before = history || { grossBefore: 0, paidBefore: 0, monthsLeft: 1 };
  const monthsLeft = Math.max(1, Number(before.monthsLeft) || 1);
  const projected = before.grossBefore + gross + contractGross * (monthsLeft - 1);
  const halfYearAmount = pickSlab(rule.slabs, projected).amount;
  const remaining = Math.max(0, halfYearAmount - before.paidBefore);
  // One rounding, straight to the rupee (rounding to paise first could tip a .495 the wrong way).
  const due = monthsLeft === 1 ? remaining : mulDiv(remaining, 1, monthsLeft * 100) * 100;
  return { amount: Math.min(due, remaining), halfYearAmount, projected };
};

/**
 * A half-year's PT history for pay with no payslips to look back on (a
 * preview, the simulator): as if this contract pay had been paid in each
 * earlier month of the half-year, its PT worked out the same way.
 * `monthsLeft` counts this month (6 in April and October … 1 in September and March).
 */
const steadyHalfYearPtHistory = (rule, contractGross, monthsLeft) => {
  const left = Math.min(6, Math.max(1, Number(monthsLeft) || 1));
  let grossBefore = 0;
  let paidBefore = 0;
  for (let i = 6; i > left; i -= 1) {
    paidBefore += halfYearlyPt(rule, contractGross, contractGross, { grossBefore, paidBefore, monthsLeft: i }).amount;
    grossBefore += contractGross;
  }
  return { grossBefore, paidBefore, monthsLeft: left };
};

/**
 * @param {object} input see the field-by-field description in tests/payroll/engine.test.js
 */
const computePayslip = (input) => {
  const {
    period, employee = {}, components = [], days, overtime = {}, policy = {}, setup = {},
    customDeductions = [], rules = {}, ptHistory = null, esiCoveredEarlierInPeriod = false,
    esiCoverageGross = null, rounding = 'rupee', oneTime = [],
  } = input;
  // 'rupee': each earned part to ₹1 (the default). 'paise': each part to the
  // paisa — the total paid is rounded to the rupee by the caller.
  const toUnit = rounding === 'paise' ? 1 : 100;
  const warnings = [];
  const blockers = [];

  // ── 1. Earnings ─────────────────────────────────────────────────────────
  // `paid` is the share of the month paid, an exact fraction of the basis
  // (a joiner on the 16th of a 31-day month: 16/31). Without it, the share
  // comes from unpaid half days: (2 × basis − unpaid) ÷ (2 × basis).
  const basisDays = Math.max(1, Number(days.basisDays) || 1);
  let paid = days.paid;
  if (!paid) {
    const unpaidHalf = Math.min(basisDays * 2, Math.max(0, Number(days.unpaidHalfDays) || 0));
    paid = { num: basisDays * 2 - unpaidHalf, den: basisDays * 2 };
  }
  paid = { num: Math.min(paid.den, Math.max(0, paid.num)), den: paid.den };
  // A salary revised mid-month: `days.segments` splits the month, each part
  // with its own monthly rates and its share of the month (all over paid.den),
  // and each component earns Σ rate × share — rounded once, to the rupee.
  const segments = Array.isArray(days.segments) && days.segments.length > 1 ? days.segments : null;
  if (segments && segments.some((s) => s.paid.den !== paid.den)) {
    throw new Error('Every salary segment must share the month\'s denominator');
  }
  const earned = components.map((c) => {
    const weighted = segments
      // A component missing from a part (e.g. an allowance whose base was 0 then) earns nothing in it.
      ? sum(segments.map((s) => Math.max(0, s.rates?.[c.code] ?? 0) * Math.max(0, s.paid.num)))
      : c.monthly * paid.num;
    return { ...c, earned: weighted > 0 ? mulDiv(weighted, 1, paid.den * toUnit) * toUnit : 0 };
  });
  const contractGross = sum(components.map((c) => c.monthly));
  const earnedGross = sum(earned.map((c) => c.earned));

  // ── 2. Overtime ─────────────────────────────────────────────────────────
  let overtimePay = 0;
  if (overtime.mode === 'pay' && overtime.hundredthHours > 0) {
    const baseOf = (rates) => (overtime.base === 'basic_da'
      ? (rates.BASIC || 0) + (rates.DA || 0)
      : sum(Object.values(rates)));
    const shift = Math.max(1, Number(overtime.shiftHundredthHours) || 900);
    const m = overtime.multiplier || { num: 2, den: 1 };
    // A month split by a revision: each hour at the rates of the day it was worked.
    const weighted = Array.isArray(overtime.parts) && overtime.parts.length
      ? sum(overtime.parts.map((part) => baseOf(part.rates || {}) * Math.max(0, part.hundredthHours || 0)))
      : baseOf(Object.fromEntries(components.map((c) => [c.code, c.monthly]))) * overtime.hundredthHours;
    overtimePay = mulDiv(weighted, m.num, basisDays * shift * m.den * toUnit) * toUnit;
    if (rules.overtime && m.num * rules.overtime.minimumMultiplier.den < rules.overtime.minimumMultiplier.num * m.den) {
      warnings.push({ code: 'ot_below_minimum', message: 'Overtime is paid below twice the normal rate, the minimum under the Code on Wages where it applies.' });
    }
  }
  // ── One-time pay: paid in full as entered (not prorated by days) ────────
  const oneTimePay = (Array.isArray(oneTime) ? oneTime : [])
    .filter((i) => i && Number(i.amount) > 0)
    .map((i) => ({ ...i, amount: Math.round(Number(i.amount)) }));
  const oneTimeTotal = sum(oneTimePay.map((i) => i.amount));
  // The month's regular pay (earned parts + overtime), and with one-time pay.
  const regularGross = earnedGross + overtimePay;
  const gross = regularGross + oneTimeTotal;

  // ── 3. Wage bases ───────────────────────────────────────────────────────
  // Labour Code "wages": the parts that are wages and — under the 50% rule —
  // what the rest of the pay (HRA, allowances, overtime) takes above half of
  // the total, added back (report §3.2). Employer contributions are not pay
  // here. Half the total is rounded to the paisa (exact when parts are whole rupees).
  // The 50% test is on the month's regular pay: a yearly bonus or other
  // one-time pay doesn't move it. Arrears of wages are wages in full.
  const wagePart = sum(earned.filter((c) => c.pfWage).map((c) => c.earned));
  const wageAddBack = policy.wages?.fiftyPercent ? Math.max(0, regularGross - wagePart - mulDiv(regularGross, 1, 2)) : 0;
  const oneTimeWages = sum(oneTimePay.filter((i) => i.pfWage).map((i) => i.amount));
  const pfWages = wagePart + wageAddBack + oneTimeWages;

  // ── 3–5. PF ─────────────────────────────────────────────────────────────
  const pf = {
    wages: pfWages, wageAddBack, wagesUsed: 0, epsWages: 0, edliWages: 0, employee: 0, vpf: 0, eps: 0, epfEmployer: 0, edli: 0, admin: 0,
  };
  const epf = rules.epf;
  if (policy.pf !== 'not_applicable' && setup.pf !== false) {
    if (!epf) {
      blockers.push({ code: 'epf_rule_missing', message: 'No EPF rule covers this month.' });
    } else if (pfWages > 0) {
      pf.wagesUsed = policy.pf === 'full_wages' ? pfWages : Math.min(pfWages, epf.wageCeiling);
      pf.employee = rateRupees(pf.wagesUsed, epf.employeeRate);
      if (setup.vpf) pf.vpf = rateRupees(pf.wagesUsed, setup.vpf);
      const employerTotal = rateRupees(pf.wagesUsed, epf.employerRate);
      // The wages each part is worked out on (the ECR reports them).
      // The pension stays on the legal ceiling even when a company counts PF on more.
      pf.epsWages = employee.epsEligible === false ? 0 : Math.min(pf.wagesUsed, epf.epsWageCeiling ?? epf.wageCeiling);
      pf.edliWages = Math.min(pf.wagesUsed, epf.edliWageCeiling);
      // The pension comes out of the employer's share and can't be more than it.
      pf.eps = employee.epsEligible === false ? 0 : Math.min(employerTotal, rateRupees(pf.epsWages, epf.epsRate));
      pf.epfEmployer = employerTotal - pf.eps;
      pf.edli = rateRupees(pf.edliWages, epf.edliRate);
      pf.admin = rateRupees(pf.wagesUsed, epf.adminRate);
    }
  }

  // ── ESI ─────────────────────────────────────────────────────────────────
  // ESI is on the regular pay and the one-time pay flagged for it (arrears, incentives).
  const esiGross = regularGross + sum(oneTimePay.filter((i) => i.esiWage).map((i) => i.amount));
  const esi = { covered: false, wages: esiGross, employee: 0, employer: 0, exempt: false };
  const esiRule = rules.esi;
  if (policy.esi && setup.esi !== false) {
    if (!esiRule) {
      blockers.push({ code: 'esi_rule_missing', message: 'No ESI rule covers this month.' });
    } else {
      const ceiling = employee.isPwd ? esiRule.pwdCoverageCeiling : esiRule.coverageCeiling;
      // Coverage is judged on the contract wages (overtime excluded) — in a month
      // split by a raise, those in force when it began (`esiCoverageGross`): a
      // raise past the limit doesn't end coverage before the period ends.
      const coverageWage = Number.isSafeInteger(esiCoverageGross) ? esiCoverageGross : contractGross;
      esi.covered = coverageWage <= ceiling || esiCoveredEarlierInPeriod;
      if (esi.covered && esiGross > 0) {
        // Average daily wage = wages ÷ days paid for; at or below the limit
        // the employee pays nothing (the employer still does). Monthly pay
        // covers every calendar day paid, weekly offs included, so callers
        // pass the paid calendar days (`days.esiPaidDays`, a fraction);
        // without them, the basis days × the paid share.
        const esiDays = days.esiPaidDays || { num: basisDays * paid.num, den: paid.den };
        esi.exempt = esiDays.num > 0 && esiGross * esiDays.den <= esiRule.employeeExemptDailyWage * esiDays.num;
        esi.employee = esi.exempt ? 0 : rateRupees(esiGross, esiRule.employeeRate, 'up');
        esi.employer = rateRupees(esiGross, esiRule.employerRate, 'up');
      }
    }
  }

  // ── PT ──────────────────────────────────────────────────────────────────
  const ptInfo = policy.pt || { kind: 'unknown' };
  const pt = { kind: ptInfo.kind, amount: 0, halfYearAmount: null };
  if (setup.pt !== false && gross > 0) {
    if (ptInfo.kind === 'slab' && ptInfo.rule) {
      if (ptInfo.rule.basis === 'half_yearly') {
        const r = halfYearlyPt(ptInfo.rule, gross, contractGross, ptHistory);
        pt.amount = r.amount;
        pt.halfYearAmount = r.halfYearAmount;
      } else {
        pt.amount = monthlyPt(ptInfo.rule, gross, { month: period.month, gender: employee.gender });
      }
    } else if (ptInfo.kind === 'none') {
      pt.amount = 0;
    } else if (ptInfo.manualAmount != null) {
      pt.amount = roundRupees(ptInfo.manualAmount);
    } else if (ptInfo.kind === 'unknown') {
      blockers.push({ code: 'pt_state_missing', message: 'Choose the company\'s Professional Tax state in Settings → Payroll.' });
    } else {
      blockers.push({ code: 'pt_amount_missing', message: `SpaxSync has no Professional Tax table for ${ptInfo.stateName || 'this state'} yet — enter the monthly PT amount (or choose "No PT") in Settings → Payroll.` });
    }
  }

  // ── LWF ─────────────────────────────────────────────────────────────────
  // Labour Welfare Fund: the state's amounts, in its deduction months — the
  // caller passes this month's (nothing outside them).
  const lwf = { employee: 0, employer: 0 };
  if (policy.lwf && setup.lwf !== false && gross > 0) {
    // As the state sets them, to the paisa (some are ₹0.75 a month).
    lwf.employee = Math.max(0, Math.round(Number(policy.lwf.employee) || 0));
    lwf.employer = Math.max(0, Math.round(Number(policy.lwf.employer) || 0));
  }

  // ── TDS (until the tax engine: a fixed amount per employee, typed by HR) ─
  let tds = 0;
  if (policy.tds !== 'none' && setup.tdsMode !== 'none') {
    tds = roundRupees(Math.max(0, Number(setup.tdsFixed) || 0));
  }

  // ── Company deductions ──────────────────────────────────────────────────
  const optedOut = new Set((setup.optouts || []).map(String));
  const earnedBasic = sum(earned.filter((c) => c.code === 'BASIC').map((c) => c.earned));
  const custom = [];
  const skippedCustom = [];
  for (const d of customDeductions) {
    if (optedOut.has(d.key) || optedOut.has(String(d.name).toLowerCase())) {
      skippedCustom.push(d.name);
      continue;
    }
    const amount = d.valueType === 'percent'
      // A % of gross is of the regular pay, not of one-time pay.
      ? rateRupees(d.base === 'gross' ? regularGross : earnedBasic, d.rate)
      : roundRupees(d.amount);
    if (amount > 0) custom.push({ code: `CUSTOM:${d.key}`, name: d.name, amount });
  }

  // ── 6. Totals ───────────────────────────────────────────────────────────
  const deductions = [
    pf.employee > 0 && { code: 'PF', name: 'PF', amount: pf.employee },
    pf.vpf > 0 && { code: 'VPF', name: 'VPF', amount: pf.vpf },
    pt.amount > 0 && { code: 'PT', name: 'Professional Tax', amount: pt.amount },
    lwf.employee > 0 && { code: 'LWF', name: 'Labour Welfare Fund', amount: lwf.employee },
    esi.employee > 0 && { code: 'ESI', name: 'ESI', amount: esi.employee },
    tds > 0 && { code: 'TDS', name: 'TDS', amount: tds },
    ...custom,
  ].filter(Boolean);
  const employer = [
    pf.eps > 0 && { code: 'EPS', name: 'Employer PF — pension (EPS)', amount: pf.eps },
    pf.epfEmployer > 0 && { code: 'EPF_ER', name: 'Employer PF — EPF', amount: pf.epfEmployer },
    pf.edli > 0 && { code: 'EDLI', name: 'EDLI', amount: pf.edli },
    pf.admin > 0 && { code: 'EPF_ADMIN', name: 'EPF admin charges', amount: pf.admin },
    esi.employer > 0 && { code: 'ESI_ER', name: 'Employer ESI', amount: esi.employer },
    lwf.employer > 0 && { code: 'LWF_ER', name: 'Employer LWF', amount: lwf.employer },
  ].filter(Boolean);
  const totalDeductions = sum(deductions.map((d) => d.amount));
  const net = gross - totalDeductions;
  if (net < 0) {
    blockers.push({ code: 'negative_net', message: 'Deductions are more than this month\'s pay — lower the fixed TDS or other deductions.' });
  }

  return {
    earnings: [
      ...earned.map((c) => ({ code: c.code, name: c.name, rate: c.monthly, earned: c.earned })),
      ...oneTimePay.map((i) => ({ code: i.code, name: i.name, rate: null, earned: i.amount, oneTime: true })),
    ],
    overtimePay,
    oneTimePay: oneTimeTotal,
    regularGross,
    contractGross,
    earnedGross,
    gross,
    paid,
    paidDays: (basisDays * paid.num) / paid.den,
    basisDays,
    pf,
    esi,
    pt,
    lwf,
    tds,
    deductions,
    employer,
    totalDeductions,
    employerTotal: sum(employer.map((e) => e.amount)),
    net: Math.max(0, net),
    skippedCustom,
    warnings,
    blockers,
  };
};

module.exports = {
  computePayslip, monthlyPt, halfYearlyPt, steadyHalfYearPtHistory, pickSlab,
};
