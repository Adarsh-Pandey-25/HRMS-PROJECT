/**
 * This month's salary TDS by projection (report §7.7) — pure, in paise.
 *
 *   projected salary  published payslips earlier this tax year (this company)
 *                     + salary paid outside SpaxSync this tax year (a previous
 *                       employer, or this company before it used SpaxSync)
 *                     + this month's gross
 *                     + the contract gross for each month still to come
 *                       (none after a known last working day)
 *   + other income the employee declared
 *   − standard deduction; under the old regime also Professional Tax and the
 *     allowed exemptions/deductions HR recorded
 *   → annual tax (incomeTax.annualTax)
 *   this month's TDS  (annual tax − TDS already deducted) ÷ months left
 *                     including this one; the last month settles the rest.
 *                     One-time pay this month (arrears, bonus, …) by the
 *                     difference method: the tax it adds to the year is
 *                     deducted in full now, not spread over the months left.
 *                     Never more than this month's pay after its other
 *                     deductions (the shortfall is reported).
 *
 * The employee's tax inputs live in salary_details.tax_profile, per tax year
 * (resolveTaxProfile).
 */
const { toPaise, mulDiv } = require('./money');
const { monthlyTds } = require('./incomeTax');
const { taxYearOf, taxRulesFor, monthsLeftInTaxYear } = require('./taxRules');

const REGIMES = ['new', 'old'];

/** The rupee amounts HR records per tax year, and what each one means. */
const PROFILE_AMOUNTS = [
  'previous_employer_income', // salary from a previous employer this tax year
  'previous_employer_tds', // TDS that employer deducted
  'earlier_income', // salary this company paid this tax year outside SpaxSync payroll
  'earlier_tds', // TDS deducted on it
  'other_income', // other income the employee declared (interest, rent, …)
  // Old regime only — the amounts allowed after the legal limits, from the
  // employee's declaration (Form 124, was 12BB) and proofs:
  'hra_exemption',
  'lta_exemption',
  'chapter8_deductions', // 80C-type (incl. employee PF), 80D, …
  'other_deductions', // e.g. housing loan interest
];
const OLD_REGIME_AMOUNTS = ['hra_exemption', 'lta_exemption', 'chapter8_deductions', 'other_deductions'];

const nonNegativePaise = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? toPaise(n) : 0;
};

/**
 * One tax year's inputs for an employee, from salary_details.tax_profile.
 * The regime the employee chose for that year; otherwise the company's
 * default — the new regime unless the company chose otherwise (the law's default).
 */
const resolveTaxProfile = (salaryDetails, taxYear, defaultRegime = 'new') => {
  const tp = salaryDetails?.tax_profile && typeof salaryDetails.tax_profile === 'object' ? salaryDetails.tax_profile : {};
  const y = tp.years && typeof tp.years === 'object' && tp.years[taxYear] && typeof tp.years[taxYear] === 'object'
    ? tp.years[taxYear]
    : {};
  const out = {
    taxYear,
    regime: REGIMES.includes(y.regime) ? y.regime : (REGIMES.includes(defaultRegime) ? defaultRegime : 'new'),
    regimeChosen: REGIMES.includes(y.regime),
  };
  for (const key of PROFILE_AMOUNTS) out[key] = nonNegativePaise(y[key]);
  return out;
};

/**
 * The old regime's age band for the tax year: 'super_senior' (80 or older at
 * any time in it), 'senior' (60–79) or 'under_60'. By law a person reaches an
 * age on the day before the birthday, so a 1 April birthday counts for the
 * year that ends the day before. null when the date of birth isn't known.
 */
const ageBandInTaxYear = (dateOfBirth, taxYear) => {
  const dob = String(dateOfBirth || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dob)) return null;
  const dayAfterYearEnd = `${Number(String(taxYear).slice(0, 4)) + 1}-04-01`;
  const birthday = (age) => `${Number(dob.slice(0, 4)) + age}${dob.slice(4)}`;
  if (birthday(80) <= dayAfterYearEnd) return 'super_senior';
  if (birthday(60) <= dayAfterYearEnd) return 'senior';
  return 'under_60';
};

/**
 * How many months still to come after this one, in this tax year, up to
 * the month of a known last working day.
 */
const futureMonthsFor = (month, year, lastWorkingDay) => {
  const left = monthsLeftInTaxYear(month) - 1;
  const lwd = String(lastWorkingDay || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(lwd)) return left;
  const index = (y, m) => y * 12 + (m - 1);
  const untilLeaving = index(Number(lwd.slice(0, 4)), Number(lwd.slice(5, 7))) - index(year, month);
  return Math.max(0, Math.min(left, untilLeaving));
};

/**
 * A known last working day in a month still to come: the part of that month
 * that will be paid, as calendar days ({ num, den }), so the projection
 * doesn't count a whole month the employee won't work (TDS deducted before
 * it can't be given back). null when there is no such month.
 */
