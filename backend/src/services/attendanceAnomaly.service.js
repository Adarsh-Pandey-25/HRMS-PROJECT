const moment = require('moment-timezone');
const { supabaseAdmin } = require('../config/supabase');
const logger = require('../utils/logger');
const { TIMEZONE, WORK_HOURS } = require('../utils/constants');
const emailService = require('./email.service');
const { isFeatureEmailSuppressed } = require('./emailSuppression.service');

/**
 * Item 4 thresholds — stated explicitly since neither was already defined
 * elsewhere for this purpose:
 *  - Late grace period: reuses attendance_config.gracePeriodMinutes (the
 *    same setting determineAttendanceStatus already applies when writing
 *    the attendance row's own status — so "late" here is definitionally
 *    the same "late" already shown everywhere else in the app, not a
 *    second, possibly-inconsistent definition).
 *  - Short-hours threshold: 30 minutes (0.5h) short of the employee's own
 *    shift duration, picked so a trivial 5-10 minute shortfall never
 *    triggers an email.
 */
const SHORT_HOURS_THRESHOLD = 0.5;

const getAttendanceConfig = async (companyId) => {
  const settingsService = require('./settings.service');
  const raw = await settingsService.getSetting('attendance_config', null, companyId);
  const cfg = (raw && typeof raw === 'object') ? raw : {};
  return {
    gracePeriodMinutes: Number(cfg.gracePeriodMinutes ?? cfg.grace_period_minutes ?? 15),
    shifts: Array.isArray(cfg.shifts) ? cfg.shifts : [],
  };
};

/** Same WFH check attendance.service.js's getMonthlySummary already uses — status='wfh', or a WFH flag on the location blob. */
const isWfhRow = (row) => {
  const loc = (row.location && typeof row.location === 'object') ? row.location : {};
  return row.status === 'wfh' || Boolean(loc.is_wfh || loc.wfh);
};

const resolveShift = (employeeAddress, shifts) => {
  const addr = (employeeAddress && typeof employeeAddress === 'object') ? employeeAddress : {};
  const shiftId = addr.shift_id || addr.shiftId;
  const shiftName = addr.shift;
  if (!shiftId && !shiftName) return null;
  return (shifts || []).find((s) => (shiftId && s.id === shiftId) || (shiftName && s.name === shiftName)) || null;
};

/** Expected shift duration in hours — end minus start, wrapping past midnight for overnight shifts. Falls back to the global WORK_HOURS when no shift is assigned. */
const resolveExpectedHours = (shift) => {
  if (!shift?.start || !shift?.end) return WORK_HOURS;
  const [sh, sm] = shift.start.split(':').map(Number);
  const [eh, em] = shift.end.split(':').map(Number);
  if (![sh, sm, eh, em].every(Number.isFinite)) return WORK_HOURS;
  let mins = (eh * 60 + em) - (sh * 60 + sm);
  if (mins <= 0) mins += 24 * 60;
  return mins / 60;
};

/**
 * For one company + one calendar date (YYYY-MM-DD, the prior day the cron
 * runs against): finds every active employee who is NOT on approved leave,
 * NOT on a company holiday, and has one of: no attendance record, late
 * check-in beyond grace, or hours short of their shift by more than the
 * threshold. Mutually exclusive per employee — absent takes priority over
 * late, which takes priority over short-hours, so nobody gets two emails
 * for the same day.
 */
