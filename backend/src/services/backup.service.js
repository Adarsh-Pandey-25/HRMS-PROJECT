const moment = require('moment-timezone');
const { supabaseAdmin } = require('../config/supabase');
const logger = require('../utils/logger');
const { STORAGE_BUCKETS, TIMEZONE } = require('../utils/constants');

/**
 * Item 6: real company-data snapshot, not a stub. Covers the core HR
 * datasets — same modules the frontend's manual "Export all data" already
 * covers (employees, leaves, reimbursements, assets, tickets, recruitment)
 * plus payroll and attendance, which that export omits but which matter
 * most for an actual backup/recovery scenario. Does NOT include binary
 * files already sitting in their own Storage buckets (documents, payslip
 * PDFs, profile pictures) — those are backed up by Supabase's own
 * infrastructure already; this is the relational/business data.
 */
const snapshotCompanyData = async (companyId) => {
  const tenantService = require('./tenant.service');
  const employeeIds = await tenantService.getCompanyEmployeeIds(companyId);

  const [employees, leaves, reimbursements, assets, tickets, jobs, candidates, payroll, attendance, holidays] = await Promise.all([
    supabaseAdmin.from('employees').select('id, employee_code, first_name, last_name, email, department, designation, role, is_active, date_of_joining, company_id').eq('company_id', companyId),
    supabaseAdmin.from('leaves').select('*').in('employee_id', employeeIds),
    supabaseAdmin.from('reimbursements').select('*').in('employee_id', employeeIds),
    supabaseAdmin.from('assets').select('*').eq('company_id', companyId),
    supabaseAdmin.from('helpdesk_tickets').select('*').eq('company_id', companyId),
    supabaseAdmin.from('job_openings').select('*').eq('company_id', companyId),
    supabaseAdmin.from('candidates').select('*').eq('company_id', companyId),
    supabaseAdmin.from('payroll').select('id, employee_id, month, year, gross_salary, net_salary, payslip_status, published_at').in('employee_id', employeeIds),
    // Last 90 days only — full attendance history would make this snapshot
    // unbounded in size; the DB itself remains the system of record.
    supabaseAdmin.from('attendance').select('employee_id, check_in_time, check_out_time, status, total_hours').in('employee_id', employeeIds).gte('check_in_time', moment().subtract(90, 'days').toISOString()),
    supabaseAdmin.from('holidays').select('*').eq('company_id', companyId),
  ]);

  return {
    generatedAt: new Date().toISOString(),
    companyId,
    employees: employees.data || [],
    leaves: leaves.data || [],
    reimbursements: reimbursements.data || [],
    assets: assets.data || [],
    helpdeskTickets: tickets.data || [],
    jobOpenings: jobs.data || [],
    candidates: candidates.data || [],
    payroll: payroll.data || [],
    attendanceLast90Days: attendance.data || [],
    holidays: holidays.data || [],
  };
};

/** On-demand or scheduled — both funnel through here so backup_logs reflects every real run either way. */
const runBackup = async (companyId, triggeredBy, userId = null) => {
  const startedAt = new Date().toISOString();
  try {
    const snapshot = await snapshotCompanyData(companyId);
    const fileName = `${companyId}/${moment().tz(TIMEZONE).format('YYYY-MM-DD_HH-mm-ss')}.json`;
    const buffer = Buffer.from(JSON.stringify(snapshot, null, 2));

    const { error: uploadError } = await supabaseAdmin.storage
      .from(STORAGE_BUCKETS.backups)
      .upload(fileName, buffer, { contentType: 'application/json', upsert: false });
    if (uploadError) throw new Error(uploadError.message);

    const { data: log, error: logError } = await supabaseAdmin.from('backup_logs').insert({
      company_id: companyId,
      status: 'success',
      format: 'json',
      storage_path: fileName,
      triggered_by: triggeredBy,
      triggered_by_user_id: userId,
      started_at: startedAt,
      completed_at: new Date().toISOString(),
    }).select().single();
    if (logError) throw new Error(logError.message);

    return log;
  } catch (err) {
    logger.error('[Backup] Run failed', { companyId, triggeredBy, error: err.message });
    const { data: log } = await supabaseAdmin.from('backup_logs').insert({
      company_id: companyId,
      status: 'failed',
      triggered_by: triggeredBy,
      triggered_by_user_id: userId,
      started_at: startedAt,
      completed_at: new Date().toISOString(),
      error: err.message,
    }).select().single();
    return log;
  }
};

const getLastBackup = async (companyId) => {
  const { data } = await supabaseAdmin
    .from('backup_logs')
    .select('*')
    .eq('company_id', companyId)
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data || null;
};

module.exports = { runBackup, getLastBackup, snapshotCompanyData };