const leavingMonthShare = (lastWorkingDay, comingMonths) => {
  const lwd = String(lastWorkingDay || '').slice(0, 10);
  if (!comingMonths?.length || !/^\d{4}-\d{2}-\d{2}$/.test(lwd)) return null;
  const y = Number(lwd.slice(0, 4));
  const m = Number(lwd.slice(5, 7));
  if (!comingMonths.some((c) => c.year === y && c.month === m)) return null; // not a month still to come
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const day = Number(lwd.slice(8, 10));
  return day >= daysInMonth ? null : { num: day, den: daysInMonth };
};

/**
 * @param {object} p
 *   month, year           the payslip month
 *   profile               resolveTaxProfile(...)
 *   dateOfBirth           for the old regime's age rule
 *   thisMonth             this month's taxable regular salary (gross, paise)
 *   oneTime               this month's taxable one-time pay (paise)
 *   futureMonthly         the contract gross of a full month (paise)
 *   futureMonths          months still to come after this one (futureMonthsFor)
 *   comingMonths          (optional) [{ month, year }] still to come, when not simply the next
 *                         futureMonths (a month generated late: later months already paid are left out)
 *   lastWorkingDay        a known last working day — the leaving month counts only in part
 *   ptThisMonth           this month's Professional Tax (paise)
 *   ptFutureMonthly       the Professional Tax of a full month (paise)
 *   ptFutureTotal         (optional) the PT of all months still to come, month by month
 *   history               { salaryPaid, tdsPaid, ptPaid, earlierDrafts: [{month, year}] }
 *                         from this tax year's published payslips before this month
 *   payAfterDeductions    this month's pay after every deduction except TDS (paise)
 * @returns {{ tds, blockers, warnings, worksheet }}
 */
