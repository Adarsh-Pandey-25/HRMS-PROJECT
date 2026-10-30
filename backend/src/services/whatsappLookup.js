const crypto = require('crypto');
const { supabaseAdmin } = require('../config/supabase');

/**
 * Small read-only lookups that turn ids into the short, non-sensitive words a
 * WhatsApp message needs — a leave type's name, who approved, a ticket's
 * subject. Selects only the columns used; nothing here reads salaries or
 * bank details. requestReason is the one reader of a reason, and only for
 * the approvers' approval_request message.
 */

const CACHE_MS = 5 * 60 * 1000;
const cache = new Map();
const cached = async (key, load) => {
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value;
  const value = await load();
  cache.set(key, { value, expires: Date.now() + CACHE_MS });
  return value;
};

const LEAVE_TYPE_NAMES = {
  CL: 'Casual Leave',
  SL: 'Sick Leave',
  EL: 'Earned Leave',
  PL: 'Privilege Leave',
  WFH: 'Work From Home',
  COMP_OFF: 'Comp Off',
  MATERNITY: 'Maternity Leave',
  PATERNITY: 'Paternity Leave',
  UNPAID: 'Unpaid Leave',
};

const DOCUMENT_TYPE_NAMES = {
  offer_letter: 'Offer letter',
  joining_letter: 'Joining letter',
  aadhar: 'Aadhaar card',
  pan: 'PAN card',
  educational_certificate: 'Educational certificate',
  experience_letter: 'Experience letter',
  payslip: 'Payslip',
  form_16: 'Form 16',
  resignation_letter: 'Resignation letter',
  relieving_letter: 'Relieving letter',
};

const humanize = (value) => {
  const text = String(value || '').replace(/[_-]+/g, ' ').trim().toLowerCase();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : '';
};

/** The company's own display name (Settings → Company profile), else its record name. */
const companyName = async (company) => {
  if (!company?.id) return company?.name || 'your company';
  return cached(`company-name:${company.id}`, async () => {
    try {
      const { getSetting } = require('./settings.service');
      const profile = await getSetting('company_profile', null, company.id);
      if (profile && typeof profile === 'object' && String(profile.name || '').trim()) return String(profile.name).trim();
    } catch { /* fall back to the record name */ }
    return company.name || 'your company';
  });
};

/** "Casual Leave" for "CL" — the company's own leave policy first. */
const leaveTypeName = async (companyId, code) => {
  const raw = String(code || '').trim();
  if (!raw) return 'leave';
  return cached(`leave-type:${companyId}:${raw}`, async () => {
    try {
      const { getSetting } = require('./settings.service');
      const policy = await getSetting('leave_policy', null, companyId);
      const list = Array.isArray(policy) ? policy : (Array.isArray(policy?.types) ? policy.types : []);
      const match = list.find((t) => String(t?.code || '').toUpperCase() === raw.toUpperCase());
      if (match?.name) return String(match.name);
    } catch { /* fall through */ }
    const { data } = await supabaseAdmin.from('leave_types').select('name').eq('code', raw).maybeSingle();
    if (data?.name) return String(data.name);
    return LEAVE_TYPE_NAMES[raw.toUpperCase()] || humanize(raw);
  });
};

const employeeName = async (id) => {
  if (!id) return null;
  const { data } = await supabaseAdmin.from('employees').select('first_name, last_name').eq('id', id).maybeSingle();
  if (!data) return null;
  return [data.first_name, data.last_name].filter(Boolean).join(' ') || null;
};

/** Emails addressed as {to, name} (billing, beacons): the employee with that address in the company. */
const employeeIdByEmail = async (companyId, email) => {
  if (!companyId || !email) return null;
  const { data } = await supabaseAdmin
    .from('employees')
    .select('id')
    .eq('company_id', companyId)
    .ilike('email', String(email).trim())
    .limit(1)
    .maybeSingle();
  return data?.id || null;
};

const leave = async (id) => {
  if (!id) return null;
  const { data } = await supabaseAdmin
    .from('leaves')
    .select('id, employee_id, company_id, leave_type, from_date, to_date, status, approved_by, manager_approved_by')
    .eq('id', id)
    .maybeSingle();
  return data || null;
};

