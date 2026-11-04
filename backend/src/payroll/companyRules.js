/**
 * A company's own calculation values: Settings → Payroll → Calculation,
 * stored as the `payroll_calc` setting. SpaxSync serves many companies and
 * each may calculate its own way (owner, 3 Nov 2026), so every value the law
 * or the standard sets has a company override.
 *
 * Every override is optional. Left empty (null), the legal value in force on
 * the payslip's date applies (statutory.js), so a company that changes
 * nothing follows the law as it changes. A value the company sets:
 *   - is used for its draft payslips from then on (published ones never change);
 *   - is recorded on each payslip beside the legal value;
 *   - raises a warning on the payslip when it departs from the law.
 *
 * Stored as the screen shows them (percentages, whole rupees) and normalized
 * here on save and on read, so a hand-edited value can never break a run.
 */
const { toPaise, percentRate } = require('./money');
const { GRATUITY_RULES } = require('./gratuity');
const { BONUS_RULES } = require('./bonusEncashment');

const SALARY_CODES = ['BASIC', 'HRA', 'DA', 'SPECIAL', 'TRANSPORT', 'MEDICAL'];
/** Labour Code "wages" by default: Basic + DA (a retaining allowance has no component of its own). */
const DEFAULT_WAGE_CODES = Object.freeze(['BASIC', 'DA']);
const RUPEE_LIMIT = 1_00_00_000; // ₹1 crore

const percentOrNull = (v, { max = 100 } = {}) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > max) return null;
  return Math.round(n * 100) / 100;
};
const rupeesOrNull = (v, { min = 0, max = RUPEE_LIMIT } = {}) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) return null;
  return Math.round(n);
};
const wholeOrNull = (v, min, max) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
};
const boolOrNull = (v) => (typeof v === 'boolean' ? v : null);
const oneOfOrNull = (v, list) => (list.includes(v) ? v : null);
/** Component codes that count as wages; Basic always does. */
const wageCodesOrNull = (v) => {
  if (!Array.isArray(v)) return null;
  // eslint-disable-next-line no-control-regex
  const ok = (c) => SALARY_CODES.includes(c) || /^ALLOW:[^\u0000-\u001f]{1,100}$/.test(c);
  const codes = [...new Set(v.map((c) => String(c ?? '').trim()).filter(ok))].slice(0, 50);
  return codes.includes('BASIC') ? codes : ['BASIC', ...codes];
};
const section = (raw, key) => (raw[key] && typeof raw[key] === 'object' && !Array.isArray(raw[key]) ? raw[key] : {});

/** What is stored: every value or null (= the legal or standard value). */
const normalizeCompanyCalc = (raw) => {
  const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const pf = section(r, 'pf');
  const wages = section(r, 'wages');
  const esi = section(r, 'esi');
  const tds = section(r, 'tds');
  const rounding = section(r, 'rounding');
  const gratuity = section(r, 'gratuity');
  const bonus = section(r, 'bonus');
  const encashment = section(r, 'encashment');
  const ctc = section(r, 'ctc');
  const payslip = section(r, 'payslip');
  const approval = section(r, 'approval');
  const ctcTemplate = section(r, 'ctcTemplate');
  return {
    pf: {
      employeeRate: percentOrNull(pf.employeeRate),
      employerRate: percentOrNull(pf.employerRate),
      epsRate: percentOrNull(pf.epsRate),
      edliRate: percentOrNull(pf.edliRate),
      adminRate: percentOrNull(pf.adminRate),
      wageCeiling: rupeesOrNull(pf.wageCeiling, { min: 1 }),
    },
    wages: {
      components: wageCodesOrNull(wages.components),
      fiftyPercentRule: boolOrNull(wages.fiftyPercentRule),
    },
    esi: {
      employeeRate: percentOrNull(esi.employeeRate),
      employerRate: percentOrNull(esi.employerRate),
      coverageCeiling: rupeesOrNull(esi.coverageCeiling, { min: 1 }),
      pwdCoverageCeiling: rupeesOrNull(esi.pwdCoverageCeiling, { min: 1 }),
      exemptDailyWage: rupeesOrNull(esi.exemptDailyWage, { max: 1_00_000 }),
    },
    tds: { defaultRegime: oneOfOrNull(tds.defaultRegime, ['new', 'old']) },
    rounding: { earnings: oneOfOrNull(rounding.earnings, ['rupee', 'paise']) },
    gratuity: {
      daysPerYear: wholeOrNull(gratuity.daysPerYear, 1, 60),
      divisor: wholeOrNull(gratuity.divisor, 1, 31),
      minYears: wholeOrNull(gratuity.minYears, 0, 10),
      ceiling: rupeesOrNull(gratuity.ceiling, { min: 1, max: 10_00_00_000 }),
    },
    bonus: {
      percent: percentOrNull(bonus.percent),
      eligibilityCeiling: rupeesOrNull(bonus.eligibilityCeiling, { min: 1 }),
      calculationCeiling: rupeesOrNull(bonus.calculationCeiling, { min: 1 }),
      minimumWage: rupeesOrNull(bonus.minimumWage),
    },
    encashment: {
      base: oneOfOrNull(encashment.base, ['basic_da', 'gross']),
      divisor: wholeOrNull(encashment.divisor, 1, 31),
    },
    ctc: {
      employerPf: boolOrNull(ctc.employerPf),
      employerEsi: boolOrNull(ctc.employerEsi),
      gratuity: boolOrNull(ctc.gratuity),
      bonus: boolOrNull(ctc.bonus),
    },
    payslip: {
      showRates: boolOrNull(payslip.showRates),
      showEmployer: boolOrNull(payslip.showEmployer),
      showTaxWorking: boolOrNull(payslip.showTaxWorking),
    },
    approval: { required: boolOrNull(approval.required) },
    ctcTemplate: { basicPercent: percentOrNull(ctcTemplate.basicPercent) },
  };
};

