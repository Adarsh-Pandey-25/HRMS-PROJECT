/**
 * Salary TDS register (report §7.7 outputs): what payroll deducted as TDS,
 * from published payslips only (drafts can still change) —
 *  - per month, with the deposit date (by the 7th of the next month);
 *  - per quarter, for the quarterly TDS statement (Form 138, was 24Q);
 *  - per employee, for the year's certificate (Form 130 Part B, was Form 16).
 * Read-only. Amounts in rupees.
 */
const moment = require('moment-timezone');
const { supabaseAdmin } = require('../config/supabase');
const { BadRequestError } = require('../utils/errors');
const { TIMEZONE } = require('../utils/constants');
const { toPaise, toRupees } = require('../payroll/money');
const { selectIn } = require('../utils/selectIn');

const PAGE = 1000;

const QUARTERS = [
  { key: 'Q1', label: 'April–June', months: [4, 5, 6] },
  { key: 'Q2', label: 'July–September', months: [7, 8, 9] },
  { key: 'Q3', label: 'October–December', months: [10, 11, 12] },
  { key: 'Q4', label: 'January–March', months: [1, 2, 3] },
];
const quarterOf = (month) => QUARTERS.find((q) => q.months.includes(month)).key;

/** '2026-27' → 2026, or a 400. */
const taxYearStart = (taxYear) => {
  const m = /^(\d{4})-(\d{2})$/.exec(String(taxYear || ''));
  if (!m || Number(m[2]) !== (Number(m[1]) + 1) % 100 || Number(m[1]) < 2000 || Number(m[1]) > 2100) {
    throw new BadRequestError('Tax year must look like 2026-27');
  }
  return Number(m[1]);
};

/** The tax year's twelve months, April to March. */
const taxYearMonths = (startYear) => [
  ...[4, 5, 6, 7, 8, 9, 10, 11, 12].map((month) => ({ month, year: startYear })),
  ...[1, 2, 3].map((month) => ({ month, year: startYear + 1 })),
];

const isPublished = (r) => String(r.payslip_status || '').toUpperCase() === 'PUBLISHED';

