/**
 * Monthly statutory files from published payslips (report §7.8):
 *  - EPF ECR: the text file the EPFO Unified Portal takes for the monthly
 *    return — one line per member, fields joined by #~# (ECR 2.0 layout):
 *    UAN, name, gross wages, EPF wages, EPS wages, EDLI wages, EPF (employee)
 *    contribution, EPS contribution, EPF−EPS difference (employer), NCP days,
 *    refund of advances. Whole rupees.
 *  - ESI: the monthly contribution rows for ESIC's upload (IP number, name,
 *    days paid, the wages ESI was worked out on, reason code, last working
 *    day), as data — the browser writes them into the Excel 97-2003 file
 *    ESIC takes.
 * Members without a UAN / ESIC number are left out and listed. The layouts
 * are to be checked by uploading to the portals (docs/payroll-statutory-values.md).
 * Read-only.
 */
const moment = require('moment-timezone');
const { supabaseAdmin } = require('../config/supabase');
const { BadRequestError } = require('../utils/errors');
const { TIMEZONE } = require('../utils/constants');
const { toPaise } = require('../payroll/money');
const { selectIn, selectAllPages } = require('../utils/selectIn');
const { lastWorkingDayOf } = require('./payroll.service');

const checkMonth = (month, year) => {
  const m = Number(month);
  const y = Number(year);
  if (!(m >= 1 && m <= 12) || !(y >= 2000 && y <= 2100)) throw new BadRequestError('month and year are required');
  return { m, y };
};

const loadMonth = async (companyId, m, y) => {
  if (!companyId) throw new BadRequestError('companyId is required');
  // Every published payslip of the month, a page at a time (one select stops at ~1,000 rows).
  const { data: slips, error } = await selectAllPages(() => supabaseAdmin
    .from('payroll')
    .select('id, employee_id, month, year, gross_salary, pf_deduction, unpaid_leave_days, payslip_status, breakdown_json, company_id')
    .eq('company_id', companyId)
    .eq('month', m)
    .eq('year', y)
    .eq('payslip_status', 'PUBLISHED'));
  if (error) throw new BadRequestError(error.message);
  const ids = [...new Set((slips || []).map((s) => String(s.employee_id)))];
  let employees = [];
  if (ids.length) {
    const { data, error: empErr } = await selectIn(supabaseAdmin, 'employees', 'id, first_name, last_name, employee_code, salary_details', 'id', ids);
    if (empErr) throw new BadRequestError(empErr.message);
    employees = data || [];
  }
  const byId = new Map(employees.map((e) => [String(e.id), e]));
  return (slips || []).map((s) => ({ slip: s, employee: byId.get(String(s.employee_id)) || null }));
};

const nameOf = (e) => `${e?.first_name || ''} ${e?.last_name || ''}`.trim() || e?.employee_code || 'Employee';
const amountOf = (list, name) => Number((list || []).find((x) => x.name === name)?.amount || 0);
const whole = (rupees) => Math.round(toPaise(rupees) / 100); // stored amounts are whole rupees already

/** The ECR line's values for one published payslip, or null when no PF was charged. */
const ecrValues = (slip) => {
  const b = slip.breakdown_json || {};
  const cfg = b.config || {};
  const employeePf = Number(slip.pf_deduction || 0) + amountOf(b.deductions, 'VPF');
  const eps = amountOf(b.employer_contributions, 'Employer PF — pension (EPS)');
  const epfEmployer = amountOf(b.employer_contributions, 'Employer PF — EPF');
  if (!(employeePf > 0) && !(eps > 0) && !(epfEmployer > 0)) return null;
  const wagesUsed = Number(cfg.pf_wages_used ?? cfg.pf_wages ?? 0);
  const ceiling = cfg.pf_ceiling != null ? Number(cfg.pf_ceiling) : wagesUsed;
  const epsWages = cfg.eps_wages != null ? Number(cfg.eps_wages) : (eps > 0 ? Math.min(wagesUsed, ceiling) : 0);
  const edliWages = cfg.edli_wages != null ? Number(cfg.edli_wages) : Math.min(wagesUsed, ceiling);
  return {
    gross: whole(slip.gross_salary),
    epfWages: whole(wagesUsed),
    epsWages: whole(epsWages),
    edliWages: whole(edliWages),
    employeePf: whole(employeePf),
    eps: whole(eps),
    epfEmployer: whole(epfEmployer),
    // Non-contributing days: the month's unpaid days, to a whole day.
    ncpDays: Math.round(Number(slip.unpaid_leave_days || 0)),
  };
};

