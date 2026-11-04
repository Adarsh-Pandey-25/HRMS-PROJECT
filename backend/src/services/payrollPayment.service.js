/**
 * Paying salaries (report defect D11: "published" used to mean "paid").
 *  - The bank file: one row per published payslip of a month, with the
 *    employee's account, IFSC and net payable (net pay + reimbursements),
 *    to upload to the bank for a bulk transfer.
 *  - Mark paid: once the bank has paid, HR records the payment date and the
 *    bank's reference (UTR) on those payslips.
 * Nothing here changes a payslip's amounts, and nothing is sent to anyone.
 */
const moment = require('moment-timezone');
const { supabaseAdmin } = require('../config/supabase');
const { BadRequestError } = require('../utils/errors');
const { TIMEZONE } = require('../utils/constants');
const { isMissingColumnError } = require('../utils/helpers');
const { toPaise, toRupees } = require('../payroll/money');
const { csvCell } = require('./tdsRegister.service');
const { selectIn } = require('../utils/selectIn');

const PUBLISHED = 'PUBLISHED';
const MAX_MARK_PAID = 500;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Bank details as saved by Edit Employee (ifsc) or onboarding (ifsc_code, account_holder_name). */
const bankOf = (employee) => {
  const b = employee?.bank_details || {};
  return {
    holder: String(b.account_holder_name || b.accountHolderName || '').trim(),
    account: String(b.account_number || b.accountNumber || b.account || '').replace(/\s+/g, ''),
    ifsc: String(b.ifsc || b.ifscCode || b.ifsc_code || '').trim().toUpperCase(),
    bank: String(b.bank_name || b.bankName || '').trim(),
  };
};

const fullName = (e) => `${e?.first_name || ''} ${e?.last_name || ''}`.trim();

/** What the employee receives for a payslip: net pay + reimbursements, as stored. */
const netPayable = (row) => {
  const totals = row?.breakdown_json?.totals || {};
  const value = totals.net_payable ?? (Number(row?.net_salary || 0) + Number(totals.total_reimbursements || 0));
  return toRupees(toPaise(value));
};

const checkMonth = (month, year) => {
  const m = Number(month);
  const y = Number(year);
  if (!(m >= 1 && m <= 12) || !(y >= 2000 && y <= 2100)) throw new BadRequestError('month and year are required');
  return { m, y };
};

/**
 * The month's bank upload file (CSV): published payslips with something to
 * pay. Rows that can't be paid (no account or IFSC) are left out and listed.
 */
