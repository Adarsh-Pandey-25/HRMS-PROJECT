#!/usr/bin/env node
/**
 * Repairs attendance recorded before the attendance-day fix (Oct 2026).
 *
 *  1. Biometric days. A punch before shift start used to be filed under the
 *     previous day, so an early arrival became yesterday's check-out
 *     (10:36 → 09:13 next morning = "22h 37m") and today started from the
 *     evening punch. Each affected employee's biometric days are rebuilt
 *     from their raw punches (device_punches) with the corrected rules.
 *  2. Forgotten web check-outs. The 4 AM auto check-out counted the whole
 *     night (15–17 h) and credited overtime. Those days are re-scored as the
 *     shift's length (or a half day, per Settings → Payroll → Pay rules),
 *     with no overtime.
 *
 * Open draft payslips of the affected employees are recalculated afterwards;
 * published payslips are left alone.
 *
 *   node scripts/repair-attendance.js                     dry run, last 60 days
 *   node scripts/repair-attendance.js --since 2026-08-01  dry run from a date
 *   node scripts/repair-attendance.js --since 2026-08-01 --apply
 *   add --company <id> to limit it to one company
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const moment = require('moment-timezone');
const { supabaseAdmin } = require('../src/config/supabase');
const { TIMEZONE } = require('../src/utils/constants');
const { getShiftDayWindow, calculateWorkingHours } = require('../src/utils/helpers');
const attendanceService = require('../src/services/attendance.service');

const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const option = (n) => { const i = args.indexOf(`--${n}`); return i !== -1 ? args[i + 1] : null; };
const APPLY = flag('apply');
const since = option('since') ? moment.tz(option('since'), 'YYYY-MM-DD', TIMEZONE) : moment.tz(TIMEZONE).subtract(60, 'days').startOf('day');
const onlyCompany = option('company');
if (!since.isValid()) { console.error('--since must be YYYY-MM-DD'); process.exit(1); }

const fmt = (iso) => (iso ? moment(iso).tz(TIMEZONE).format('DD MMM HH:mm') : '—');
const pageAll = async (build) => {
  const out = []; const size = 1000;
  for (let from = 0; ; from += size) {
    // eslint-disable-next-line no-await-in-loop
    const { data, error } = await build().range(from, from + size - 1);
    if (error) throw new Error(error.message);
    out.push(...(data || []));
    if (!data || data.length < size) break;
  }
  return out;
};

const repairBiometric = async (touched) => {
  const sinceIso = since.clone().subtract(1, 'day').toISOString();
  const punches = await pageAll(() => {
    let q = supabaseAdmin.from('device_punches').select('employee_id, company_id, punch_time')
      .not('employee_id', 'is', null).gte('punch_time', sinceIso).order('punch_time', { ascending: true });
    if (onlyCompany) q = q.eq('company_id', onlyCompany);
    return q;
  });
  const byEmployee = new Map();
  for (const p of punches) {
    if (!byEmployee.has(p.employee_id)) byEmployee.set(p.employee_id, []);
    byEmployee.get(p.employee_id).push(p);
  }

  let changedEmployees = 0;
  for (const [employeeId, list] of byEmployee) {
    // eslint-disable-next-line no-await-in-loop
    const shiftStart = await attendanceService.getEmployeeShiftStart(employeeId).catch(() => '09:30');
    // The corrected days: first and last punch per attendance day.
    const days = new Map();
    for (const p of list) {
      const w = getShiftDayWindow(moment(p.punch_time).tz(TIMEZONE), shiftStart);
      const key = w.windowStart.toISOString();
      const d = days.get(key) || { windowStart: key, workDate: w.workDate, first: p.punch_time, last: p.punch_time, n: 0 };
      d.last = p.punch_time; d.n += 1;
      days.set(key, d);
    }
    // eslint-disable-next-line no-await-in-loop
    const { data: rows, error } = await supabaseAdmin.from('attendance')
      .select('id, check_in_time, check_out_time, total_hours, status, checkout_status')
      .eq('employee_id', employeeId).eq('check_in_method', 'biometric').gte('check_in_time', sinceIso)
      .order('check_in_time', { ascending: true });
    if (error) throw new Error(error.message);

    const wanted = [...days.values()];
    const matches = (r) => wanted.some((d) => d.first === r.check_in_time && (r.check_out_time == null || r.check_out_time === d.last));
    const wrong = (rows || []).filter((r) => !matches(r));
    const missing = wanted.filter((d) => !(rows || []).some((r) => r.check_in_time === d.first));
    if (!wrong.length && !missing.length) continue;
    changedEmployees += 1;

    console.log(`\n• Employee ${employeeId} (shift ${shiftStart})`);
    for (const r of wrong) console.log(`    wrong : ${fmt(r.check_in_time)} → ${fmt(r.check_out_time)}  ${r.total_hours ?? '—'} h  (${r.status})`);
    for (const d of wanted.filter((x) => wrong.length || missing.includes(x))) {
      const h = d.n > 1 ? calculateWorkingHours(d.first, d.last) : null;
      console.log(`    fixed : ${d.workDate}  ${fmt(d.first)} → ${d.n > 1 ? fmt(d.last) : 'missed check-out'}${h != null ? `  ${h} h` : ''}`);
    }
    if (!APPLY) continue;

    // Rebuild every biometric day of this employee in the range from punches.
    const ids = (rows || []).map((r) => r.id);
    if (ids.length) {
      // eslint-disable-next-line no-await-in-loop
      const { error: delErr } = await supabaseAdmin.from('attendance').delete().in('id', ids);
      if (delErr) throw new Error(delErr.message);
    }
    for (const d of wanted) {
      // eslint-disable-next-line no-await-in-loop
      await attendanceService.recomputeBiometricWindow(employeeId, d.windowStart);
    }
    touched.add(employeeId);
  }
  return changedEmployees;
};

const repairForgottenCheckouts = async (touched) => {
  const { getPayrollRules } = require('../src/utils/payrollRules');
  const rows = await pageAll(() => {
    let q = supabaseAdmin.from('attendance')
      .select('id, employee_id, company_id, check_in_time, check_out_time, total_hours, overtime_hours, status, check_in_method')
      .eq('is_auto_checkout', true).neq('check_in_method', 'biometric').gte('check_in_time', since.toISOString());
    if (onlyCompany) q = q.eq('company_id', onlyCompany);
    return q;
  });
  let changed = 0;
  const rulesByCompany = new Map();
  for (const r of rows) {
    // eslint-disable-next-line no-await-in-loop
    const ctx = await attendanceService.getEmployeeAttendanceContext(r.employee_id);
    if (!rulesByCompany.has(ctx.companyId)) rulesByCompany.set(ctx.companyId, await getPayrollRules(ctx.companyId));
    const half = rulesByCompany.get(ctx.companyId).missedCheckout === 'half';
    const hours = Math.min(calculateWorkingHours(r.check_in_time, r.check_out_time), half ? ctx.rules.expectedHours / 2 : ctx.rules.expectedHours);
    let status = attendanceService.statusForRules(r.check_in_time, hours, ctx.rules);
    if (half) status = 'half_day';
    if (r.status === 'wfh') status = 'wfh';
    const total = Math.round(hours * 100) / 100;
    if (Number(r.total_hours) === total && Number(r.overtime_hours || 0) === 0 && r.status === status) continue;
    changed += 1;
    console.log(`  forgot check-out: ${r.employee_id}  ${fmt(r.check_in_time)} → ${fmt(r.check_out_time)}  ${r.total_hours} h (${r.status}, OT ${r.overtime_hours || 0}) → ${total} h (${status}, OT 0)`);
    if (!APPLY) continue;
    // eslint-disable-next-line no-await-in-loop
    const { error } = await supabaseAdmin.from('attendance')
      .update({ total_hours: total, overtime_hours: 0, status, updated_at: new Date().toISOString() }).eq('id', r.id);
    if (error) throw new Error(error.message);
    touched.add(r.employee_id);
  }
  return changed;
};

const main = async () => {
  if (!process.env.SUPABASE_URL) throw new Error('Run inside the backend folder, where .env holds SUPABASE_URL.');
  console.log(`${APPLY ? 'APPLYING' : 'DRY RUN (nothing is changed — add --apply)'} · from ${since.format('DD MMM YYYY')}${onlyCompany ? ` · company ${onlyCompany}` : ''}`);
  const touched = new Set();
  console.log('\n── Biometric days ──');
  const b = await repairBiometric(touched);
  console.log(b ? '' : '  nothing to fix');
  console.log('\n── Forgotten web check-outs ──');
  const w = await repairForgottenCheckouts(touched);
  console.log(w ? '' : '  nothing to fix');

  if (APPLY && touched.size) {
    console.log(`\nRecalculating open draft payslips for ${touched.size} employee(s)…`);
    const payroll = require('../src/services/payroll.service');
    for (const employeeId of touched) {
      // eslint-disable-next-line no-await-in-loop
      const ctx = await attendanceService.getEmployeeAttendanceContext(employeeId);
      // eslint-disable-next-line no-await-in-loop
      await payroll.recalculatePayslipsFromSettings({ employeeId, companyId: ctx.companyId, draftsOnly: true })
        .catch((e) => console.log(`  ${employeeId}: ${e.message}`));
    }
  }
  console.log(`\nDone. ${b} employee(s) with biometric days ${APPLY ? 'rebuilt' : 'to rebuild'}, ${w} forgotten check-out(s) ${APPLY ? 're-scored' : 'to re-score'}.`);
};

main().then(() => process.exit(0)).catch((e) => { console.error(`\n✖ ${e.message}`); process.exit(1); });