/** The standard for everything that isn't a dated statutory rule. */
const STANDARD = Object.freeze({
  wages: { components: DEFAULT_WAGE_CODES, fiftyPercentRule: true },
  tds: { defaultRegime: 'new' },
  rounding: { earnings: 'rupee' },
  gratuity: {
    daysPerYear: GRATUITY_RULES[0].factor.num,
    divisor: GRATUITY_RULES[0].factor.den,
    minYears: GRATUITY_RULES[0].minYears,
    ceiling: GRATUITY_RULES[0].ceiling / 100,
  },
  bonus: {
    percent: BONUS_RULES[0].minPercent.num / (BONUS_RULES[0].minPercent.den / 100),
    eligibilityCeiling: BONUS_RULES[0].eligibilityCeiling / 100,
    calculationCeiling: BONUS_RULES[0].calculationFloor / 100,
    minimumWage: null,
  },
  encashment: { base: 'basic_da', divisor: 26 },
  ctc: {
    employerPf: true, employerEsi: true, gratuity: true, bonus: true,
  },
  payslip: { showRates: true, showEmployer: true, showTaxWorking: true },
  approval: { required: false },
  // A new salary from a yearly CTC: Basic is this share of it (half keeps
  // Labour Code wages at 50% of pay), HRA and DA the company's % of Basic.
  ctcTemplate: { basicPercent: 50 },
});

/** The company's values with the standard filled in where it set none. */
const resolveCompanyCalc = (raw) => {
  const c = normalizeCompanyCalc(raw);
  const out = { pf: c.pf, esi: c.esi };
  for (const [key, standard] of Object.entries(STANDARD)) {
    out[key] = Object.fromEntries(Object.entries(standard).map(([k, v]) => [k, c[key]?.[k] ?? v]));
  }
  return out;
};

const rateText = (rate) => `${Number(((rate.num * 100) / rate.den).toFixed(4))}%`;
const rupeeText = (paise) => `₹${(paise / 100).toLocaleString('en-IN')}`;
const sameRate = (a, b) => a.num * b.den === b.num * a.den;

/**
 * A dated statutory rule with the company's values on top. `fields`:
 * [key in the rule, key in the company section, label, kind ('rate' | 'rupees')].
 * Returns { rule, changed: [{ key, label, law, company }] }.
 */