const detectAnomaliesForCompanyDate = async (companyId, dateStr) => {
  const dayStart = moment.tz(dateStr, TIMEZONE).startOf('day');
  const dow = dayStart.day();
  // Same weekend definition already used by getMonthlySummary's workingDays calc.
  if (dow === 0 || dow === 6) return [];

  const { data: holiday } = await supabaseAdmin
    .from('holidays')
    .select('id')
    .eq('company_id', companyId)
    .eq('date', dateStr)
    .maybeSingle();
  if (holiday) return [];

  const { data: employees, error: empError } = await supabaseAdmin
    .from('employees')
    .select('id, first_name, last_name, email, address, date_of_joining')
    .eq('company_id', companyId)
    .eq('is_active', true);
  if (empError) throw empError;
  if (!employees?.length) return [];

  const { data: approvedLeaves } = await supabaseAdmin
    .from('leaves')
    .select('employee_id')
    .eq('status', 'approved')
    .lte('from_date', dateStr)
    .gte('to_date', dateStr)
    .in('employee_id', employees.map((e) => e.id));
  const onLeave = new Set((approvedLeaves || []).map((l) => l.employee_id));

  const config = await getAttendanceConfig(companyId);
  const anomalies = [];

  for (const emp of employees) {
    if (onLeave.has(emp.id)) continue;
    // Don't flag someone for days before they'd even joined.
    if (emp.date_of_joining && emp.date_of_joining > dateStr) continue;

    const shift = resolveShift(emp.address, config.shifts);
    const shiftStart = shift?.start || '09:30';
    const expectedHours = resolveExpectedHours(shift);
    // The shift-day window for THIS calendar date is [this date's shift
    // start, next date's shift start) — built directly from the date being
    // checked rather than via getShiftDayWindow (which classifies an
    // arbitrary check-in timestamp into a shift-day, a different job; using
    // it here with a fixed "noon" anchor would misclassify any shift whose
    // start time falls after noon, e.g. a 22:00 Night Shift).
    const [shiftHour, shiftMinute] = shiftStart.split(':').map(Number);
    const windowStart = dayStart.clone().hour(shiftHour || 0).minute(shiftMinute || 0).second(0).millisecond(0);
    const windowEnd = windowStart.clone().add(1, 'day');

    // Section G1: check_in_method/check_out_method read here (unfiltered —
    // this cron queries `attendance` directly, never through item 8's
    // display-layer filtering) so a late/short-hours anomaly whose ONLY
    // record is biometric-sourced can be tagged for the email gate below.
    // "Absent" (no row at all) is structurally never biometric-sourced —
    // if a biometric punch existed, `row` would exist and the type would
    // be late/short_hours/no-anomaly, not absent — so it's always sent as
    // the feature-agnostic alert it already is, no gating needed there.
    const { data: rows } = await supabaseAdmin
      .from('attendance')
      .select('status, check_in_time, total_hours, location, check_in_method, check_out_method, checkout_status')
      .eq('employee_id', emp.id)
      .gte('check_in_time', windowStart.toISOString())
      .lt('check_in_time', windowEnd.toISOString())
      .order('check_in_time', { ascending: true })
      .limit(1);
    const row = rows?.[0];

    if (!row) {
      anomalies.push({ employee: emp, type: 'absent' });
      continue;
    }
    if (isWfhRow(row)) continue;
    // A biometric row that hasn't finalized yet (checkout_status defaults
    // to 'finalized' on every non-biometric row, so this only ever gates
    // biometric ones) is not authoritative — total_hours/status can still
    // change. Skip silently this pass rather than flag on stale data;
    // nothing gets written to attendance_anomaly_alerts_log, so a later
    // pass (the 3-hour interval fallback, or the next day's run) picks it
    // up correctly once it finalizes. See the investigation note on why
    // this cron's own 7 AM timing can run before some shifts' windows close.
    if (row.checkout_status && row.checkout_status !== 'finalized') continue;

    const sourceIsBiometric = row.check_in_method === 'biometric' || row.check_out_method === 'biometric';

    if (row.status === 'late') {
      const checkIn = moment(row.check_in_time).tz(TIMEZONE);
      const graceEnd = windowStart.clone().add(config.gracePeriodMinutes, 'minutes');
      const minutesLate = Math.max(0, checkIn.diff(graceEnd, 'minutes'));
      anomalies.push({ employee: emp, type: 'late', minutesLate, sourceIsBiometric });
      continue;
    }

    // Section 5: a finalized Half Day already communicates "short hours"
    // as the more specific, badge-visible signal — sending the generic
    // short_hours email on top would tell the employee the same fact twice
    // in two different wordings. Suppressed here rather than adding a
    // separate Half Day email, since none exists in this codebase today.
    if (row.status === 'half_day') continue;

    const workedHours = Number(row.total_hours || 0);
    if (workedHours > 0 && expectedHours - workedHours > SHORT_HOURS_THRESHOLD) {
      anomalies.push({
        employee: emp,
        type: 'short_hours',
        workedHours: Math.round(workedHours * 100) / 100,
        expectedHours: Math.round(expectedHours * 100) / 100,
        sourceIsBiometric,
      });
    }
  }

  return anomalies;
};

const alreadyAlerted = async (employeeId, dateStr) => {
  const { data } = await supabaseAdmin
    .from('attendance_anomaly_alerts_log')
    .select('id')
    .eq('employee_id', employeeId)
    .eq('alert_date', dateStr)
    .maybeSingle();
  return Boolean(data);
};