const getBankFile = async (companyId, month, year) => {
  if (!companyId) throw new BadRequestError('companyId is required');
  const { m, y } = checkMonth(month, year);
  const { data: slips, error } = await supabaseAdmin
    .from('payroll')
    .select('id, employee_id, month, year, net_salary, payslip_status, breakdown_json, company_id')
    .eq('company_id', companyId)
    .eq('month', m)
    .eq('year', y)
    .eq('payslip_status', PUBLISHED);
  if (error) throw new BadRequestError(error.message);
  const ids = [...new Set((slips || []).map((s) => String(s.employee_id)))];
  let employees = [];
  if (ids.length) {
    const { data, error: empErr } = await selectIn(supabaseAdmin, 'employees', 'id, first_name, last_name, employee_code, bank_details', 'id', ids);
    if (empErr) throw new BadRequestError(empErr.message);
    employees = data || [];
  }
  const byId = new Map(employees.map((e) => [String(e.id), e]));
  const label = moment.tz({ year: y, month: m - 1, day: 1 }, TIMEZONE).format('MMM YYYY');
  const rows = [];
  const skipped = [];
  let totalPaise = 0;
  for (const s of slips || []) {
    const e = byId.get(String(s.employee_id));
    const amount = netPayable(s);
    if (!(amount > 0)) continue;
    const bank = bankOf(e);
    if (!bank.account || !bank.ifsc) {
      skipped.push({ employeeId: s.employee_id, name: fullName(e) || 'Employee', reason: 'No account number or IFSC' });
      continue;
    }
    totalPaise += toPaise(amount);
    rows.push([
      bank.holder || fullName(e),
      bank.account,
      bank.ifsc,
      bank.bank,
      amount.toFixed(2),
      `Salary ${label}`,
      e?.employee_code || '',
    ]);
  }
  rows.sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  const header = ['Beneficiary name', 'Account number', 'IFSC', 'Bank', 'Amount (Rs)', 'Narration', 'Employee code'];
  // Plain digits for the bank's upload. (Opening and re-saving the file in a
  // spreadsheet can turn long account numbers into 1.23E+15 — the page warns.)
  const csv = [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n');
  return {
    csv: `${csv}\r\n`,
    filename: `bank-file-${y}-${String(m).padStart(2, '0')}.csv`,
    count: rows.length,
    total: toRupees(totalPaise),
    skipped,
  };
};

/**
 * Record that the bank has paid these published payslips: the date and the
 * bank's reference (UTR or batch reference). Until the SQL file
 * 20261103_payroll_payment_reference.sql is run, only the status is saved.
 */
const markPaid = async ({
  companyId, payslipIds, paidOn, reference, actor, ipAddress = null,
}) => {
  if (!companyId) throw new BadRequestError('companyId is required');
  const ids = [...new Set((Array.isArray(payslipIds) ? payslipIds : []).map(String))];
  if (!ids.length) throw new BadRequestError('Choose the payslips that were paid');
  if (ids.length > MAX_MARK_PAID) throw new BadRequestError(`At most ${MAX_MARK_PAID} payslips at a time`);
  if (ids.some((id) => !UUID.test(id))) throw new BadRequestError('Unknown payslip in the list — reload and try again');
  const day = moment.tz(String(paidOn || ''), 'YYYY-MM-DD', true, TIMEZONE);
  if (!day.isValid()) throw new BadRequestError('Enter the date the bank paid');
  if (day.isAfter(moment.tz(TIMEZONE), 'day')) throw new BadRequestError('The payment date can\'t be in the future');
  const ref = String(reference || '').trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9 /_-]{2,63}$/.test(ref)) {
    throw new BadRequestError('Enter the bank reference (UTR): 3–64 letters or digits');
  }

  const { data: rows, error } = await selectIn(supabaseAdmin, 'payroll', 'id, company_id, payslip_status, month, year', 'id', ids);
  if (error) throw new BadRequestError(error.message);
  const wanted = new Set(ids);
  const mine = (rows || []).filter((r) => wanted.has(String(r.id)) && String(r.company_id) === String(companyId));
  if (mine.length !== ids.length) throw new BadRequestError('Some payslips weren\'t found — reload and try again');
  const notPublished = mine.filter((r) => String(r.payslip_status || '').toUpperCase() !== PUBLISHED);
  if (notPublished.length) throw new BadRequestError('Only published payslips can be marked paid — publish them first');
  const monthStart = moment.tz({ year: mine[0].year, month: mine[0].month - 1, day: 1 }, TIMEZONE);
  if (mine.some((r) => day.isBefore(moment.tz({ year: r.year, month: r.month - 1, day: 1 }, TIMEZONE), 'day'))) {
    throw new BadRequestError(`The payment date can't be before the payslip's month (${monthStart.format('MMMM YYYY')})`);
  }

  const patch = { payment_status: 'paid', paid_on: day.format('YYYY-MM-DD'), payment_reference: ref };
  // A batch at a time: hundreds of ids in one IN filter can pass the URL length limit.
  const write = async (fields) => {
    const done = [];
    for (let i = 0; i < ids.length; i += 100) {
      // eslint-disable-next-line no-await-in-loop
      const { data, error: e } = await supabaseAdmin
        .from('payroll')
        .update(fields)
        .in('id', ids.slice(i, i + 100))
        .eq('company_id', companyId)
        .eq('payslip_status', PUBLISHED)
        .select('id');
      if (e) return { data: null, error: e };
      done.push(...(data || []));
    }
    return { data: done, error: null };
  };
  let { data: updated, error: updErr } = await write(patch);
  let referenceStored = true;
  if (updErr && (isMissingColumnError(updErr.message, 'paid_on') || isMissingColumnError(updErr.message, 'payment_reference'))) {
    referenceStored = false;
    ({ data: updated, error: updErr } = await write({ payment_status: 'paid' }));
  }
  if (updErr) throw new BadRequestError(updErr.message);

  require('./auditLog.service').logAudit({
    companyId,
    actorId: actor?.id || null,
    actorRole: actor?.role || null,
    actionType: 'payroll.payment.mark_paid',
    targetType: 'payroll',
    targetId: null,
    afterState: {
      payslips: (updated || []).length, paid_on: patch.paid_on, reference: ref, reference_stored: referenceStored,
    },
    ipAddress,
  }).catch(() => {});

  return { updated: (updated || []).length, referenceStored };
};

module.exports = {
  getBankFile, markPaid, bankOf, netPayable,
};