/** Every day of one work-from-home request (a request is one row per day, grouped by batch_id). */
const wfhDays = async ({ batchId = null, requestId = null }) => {
  let batch = batchId;
  let single = null;
  if (!batch && requestId) {
    const { data } = await supabaseAdmin
      .from('wfh_day_requests')
      .select('id, employee_id, work_date, batch_id')
      .eq('id', requestId)
      .maybeSingle();
    single = data || null;
    batch = data?.batch_id || null;
  }
  if (!batch) return single ? [single] : [];
  const { data } = await supabaseAdmin
    .from('wfh_day_requests')
    .select('id, employee_id, work_date, batch_id')
    .eq('batch_id', batch)
    .order('work_date', { ascending: true });
  return data || [];
};

const ticket = async (id) => {
  if (!id) return null;
  const { data } = await supabaseAdmin
    .from('helpdesk_tickets')
    .select('id, subject, raised_by, status, category')
    .eq('id', id)
    .maybeSingle();
  return data || null;
};

/** Attendance corrections are helpdesk tickets whose subject starts "Attendance correction". */
const isRegularizationTicket = (t) => /^attendance correction/i.test(String(t?.subject || ''));

/** "27 Oct 2026" out of "Attendance correction — 27 Oct 2026". */
const regularizationDate = (t) => {
  const parts = String(t?.subject || '').split(/\s[—–-]\s/);
  return parts.length > 1 ? parts.slice(1).join(' – ').trim() : null;
};

/**
 * What the requester wrote as their reason, for the approver's message
 * only. `kind` and `recordId` as in whatsapp_actions; null when there is none.
 */
const requestReason = async (kind, recordId) => {
  if (!recordId) return null;
  if (kind === 'leave') {
    const { data } = await supabaseAdmin.from('leaves').select('reason').eq('id', recordId).maybeSingle();
    return data?.reason || null;
  }
  if (kind === 'wfh') {
    // Every day of one request carries the same reason.
    const { data } = await supabaseAdmin.from('wfh_day_requests').select('reason').eq('batch_id', recordId).limit(1).maybeSingle();
    return data?.reason || null;
  }
  if (kind === 'expense') {
    const { data } = await supabaseAdmin.from('reimbursements').select('description').eq('id', recordId).maybeSingle();
    return data?.description || null;
  }
  if (kind === 'regularization') {
    // The website writes "Reason: …" as the last line (HRMS/src/lib/regularization.js).
    const { data } = await supabaseAdmin.from('helpdesk_tickets').select('description').eq('id', recordId).maybeSingle();
    return String(data?.description || '').match(/Reason:\s*([\s\S]+)/i)?.[1]?.trim() || null;
  }
  return null;
};

const documentInfo = async (id) => {
  if (!id) return null;
  const { data } = await supabaseAdmin
    .from('documents')
    .select('id, employee_id, document_type')
    .eq('id', id)
    .maybeSingle();
  if (!data) return null;
  return { ...data, label: DOCUMENT_TYPE_NAMES[data.document_type] || humanize(data.document_type) || 'document' };
};

const reimbursement = async (id) => {
  if (!id) return null;
  const { data } = await supabaseAdmin
    .from('reimbursements')
    .select('id, employee_id, reimbursement_type, status')
    .eq('id', id)
    .maybeSingle();
  if (!data) return null;
  return { ...data, label: humanize(data.reimbursement_type) || 'Expense' };
};

/** "2026" or "2026–2027" for a set of holidays. */
const holidayYears = async (ids) => {
  if (!ids?.length) return String(new Date().getFullYear());
  const { data } = await supabaseAdmin.from('holidays').select('date').in('id', ids);
  return yearsOf((data || []).map((h) => h.date));
};

const yearsOf = (dates) => {
  const years = [...new Set((dates || []).map((d) => String(d || '').slice(0, 4)).filter((y) => /^\d{4}$/.test(y)))].sort();
  if (!years.length) return String(new Date().getFullYear());
  return years.length === 1 ? years[0] : `${years[0]}–${years[years.length - 1]}`;
};

/** A stable short key for a set of ids (holiday imports). */
const idsKey = (ids) => crypto.createHash('sha256').update([...(ids || [])].map(String).sort().join(',')).digest('hex').slice(0, 32);

module.exports = {
  LEAVE_TYPE_NAMES,
  DOCUMENT_TYPE_NAMES,
  humanize,
  companyName,
  leaveTypeName,
  employeeName,
  employeeIdByEmail,
  leave,
  wfhDays,
  ticket,
  isRegularizationTicket,
  regularizationDate,
  requestReason,
  documentInfo,
  reimbursement,
  holidayYears,
  yearsOf,
  idsKey,
  _forgetCache: () => cache.clear(),
};