const projectMonthlyTds = (p) => {
  const blockers = [];
  const warnings = [];
  const taxYear = taxYearOf(p.month, p.year);
  const rules = taxRulesFor(p.month, p.year);
  const profile = p.profile || resolveTaxProfile({}, taxYear);
  if (!rules) {
    blockers.push({ code: 'tax_rules_missing', message: `Income-tax rates for tax year ${taxYear} aren't set up in SpaxSync yet — set a fixed TDS for now.` });
    return { tds: 0, blockers, warnings, worksheet: null };
  }
  const regime = profile.regime;
  // The old regime's nil band depends on age; the new regime's doesn't.
  let ageBand = null;
  if (regime === 'old') {
    ageBand = ageBandInTaxYear(p.dateOfBirth, taxYear);
    if (ageBand === null) warnings.push({ code: 'tax_age_unknown', message: 'No date of birth recorded: the old-regime slabs used are those for people under 60.' });
  }
  const history = p.history || {};
  if ((history.earlierDrafts || []).length) {
    const list = history.earlierDrafts.map((d) => `${d.month}/${d.year}`).join(', ');
    blockers.push({ code: 'tds_earlier_draft', message: `An earlier payslip this tax year is still a draft (${list}) — publish it first, so this month's TDS counts it.` });
    return { tds: 0, blockers, warnings, worksheet: null };
  }

  // The months still to come: as given, or simply the next futureMonths months.
  const coming = Array.isArray(p.comingMonths)
    ? p.comingMonths
    : Array.from({ length: Math.max(0, Math.floor(Number(p.futureMonths) || 0)) }, (_, k) => ({
      month: ((p.month + k) % 12) + 1,
      year: p.year + Math.floor((p.month + k) / 12),
    }));
  const futureMonths = coming.length;
  const monthsLeft = futureMonths + 1;
  const salaryPaid = Math.max(0, history.salaryPaid || 0);
  const outsideIncome = profile.previous_employer_income + profile.earlier_income;
  const outsideTds = profile.previous_employer_tds + profile.earlier_tds;
  const tdsBefore = Math.max(0, history.tdsPaid || 0) + outsideTds;

  // Old regime: Professional Tax paid and to come, and the allowed exemptions and deductions.
  const ptFuture = p.ptFutureTotal != null ? Math.max(0, p.ptFutureTotal) : Math.max(0, p.ptFutureMonthly || 0) * futureMonths;
  const ptTotal = Math.max(0, history.ptPaid || 0) + Math.max(0, p.ptThisMonth || 0) + ptFuture;
  const declared = OLD_REGIME_AMOUNTS.reduce((s, k) => s + profile[k], 0);

  const futureMonthly = Math.max(0, p.futureMonthly || 0);
  const share = leavingMonthShare(p.lastWorkingDay, coming);
  const futureTotal = share
    ? futureMonthly * (futureMonths - 1) + mulDiv(futureMonthly, share.num, share.den)
    : futureMonthly * futureMonths;

  const inputs = {
    rules,
    regime,
    monthsLeft,
    salaryPaidBefore: salaryPaid + outsideIncome,
    thisMonth: Math.max(0, p.thisMonth || 0),
    futureMonthly,
    futureTotal,
    tdsBefore,
    otherIncome: profile.other_income,
    deductions: ptTotal + declared,
    ageBand: ageBand === 'under_60' ? null : ageBand,
  };
  const t = monthlyTds(inputs);
  // One-time pay this month: the tax for the year with it, less without it,
  // is deducted in full now (the difference method). The regular TDS stays
  // as it was; the next months count the one-time pay as paid.
  const oneTime = Math.max(0, Math.round(Number(p.oneTime) || 0));
  const w = oneTime > 0 ? monthlyTds({ ...inputs, thisMonth: inputs.thisMonth + oneTime }) : t;
  const oneTimeTax = Math.max(0, w.annualTax - t.annualTax);

  const payAfterDeductions = Math.max(0, p.payAfterDeductions ?? Number.MAX_SAFE_INTEGER);
  // Never more than the year still owes, to the rupee (TDS already deducted may
  // exceed the regular tax).
  const owed = mulDiv(w.remaining, 1, 100) * 100;
  let tds = Math.min(t.tds + oneTimeTax, owed);
  let shortfall = 0;
  if (tds > payAfterDeductions) {
    shortfall = tds - payAfterDeductions;
    tds = payAfterDeductions;
    warnings.push({
      code: 'tds_capped',
      message: `This month's TDS is limited to the pay left after other deductions; ₹${(shortfall / 100).toLocaleString('en-IN')} of it ${monthsLeft > 1 ? 'moves to the coming months' : 'could not be deducted'}.`,
    });
  }

  const worksheet = {
    tax_year: taxYear,
    regime,
    regime_chosen: profile.regimeChosen,
    age_band: ageBand,
    rules: rules.id,
    months_left: monthsLeft,
    salary_paid_before: salaryPaid,
    outside_income: outsideIncome,
    this_month: Math.max(0, p.thisMonth || 0),
    one_time: oneTime,
    future_months: futureMonths,
    future_monthly: futureMonthly,
    // The leaving month, when known and still to come: the share of it that is paid.
    leaving_month_share: share,
    // The year as it now stands, one-time pay included.
    projected_salary: w.projectedSalary,
    other_income: w.otherIncome,
    standard_deduction: w.standardDeduction,
    professional_tax: regime === 'old' ? ptTotal : 0,
    exemptions_and_deductions: regime === 'old' ? declared : 0,
    taxable_income: w.taxableIncome,
    slab_tax: w.slabTax,
    rebate: w.rebate,
    surcharge: w.surcharge,
    cess: w.cess,
    annual_tax: w.annualTax,
    // Without this month's one-time pay, and the tax that pay adds (deducted now in full).
    annual_tax_regular: t.annualTax,
    one_time_tax: oneTimeTax,
    tds_before: tdsBefore,
    remaining: w.remaining,
    tds_regular: t.tds,
    tds_due: Math.min(t.tds + oneTimeTax, owed),
    tds,
    shortfall,
    // No payslips to look back on: the earlier months assume this pay was paid every month.
    assumed_full_year: Boolean(history.assumedFullYear),
  };
  return {
    tds, blockers, warnings, worksheet,
  };
};

/**
 * For pay with no payslips to look back on (a sample salary, a form not
 * saved yet): what the tax year so far would hold had this pay been paid
 * every month from April, with each month's TDS worked out the same way.
 */
const steadyStateHistory = ({
  month, year, profile: given, dateOfBirth, monthly, ptMonthly = 0,
}) => {
  // Paid here since April, so no salary from elsewhere in the earlier months.
  const profile = {
    ...given, previous_employer_income: 0, previous_employer_tds: 0, earlier_income: 0, earlier_tds: 0,
  };
  const h = {
    salaryPaid: 0, tdsPaid: 0, ptPaid: 0, earlierDrafts: [],
  };
  let m = 4;
  let y = month >= 4 ? year : year - 1;
  for (let i = 0; i < 12 && !(m === month && y === year); i += 1) {
    const r = projectMonthlyTds({
      month: m,
      year: y,
      profile,
      dateOfBirth,
      thisMonth: monthly,
      futureMonthly: monthly,
      futureMonths: monthsLeftInTaxYear(m) - 1,
      ptThisMonth: ptMonthly,
      ptFutureMonthly: ptMonthly,
      history: h,
    });
    h.salaryPaid += monthly;
    h.tdsPaid += r.tds;
    h.ptPaid += ptMonthly;
    m += 1;
    if (m === 13) { m = 1; y += 1; }
  }
  return { ...h, assumedFullYear: true };
};

module.exports = {
  REGIMES,
  PROFILE_AMOUNTS,
  OLD_REGIME_AMOUNTS,
  resolveTaxProfile,
  ageBandInTaxYear,
  futureMonthsFor,
  leavingMonthShare,
  projectMonthlyTds,
  steadyStateHistory,
};