/** The month's EPF ECR file (text) and the members left out. */
const getEcrFile = async (companyId, month, year) => {
  const { m, y } = checkMonth(month, year);
  const rows = await loadMonth(companyId, m, y);
  const lines = [];
  const skipped = [];
  const totals = { employeePf: 0, eps: 0, epfEmployer: 0 };
  for (const { slip, employee } of rows) {
    const v = ecrValues(slip);
    if (!v) continue;
    const uan = String(employee?.salary_details?.statutory_ids?.uan || '');
    if (!/^\d{12}$/.test(uan)) {
      skipped.push({ employeeId: slip.employee_id, name: nameOf(employee), reason: 'No UAN recorded' });
      continue;
    }
    // The portal reads #~# as the separator, so it can't appear inside a name.
    const name = nameOf(employee).replace(/#~#/g, ' ').replace(/[\r\n]+/g, ' ').toUpperCase();
    lines.push([uan, name, v.gross, v.epfWages, v.epsWages, v.edliWages, v.employeePf, v.eps, v.epfEmployer, v.ncpDays, 0].join('#~#'));
    totals.employeePf += v.employeePf;
    totals.eps += v.eps;
    totals.epfEmployer += v.epfEmployer;
  }
  return {
    text: lines.length ? `${lines.join('\r\n')}\r\n` : '',
    filename: `ecr-${y}-${String(m).padStart(2, '0')}.txt`,
    members: lines.length,
    totals,
    skipped,
  };
};

// ── ESI ─────────────────────────────────────────────────────────────────────
// ESIC's monthly contribution upload (its portal user manual): an Excel
// 97-2003 sheet, every column text, a header row, then one row for every
// insured person (IP) ESIC has mapped to the employer — the upload fails if
// one is missing. Days are whole days (a fraction is rounded up); the reason
// code says why no days were paid; the last working day (dd/mm/yyyy) is
// filled only for reasons 2, 3, 4, 5, 6 and 10, and left blank otherwise.
const ESI_HEADER = ['IP Number', 'IP Name', 'No of Days for which wages paid/payable during the month', 'Total Monthly Wages', 'Reason Code for Zero workings days', 'Last Working Day'];
// ESIC's codes run 0–13; these are the ones payroll can tell for itself.
const ESI_REASON = { PAID: '0', ON_LEAVE: '1', LEFT_SERVICE: '2' };
const ESI_EMPLOYEE_COLUMNS = 'id, first_name, last_name, employee_code, salary_details, is_active, employment_status, offboarded_at, company_id';

const isPublished = (slip) => String(slip?.payslip_status || '').toUpperCase() === 'PUBLISHED';
const esiCovered = (slip) => slip?.breakdown_json?.config?.esi_eligible === true;
/** 2026-10-15 → 15/10/2026, as ESIC asks. */
const ddmmyyyy = (date) => `${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(0, 4)}`;
/** ESIC's IP name column takes letters and spaces only. */
const ipNameOf = (employee) => {
  const name = nameOf(employee);
  return name.replace(/[^A-Za-z ]+/g, ' ').replace(/\s+/g, ' ').trim() || name;
};

/**
 * Days wages were paid for — calendar days, weekly offs included — rounded up
 * to a whole day. Payslips made before ESI's days were stored (November
 * 2026): the month's calendar days × the share of the month paid.
 */
const esiDaysOf = (cfg) => {
  // Nothing of the month paid (absent throughout): no days, the weekly offs included.
  if (cfg.paid_days != null && !(Number(cfg.paid_days) > 0)) return 0;
  let days = Number(cfg.paid_days || 0);
  if (cfg.esi_paid_days != null) days = Number(cfg.esi_paid_days);
  else if (Number(cfg.days_in_month) > 0 && Number(cfg.working_days) > 0) {
    const paidShare = Math.max(0, Number(cfg.working_days) - Number(cfg.unpaid_leave_days || 0)) / Number(cfg.working_days);
    days = Number(cfg.days_in_month) * paidShare;
  }
  // To the hundredth first, so float noise (28.0000001) doesn't add a day.
  return Math.max(0, Math.ceil(Math.round(days * 100) / 100));
};

/**
 * The wages ESI was worked out on, in paise — stored on the payslip
 * (esi_wages). Payslips made before that: the regular pay (earned + overtime)
 * and the one-time pay counted for ESI, as the calculation does — never bonus,
 * gratuity or leave encashment.
 */
const esiWagesOf = (slip) => {
  const cfg = slip?.breakdown_json?.config || {};
  if (cfg.esi_wages != null) return toPaise(cfg.esi_wages);
  const oneTime = (Array.isArray(cfg.one_time) ? cfg.one_time : []).filter((i) => i && i.earning);
  const counted = oneTime.filter((i) => i.esi_wage === true).reduce((a, i) => a + toPaise(i.amount), 0);
  if (cfg.earned_gross != null) return toPaise(cfg.earned_gross) + toPaise(cfg.overtime?.pay || 0) + counted;
  const notCounted = oneTime.filter((i) => i.esi_wage !== true).reduce((a, i) => a + toPaise(i.amount), 0);
  return Math.max(0, toPaise(slip.gross_salary) - notCounted);
};

/** This month's payslips (any status) and last month's published ones — this company's only. */
const loadEsiSlips = async (companyId, m, y) => {
  if (!companyId) throw new BadRequestError('companyId is required');
  const slipsOf = (month, year, publishedOnly) => selectAllPages(() => {
    const query = supabaseAdmin
      .from('payroll')
      .select('id, employee_id, month, year, gross_salary, payslip_status, breakdown_json, company_id')
      .eq('company_id', companyId)
      .eq('month', month)
      .eq('year', year);
    return publishedOnly ? query.eq('payslip_status', 'PUBLISHED') : query;
  });
  const [current, before] = await Promise.all([
    slipsOf(m, y, false),
    m === 1 ? slipsOf(12, y - 1, true) : slipsOf(m - 1, y, true),
  ]);
  if (current.error || before.error) throw new BadRequestError((current.error || before.error).message);
  return { current: current.data || [], lastMonth: (before.data || []).filter(isPublished) };
};

/** These people of this company, by id, with their last working day once its column exists. */
const loadEsiEmployees = async (companyId, ids) => {
  if (!ids.length) return new Map();
  const scoped = { filter: (query) => query.eq('company_id', companyId) };
  let res = await selectIn(supabaseAdmin, 'employees', `${ESI_EMPLOYEE_COLUMNS}, last_working_day`, 'id', ids, scoped);
  if (res.error && /last_working_day/.test(res.error.message || '')) {
    res = await selectIn(supabaseAdmin, 'employees', ESI_EMPLOYEE_COLUMNS, 'id', ids, scoped);
  }
  if (res.error) throw new BadRequestError(res.error.message);
  return new Map((res.data || []).map((e) => [String(e.id), e]));
};

/**
 * The month's ESI contribution rows — the browser writes them into ESIC's
 * .xls. Everyone ESI covered this month, or last month and still on ESIC's
 * list:
 *  - days paid this month: the days, the wages ESI was worked out on, reason 0;
 *  - no days paid: reason 2 (left service) with the last working day if they
 *    left this month, otherwise 1 (on leave);
 *  - left last month after being paid for days in it: 0 days, reason 2 and the
 *    last working day now (ESIC takes a reason only for a month without days).
 * Left out of the file and listed: no 10-digit IP number (missingIp), this
 * month's payslip not published yet (notPublished). `review`: people HR
 * should look at before uploading.
 */
const getEsiFile = async (companyId, month, year) => {
  const { m, y } = checkMonth(month, year);
  const { current, lastMonth } = await loadEsiSlips(companyId, m, y);
  const monthStart = moment.tz({ year: y, month: m - 1, day: 1 }, TIMEZONE);
  const firstDay = monthStart.format('YYYY-MM-DD');
  const lastDay = monthStart.clone().endOf('month').format('YYYY-MM-DD');
  const lastMonthFirstDay = monthStart.clone().subtract(1, 'month').format('YYYY-MM-DD');

  const publishedNow = new Map();
  const draftNow = new Map();
  for (const s of current) (isPublished(s) ? publishedNow : draftNow).set(String(s.employee_id), s);
  const coveredLastMonth = new Map(lastMonth.filter(esiCovered).map((s) => [String(s.employee_id), s]));
  const ids = [...new Set([
    ...current.filter(esiCovered).map((s) => String(s.employee_id)),
    ...coveredLastMonth.keys(),
  ])];
  const people = await loadEsiEmployees(companyId, ids);

  const rows = [];
  const missingIp = [];
  const notPublished = [];
  const review = [];
  for (const id of ids) {
    const employee = people.get(id) || null;
    const person = { employeeId: id, name: nameOf(employee) };
    const slip = publishedNow.get(id);
    const before = coveredLastMonth.get(id);
    const cfg = slip?.breakdown_json?.config || {};
    const leftOn = String(cfg.left_on || lastWorkingDayOf(employee) || before?.breakdown_json?.config?.left_on || '').slice(0, 10) || null;
    // The payslip of the month after someone left pays only what came later (full and final).
    const settlement = Boolean(slip && cfg.left_on && cfg.left_on < firstDay);
    let line = null;
    if (!slip && draftNow.has(id)) {
      notPublished.push({ ...person, reason: 'This month\'s payslip isn\'t published yet' });
      continue;
    }
    if (slip && !settlement) {
      if (!esiCovered(slip)) {
        review.push({ ...person, message: 'Covered by ESI last month but not this month, so not in the file. If ESIC still lists them, add them by hand with the right reason (4 = out of coverage, used in April and October).' });
        continue;
      }
      const days = esiDaysOf(cfg);
      const wages = esiWagesOf(slip);
      if (days > 0) line = { days, wages, reason: ESI_REASON.PAID, leftOn: null };
      else if (leftOn && leftOn >= firstDay && leftOn <= lastDay) line = { days: 0, wages, reason: ESI_REASON.LEFT_SERVICE, leftOn };
      else line = { days: 0, wages, reason: ESI_REASON.ON_LEAVE, leftOn: null };
    } else {
      // No payslip this month, or only a full and final one after leaving.
      if (settlement && esiCovered(slip) && esiWagesOf(slip) > 0) {
        review.push({ ...person, message: `₹${Math.round(esiWagesOf(slip) / 100).toLocaleString('en-IN')} paid after they left (${ddmmyyyy(cfg.left_on)}) was counted for ESI, but ESIC's file has no place for it — check it with ESIC.` });
      }
      if (!before) continue;
      if (leftOn && leftOn < firstDay) {
        // Left last month after days paid in it (filed then with reason 0): now as left.
        // Anyone who left earlier, or had no days last month, ESIC already has as left.
        if (!(leftOn >= lastMonthFirstDay && esiDaysOf(before.breakdown_json?.config || {}) > 0)) continue;
        line = { days: 0, wages: 0, reason: ESI_REASON.LEFT_SERVICE, leftOn };
      } else if (leftOn && leftOn <= lastDay) {
        line = { days: 0, wages: 0, reason: ESI_REASON.LEFT_SERVICE, leftOn };
      } else {
        line = { days: 0, wages: 0, reason: ESI_REASON.ON_LEAVE, leftOn: null };
        review.push({ ...person, message: 'No published payslip this month, so the file shows 0 days with reason 1 (on leave). If they were paid, publish their payslip and download the file again.' });
      }
    }
    const ip = String(employee?.salary_details?.statutory_ids?.esic_ip || '').replace(/\s+/g, '');
    if (!/^\d{10}$/.test(ip)) {
      missingIp.push({ ...person, ipNumber: ip, reason: ip ? `IP number ${ip} isn't 10 digits` : 'No IP number (ESIC number) recorded' });
      continue;
    }
    rows.push({
      employeeId: id,
      employeeCode: employee?.employee_code || '',
      ipNumber: ip,
      ipName: ipNameOf(employee),
      days: String(line.days),
      wages: String(Math.round(line.wages / 100)),
      reasonCode: line.reason,
      lastWorkingDay: line.leftOn ? ddmmyyyy(line.leftOn) : '',
    });
  }
  rows.sort((a, b) => a.employeeCode.localeCompare(b.employeeCode) || a.ipName.localeCompare(b.ipName));
  return {
    filename: `esi-contribution-${y}-${String(m).padStart(2, '0')}.xls`,
    header: ESI_HEADER,
    rows,
    members: rows.length,
    totalWages: rows.reduce((a, r) => a + Number(r.wages), 0),
    missingIp,
    notPublished,
    review,
  };
};

module.exports = {
  getEcrFile, getEsiFile, ecrValues, esiWagesOf, esiDaysOf,
};