const overlay = (legal, values, prefix, fields) => {
  if (!legal) return { rule: null, changed: [] };
  const rule = { ...legal };
  const changed = [];
  for (const [ruleKey, companyKey, label, kind] of fields) {
    const v = values?.[companyKey];
    if (v === null || v === undefined) continue;
    if (kind === 'rate') {
      const rate = percentRate(String(v));
      if (sameRate(rate, legal[ruleKey])) continue;
      rule[ruleKey] = rate;
      changed.push({ key: `${prefix}.${companyKey}`, label, law: rateText(legal[ruleKey]), company: rateText(rate) });
    } else {
      const paise = toPaise(v);
      if (paise === legal[ruleKey]) continue;
      rule[ruleKey] = paise;
      changed.push({ key: `${prefix}.${companyKey}`, label, law: rupeeText(legal[ruleKey]), company: rupeeText(paise) });
    }
  }
  if (changed.length) rule.companyValues = changed.map((x) => x.key);
  return { rule, changed };
};

/**
 * EPF in force with the company's values. The pension (EPS) and EDLI stay on
 * the legal wage ceiling: a company that counts PF on more pays the extra
 * into EPF, as with "full Basic + DA".
 */
const companyEpf = (legal, calc) => {
  const out = overlay(legal, normalizeCompanyCalc(calc).pf, 'pf', [
    ['employeeRate', 'employeeRate', 'Employee PF', 'rate'],
    ['employerRate', 'employerRate', 'Employer PF', 'rate'],
    ['epsRate', 'epsRate', 'Pension (EPS)', 'rate'],
    ['edliRate', 'edliRate', 'EDLI', 'rate'],
    ['adminRate', 'adminRate', 'EPF admin charges', 'rate'],
    ['wageCeiling', 'wageCeiling', 'PF wage limit', 'rupees'],
  ]);
  if (out.rule) {
    out.rule.epsWageCeiling = legal.wageCeiling;
    // The pension is part of the employer's share: a smaller employer rate caps it.
    const { employerRate: er, epsRate: eps } = out.rule;
    if (eps.num * er.den > er.num * eps.den) {
      out.changed.push({
        key: 'pf.epsCapped', label: 'Pension (EPS) limited to the employer\'s share', law: rateText(legal.epsRate), company: rateText(er),
      });
    }
  }
  return out;
};

/** ESI in force with the company's values. */
const companyEsi = (legal, calc) => overlay(legal, normalizeCompanyCalc(calc).esi, 'esi', [
  ['employeeRate', 'employeeRate', 'Employee ESI', 'rate'],
  ['employerRate', 'employerRate', 'Employer ESI', 'rate'],
  ['coverageCeiling', 'coverageCeiling', 'ESI coverage limit', 'rupees'],
  ['pwdCoverageCeiling', 'pwdCoverageCeiling', 'ESI coverage limit (disability)', 'rupees'],
  ['employeeExemptDailyWage', 'exemptDailyWage', 'ESI: no employee share up to (a day)', 'rupees'],
]);

/**
 * Labour Code wages as the company counts them, and what differs from the
 * standard. `names` maps a component code to its name, for the record.
 */
const companyWages = (calc, names = {}) => {
  const resolved = resolveCompanyCalc(calc).wages;
  const changed = [];
  const nameList = (codes) => codes.map((c) => names[c] || c).join(' + ');
  const codes = resolved.components;
  if (codes.length !== DEFAULT_WAGE_CODES.length || codes.some((c) => !DEFAULT_WAGE_CODES.includes(c))) {
    changed.push({ key: 'wages.components', label: 'Wages for PF, gratuity and bonus', law: nameList(DEFAULT_WAGE_CODES), company: nameList(codes) });
  }
  if (resolved.fiftyPercentRule === false) {
    changed.push({ key: 'wages.fiftyPercentRule', label: 'Labour Code 50% wage rule', law: 'on', company: 'off' });
  }
  return { codes, fiftyPercentRule: resolved.fiftyPercentRule, changed };
};

/** One warning for a payslip worked out with company values that differ from the law. */
const companyValuesWarning = (changed) => (changed.length
  ? {
    code: 'company_values',
    message: `Worked out with your company's own values, not the legal ones: ${changed.map((c) => `${c.label} ${c.company} (law: ${c.law})`).join('; ')}.`,
  }
  : null);

module.exports = {
  SALARY_CODES,
  DEFAULT_WAGE_CODES,
  STANDARD,
  normalizeCompanyCalc,
  resolveCompanyCalc,
  companyEpf,
  companyEsi,
  companyWages,
  companyValuesWarning,
};