/** Every payslip row of the company in the tax year (published and draft). */
const loadSlips = async (companyId, startYear) => {
  const rows = [];
  for (let offset = 0; ; offset += PAGE) {
    // eslint-disable-next-line no-await-in-loop
    const { data, error } = await supabaseAdmin
      .from('payroll')
      .select('*')
      .eq('company_id', companyId)
      .in('year', [startYear, startYear + 1])
      .order('id', { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (error) throw new BadRequestError(error.message);
    rows.push(...(data || []));
    if (!data || data.length < PAGE) break;
  }
  const inYear = taxYearMonths(startYear);
  return rows.filter((r) => inYear.some((p) => p.month === Number(r.month) && p.year === Number(r.year)));
};

const loadEmployees = async (ids) => {
  if (!ids.length) return new Map();
  const { data, error } = await selectIn(supabaseAdmin, 'employees', 'id, first_name, last_name, employee_code, salary_details', 'id', ids);
  if (error) throw new BadRequestError(error.message);
  return new Map((data || []).map((e) => [String(e.id), e]));
};

const nameOf = (e) => `${e?.first_name || ''} ${e?.last_name || ''}`.trim() || e?.employee_code || 'Employee';
const panOf = (e) => String(e?.salary_details?.statutory_ids?.pan || '').toUpperCase();
const monthLabel = (month, year) => moment.tz({ year, month: month - 1, day: 1 }, TIMEZONE).format('MMM YYYY');

/**
 * The register for one company and tax year.
 */
const getTdsRegister = async (companyId, taxYear) => {
  if (!companyId) throw new BadRequestError('companyId is required');
  const startYear = taxYearStart(taxYear);
  const slips = await loadSlips(companyId, startYear);
  const published = slips.filter(isPublished);
  const employees = await loadEmployees([...new Set(published.map((r) => String(r.employee_id)))]);

  const months = taxYearMonths(startYear).map(({ month, year }) => {
    const rows = published.filter((r) => Number(r.month) === month && Number(r.year) === year);
    const next = moment.tz({ year, month: month - 1, day: 1 }, TIMEZONE).add(1, 'month');
    return {
      month,
      year,
      label: monthLabel(month, year),
      quarter: quarterOf(month),
      payslips: rows.length,
      withTds: rows.filter((r) => toPaise(r.tds) > 0).length,
      gross: toRupees(rows.reduce((s, r) => s + toPaise(r.gross_salary), 0)),
      tds: toRupees(rows.reduce((s, r) => s + toPaise(r.tds), 0)),
      drafts: slips.filter((r) => !isPublished(r) && Number(r.month) === month && Number(r.year) === year).length,
      // Deposit by the 7th of the next month (report §3.4). March: confirm with
      // the CA — under the 1961 Act rules it was 30 April.
      depositBy: next.clone().date(7).format('YYYY-MM-DD'),
      depositToConfirm: month === 3,
    };
  });

  const quarters = QUARTERS.map((q) => {
    const rows = published.filter((r) => q.months.includes(Number(r.month)));
    return {
      key: q.key,
      label: q.label,
      payslips: rows.length,
      employees: new Set(rows.map((r) => String(r.employee_id))).size,
      gross: toRupees(rows.reduce((s, r) => s + toPaise(r.gross_salary), 0)),
      tds: toRupees(rows.reduce((s, r) => s + toPaise(r.tds), 0)),
    };
  });

  const byEmployee = new Map();
  for (const r of published) {
    const id = String(r.employee_id);
    if (!byEmployee.has(id)) byEmployee.set(id, []);
    byEmployee.get(id).push(r);
  }
  const people = [...byEmployee.entries()].map(([id, rows]) => {
    const e = employees.get(id);
    const latest = [...rows].sort((a, b) => (Number(a.year) * 12 + Number(a.month)) - (Number(b.year) * 12 + Number(b.month))).pop();
    const tax = latest?.breakdown_json?.config?.tax || null;
    return {
      employeeId: id,
      name: nameOf(e),
      code: e?.employee_code || '',
      pan: panOf(e),
      regime: tax?.regime || null,
      payslips: rows.length,
      gross: toRupees(rows.reduce((s, r) => s + toPaise(r.gross_salary), 0)),
      tds: toRupees(rows.reduce((s, r) => s + toPaise(r.tds), 0)),
      byMonth: Object.fromEntries(rows.map((r) => [`${r.year}-${String(r.month).padStart(2, '0')}`, Number(r.tds || 0)])),
      // The latest projection of the year's tax, if TDS is worked out from the slabs.
      projectedAnnualTax: tax ? Number(tax.annual_tax || 0) : null,
    };
  }).sort((a, b) => a.name.localeCompare(b.name));

  return {
    taxYear: `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`,
    months,
    quarters,
    employees: people,
    totals: {
      gross: toRupees(published.reduce((s, r) => s + toPaise(r.gross_salary), 0)),
      tds: toRupees(published.reduce((s, r) => s + toPaise(r.tds), 0)),
    },
    draftsNotCounted: slips.length - published.length,
    withoutPan: people.filter((p) => !p.pan && p.tds > 0).length,
  };
};

/** One CSV cell: quoted when needed, and never read as a formula by a spreadsheet. */
const csvCell = (value) => {
  let s = value == null ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/**
 * The quarter's deductee rows for the TDS statement (Form 138, was 24Q) —
 * one row per published payslip, for the company's accountant or the
 * return-preparation utility. Not the statutory file format itself.
 */
const getForm138Csv = async (companyId, taxYear, quarterKey) => {
  if (!companyId) throw new BadRequestError('companyId is required');
  const startYear = taxYearStart(taxYear);
  const quarter = QUARTERS.find((q) => q.key === String(quarterKey || '').toUpperCase());
  if (!quarter) throw new BadRequestError('Quarter must be Q1, Q2, Q3 or Q4');
  const slips = (await loadSlips(companyId, startYear))
    .filter((r) => isPublished(r) && quarter.months.includes(Number(r.month)));
  const employees = await loadEmployees([...new Set(slips.map((r) => String(r.employee_id)))]);
  const header = ['Employee code', 'Employee name', 'PAN', 'Month', 'Paid on', 'Amount paid (Rs)', 'TDS deducted (Rs)', 'Section', 'Tax regime'];
  const rows = slips
    .sort((a, b) => (Number(a.year) * 12 + Number(a.month)) - (Number(b.year) * 12 + Number(b.month))
      || nameOf(employees.get(String(a.employee_id))).localeCompare(nameOf(employees.get(String(b.employee_id)))))
    .map((r) => {
      const e = employees.get(String(r.employee_id));
      const paidOn = r.published_at ? moment(r.published_at).tz(TIMEZONE).format('YYYY-MM-DD') : '';
      return [
        e?.employee_code || '',
        nameOf(e),
        panOf(e) || 'PANNOTAVBL', // the return utility's placeholder for a missing PAN
        monthLabel(Number(r.month), Number(r.year)),
        paidOn,
        Number(r.gross_salary || 0).toFixed(2),
        Number(r.tds || 0).toFixed(2),
        '392 (salary)',
        r.breakdown_json?.config?.tax?.regime || '',
      ];
    });
  const csv = [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n');
  const fy = `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`;
  return { csv: `${csv}\r\n`, filename: `form138-data-${fy}-${quarter.key}.csv`, rows: rows.length };
};

module.exports = {
  getTdsRegister, getForm138Csv, csvCell, QUARTERS,
};