const sendAnomalyAlert = async (companyId, dateStr, dateLabel, anomaly, biometricSuppressed) => {
  const { employee, type } = anomaly;
  // Section G1: HARD RULE — biometric-sourced late/short-hours alerts are
  // absolutely blocked while biometric_adms visibility is off, regardless
  // of data_collection_mode. The anomaly is still logged below (internal
  // record-keeping, never an email) so re-runs stay correctly deduped.
  const suppressed = Boolean(anomaly.sourceIsBiometric) && biometricSuppressed;
  if (!suppressed) {
    try {
      if (type === 'absent') {
        await emailService.attendanceAbsentAlertEmail(employee, dateLabel);
      } else if (type === 'late') {
        await emailService.attendanceLateAlertEmail(employee, dateLabel, anomaly.minutesLate);
      } else {
        await emailService.attendanceShortHoursAlertEmail(employee, dateLabel, anomaly.workedHours, anomaly.expectedHours);
      }
    } catch (err) {
      logger.error('[AttendanceAnomaly] Failed to send employee alert email', { employeeId: employee.id, type, error: err.message });
    }
  } else {
    logger.info('[EmailSuppression] Suppressed biometric-sourced anomaly alert', { companyId, employeeId: employee.id, type, dateStr });
  }

  const { error } = await supabaseAdmin.from('attendance_anomaly_alerts_log').insert({
    company_id: companyId,
    employee_id: employee.id,
    alert_date: dateStr,
    anomaly_type: type,
    details: type === 'late' ? { minutesLate: anomaly.minutesLate }
      : type === 'short_hours' ? { workedHours: anomaly.workedHours, expectedHours: anomaly.expectedHours }
      : {},
    sent_to: employee.email,
  });
  if (error) logger.error('[AttendanceAnomaly] Failed to log alert', { employeeId: employee.id, error: error.message });
};

const sendHrDigest = async (companyId, dateLabel, anomalies, biometricSuppressed) => {
  // Section G1: "any HR digest line referencing biometric-sourced anomalies"
  // is gated the same as the individual alert — filtered out of the digest
  // entirely, not just relabeled, while non-biometric lines in the same
  // digest still send normally.
  const visibleAnomalies = anomalies.filter((a) => !(a.sourceIsBiometric && biometricSuppressed));
  if (!visibleAnomalies.length) return;
  const { data: hrAdmins } = await supabaseAdmin
    .from('employees')
    .select('id, first_name, email')
    .eq('company_id', companyId)
    .eq('is_active', true)
    .in('role', ['hr', 'admin']);
  if (!hrAdmins?.length) return;

  const digestRows = visibleAnomalies.map((a) => ({
    employeeName: `${a.employee.first_name || ''} ${a.employee.last_name || ''}`.trim(),
    type: a.type,
    minutesLate: a.minutesLate,
    workedHours: a.workedHours,
    expectedHours: a.expectedHours,
  }));

  await Promise.all(hrAdmins.map((r) =>
    emailService.attendanceAnomalyDigestEmail(r, dateLabel, digestRows).catch((err) =>
      logger.error('[AttendanceAnomaly] Failed to send HR digest', { recipient: r.id, error: err.message }))));
};

/** Runs the full detect-alert-log-digest cycle for one company for one date. */
const processCompanyDate = async (companyId, dateStr) => {
  const anomalies = await detectAnomaliesForCompanyDate(companyId, dateStr);
  if (!anomalies.length) return { flagged: 0 };

  // Computed once per company/run, not per anomaly — same gate value for
  // every biometric-sourced item detected in this pass.
  const biometricSuppressed = await isFeatureEmailSuppressed(companyId, 'biometric_adms');

  const dateLabel = moment.tz(dateStr, TIMEZONE).format('DD MMM YYYY');
  const sent = [];
  for (const anomaly of anomalies) {
    if (await alreadyAlerted(anomaly.employee.id, dateStr)) continue;
    await sendAnomalyAlert(companyId, dateStr, dateLabel, anomaly, biometricSuppressed);
    sent.push(anomaly);
  }
  await sendHrDigest(companyId, dateLabel, sent, biometricSuppressed);
  return { flagged: sent.length };
};

module.exports = {
  detectAnomaliesForCompanyDate,
  processCompanyDate,
  resolveExpectedHours,
  resolveShift,
  SHORT_HOURS_THRESHOLD,
};
