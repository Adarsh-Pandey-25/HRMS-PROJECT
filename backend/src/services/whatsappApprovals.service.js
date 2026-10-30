const crypto = require('crypto');
const { supabaseAdmin } = require('../config/supabase');
const { getCompanyId } = require('../utils/tenant');
const { BadRequestError, ForbiddenError, NotFoundError } = require('../utils/errors');
const logger = require('../utils/logger');
const api = require('./whatsappApi');
const settings = require('./whatsappSettings.service');
const linkService = require('./whatsappLink.service');
const { getTemplate, paramCount, LANGUAGE } = require('./whatsappTemplates');

/**
 * Approve / Reject buttons on WhatsApp approval requests: leave, work from
 * home, expense claims and attendance corrections (owner's decision,
 * 30 Oct 2026).
 *
 * A tap runs the website's own Approve / Reject handler as the approver, so
 * every rule is the website's: their role, their team, the company's
 * approval flow, "not your own request", the request still pending. A tap
 * only gets that far when:
 *   - it comes from the approver's own connected WhatsApp number;
 *   - its code is the one sent with that message (only a SHA-256 of it is
 *     stored), unused and less than 7 days old — each set of buttons works once;
 *   - the approver could sign in to the website right now (active, company
 *     active and not suspended) and WhatsApp is still on for the company.
 * Reject is one tap, with REJECT_NOTE as the reason the employee sees.
 */

const ACTION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const APPROVED_CHECK_MS = 10 * 60 * 1000;
const PAYLOAD = /^wa_(approve|reject):([A-Za-z0-9_-]{22})$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KINDS = new Set(['leave', 'wfh', 'expense', 'regularization']);
const REJECT_NOTE = 'Rejected on WhatsApp. Please contact your approver for details.';
const HIDDEN = '(hidden)';
// The columns the website's sign-in loads (auth.middleware.js), so each
// handler sees the approver exactly as it does there.
const APPROVER_COLUMNS = 'id, employee_code, first_name, last_name, email, role, department, designation, manager_id, is_active, company_id, address, date_of_joining, phone, profile_picture';
const MANAGER_OR_ABOVE = ['manager', 'hr', 'admin'];
const HR_OR_ADMIN = ['hr', 'admin'];
const PENDING_TICKET = ['open', 'in_progress'];

const REPLIES = {
  unknown: 'These buttons no longer work. Please open SpaxSync to review the request.',
  used: 'This request was already answered from WhatsApp. Open SpaxSync to see where it stands.',
  expired: 'These buttons have expired. Please open SpaxSync to review the request.',
  notYours: 'These buttons only work from the WhatsApp number connected to the approver\'s SpaxSync account.',
  off: 'Approving on WhatsApp is not available for your account right now. Please use SpaxSync.',
  failed: 'Something went wrong and nothing was changed. Please try again, or use SpaxSync.',
  refused: (message) => `Nothing was changed: ${message}`,
  done: (decision, subject) => `${decision === 'approve' ? '✅ Approved' : '❌ Rejected'}${subject ? ` — ${subject}` : ''}. They will be told as usual.`,
};

const hashCode = (code) => crypto.createHash('sha256').update(String(code)).digest('hex');

/** { decision, code } from a button's payload, or null when it is not one of ours. */
const parsePayload = (payload) => {
  const match = String(payload || '').match(PAYLOAD);
  return match ? { decision: match[1], code: match[2] } : null;
};

/** The values to keep in the message log once sent: a template's private ones hidden. */
const redactParams = (template, params) => {
  const hidden = template?.privateParams || [];
  return Array.isArray(params) ? params.map((value, i) => (hidden.includes(i + 1) ? HIDDEN : value)) : params;
};

/**
 * One set of buttons per approval message just queued (outbox). Without its
 * row a message simply goes without buttons, so a failure here only logs.
 */
const createActions = async (rows, action) => {
  if (!action || !KINDS.has(action.kind) || !UUID.test(String(action.recordId || ''))) return;
  const expiresAt = new Date(Date.now() + ACTION_TTL_MS).toISOString();
  const actions = (rows || [])
    .filter((row) => row.subject_type === 'employee' && row.company_id)
    .map((row) => ({
      message_id: row.id,
      company_id: row.company_id,
      approver_id: row.subject_id,
      kind: action.kind,
      record_id: action.recordId,
      expires_at: expiresAt,
    }));
  if (!actions.length) return;
  const { error } = await supabaseAdmin.from('whatsapp_actions').insert(actions);
  if (error) logger.warn('[WhatsApp] could not create approval buttons', { error: error.message });
};

let approvedAtMeta = { at: 0, names: new Set() };

/** Has Meta approved this template? Asked at most every 10 minutes. */
const isApprovedAtMeta = async (name) => {
  if (Date.now() - approvedAtMeta.at > APPROVED_CHECK_MS) {
    try {
      const templates = await api.listTemplates();
      approvedAtMeta = {
        at: Date.now(),
        names: new Set(templates.filter((t) => t.status === 'APPROVED' && t.language === LANGUAGE).map((t) => t.name)),
      };
    } catch (err) {
      // Ask again in a minute; until then, the plain message goes.
      approvedAtMeta = { at: Date.now() - APPROVED_CHECK_MS + 60 * 1000, names: approvedAtMeta.names };
      logger.warn('[WhatsApp] could not check template approval', { error: err.title || err.message });
    }
  }
  return approvedAtMeta.names.has(name);
};

/**
 * What the worker sends for a row of a template with buttons: that template
 * with a fresh code in its buttons, or — until Meta approves it, or when the
 * row's buttons are missing, used or expired — the plain fallback template
 * with the first values. A resend gets a new code; the old one stops working.
 */
const prepareSend = async (row, template) => {
  const params = Array.isArray(row.params) ? row.params : [];
  const fallback = getTemplate(template.fallback);
  const plain = { template: fallback.name, params: params.slice(0, paramCount(fallback)), buttonPayloads: null };
  if (!(await isApprovedAtMeta(template.name))) return plain;

  const { data: action, error } = await supabaseAdmin
    .from('whatsapp_actions')
    .select('id, used_at, expires_at')
    .eq('message_id', row.id)
    .maybeSingle();
  if (error || !action || action.used_at || new Date(action.expires_at) <= new Date()) return plain;

  const code = crypto.randomBytes(16).toString('base64url');
  const { data: armed } = await supabaseAdmin
    .from('whatsapp_actions')
    .update({ token_hash: hashCode(code) })
    .eq('id', action.id)
    .is('used_at', null)
    .select('id')
    .maybeSingle();
  if (!armed) return plain;
  return { template: template.name, params, buttonPayloads: [`wa_approve:${code}`, `wa_reject:${code}`] };
};

// ── Running the website's own handlers ────────────────────────────────────

// Required when used: the controllers load most of the app, which loads the
// WhatsApp services.
const controllers = {
  leave: () => require('../controllers/leave.controller'),
  wfh: () => require('../controllers/wfhRequest.controller'),
  expense: () => require('../controllers/reimbursement.controller'),
  helpdesk: () => require('../controllers/helpdesk.controller'),
  attendance: () => require('../controllers/attendance.controller'),
};

/**
 * Runs one of the website's request handlers as the approver, as their own
 * click would: same checks, same records, same audit log and notifications.
 * Resolves with the handler's reply; rejects with the error it raised.
 */
const runHandler = (handler, user, params = {}, body = {}) => new Promise((resolve, reject) => {
  const headers = { 'user-agent': 'SpaxSync WhatsApp' };
  const req = {
    user, params, body, query: {}, headers, ip: null, authType: 'whatsapp',
    get: (name) => headers[String(name).toLowerCase()],
  };
  let statusCode = 200;
  const res = {
    headersSent: false,
    status(code) { statusCode = code; return res; },
    json(reply) {
      res.headersSent = true;
      if (statusCode >= 400) {
        reject(Object.assign(new Error(reply?.error?.message || reply?.message || 'Request failed'), { statusCode }));
      } else {
        resolve(reply);
      }
      return res;
    },
    send(reply) { return res.json(reply); },
    set() { return res; },
    setHeader() { return res; },
  };
  Promise.resolve(handler(req, res, (err) => reject(err || new Error('Request was not handled')))).catch(reject);
});

/** Attendance corrections are helpdesk tickets (helpdesk.controller.js, HRMS/src/lib/regularization.js). */
const isCorrectionTicket = (ticket) => ticket?.category === 'hr'
  && String(ticket?.subject || '').toLowerCase().startsWith('attendance correction');

/**
 * The requested times, read the way the website's "Apply attendance
 * correction" form reads them (HRMS/src/lib/regularization.js: toIstIso).
 * null when anything is not in the expected shape — then only SpaxSync can apply it.
 */
const correctionTimes = (ticket) => {
  const date = String(ticket.subject || '').match(/Attendance correction —\s*(.+)/i)?.[1]?.trim() || '';
  const description = String(ticket.description || '');
  const checkIn = description.match(/Requested check-in:\s*(.+)/i)?.[1]?.trim() || '';
  let checkOut = description.match(/Requested check-out:\s*(.+)/i)?.[1]?.trim() || '';
  if (checkOut === '—') checkOut = '';
  const reason = description.match(/Reason:\s*([\s\S]+)/i)?.[1]?.trim() || '';
  const time = /^\d{2}:\d{2}/;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !time.test(checkIn) || (checkOut && !time.test(checkOut))) return null;
  const at = (hhmm) => `${date}T${hhmm.slice(0, 5)}:00+05:30`;
  return { checkIn: at(checkIn), checkOut: checkOut ? at(checkOut) : null, reason };
};

/** Per kind: who may decide (the website route's role check) and how. */
const DECIDE = {
  leave: {
    roles: MANAGER_OR_ABOVE,
    run: (decision, approver, leaveId) => (decision === 'approve'
      ? runHandler(controllers.leave().approve, approver, { id: leaveId })
      : runHandler(controllers.leave().reject, approver, { id: leaveId }, { rejection_reason: REJECT_NOTE })),
  },
  wfh: {
    roles: MANAGER_OR_ABOVE,
    run: async (decision, approver, batchId) => {
      // The website reviews a request through any one of its days.
      const { data: day } = await supabaseAdmin
        .from('wfh_day_requests')
        .select('id')
        .eq('batch_id', batchId)
        .order('work_date', { ascending: true })
        .limit(1)
        .maybeSingle();
      if (!day) throw new NotFoundError('WFH request not found');
      return runHandler(controllers.wfh().review, approver, { id: day.id },
        decision === 'approve' ? { status: 'approved' } : { status: 'rejected', review_note: REJECT_NOTE });
    },
  },
  expense: {
    roles: MANAGER_OR_ABOVE,
    run: (decision, approver, claimId) => (decision === 'approve'
      ? runHandler(controllers.expense().approve, approver, { id: claimId })
      : runHandler(controllers.expense().reject, approver, { id: claimId }, { rejection_reason: REJECT_NOTE })),
  },
  regularization: {
    roles: HR_OR_ADMIN,
    feature: 'helpdesk',
    run: async (decision, approver, ticketId) => {
      const { data: ticket } = await supabaseAdmin
        .from('helpdesk_tickets')
        .select('id, subject, description, raised_by, status, category')
        .eq('id', ticketId)
        .maybeSingle();
      if (!ticket || !isCorrectionTicket(ticket)) throw new NotFoundError('Attendance correction not found');
      // The ticket handler accepts any status change, so "still pending" is checked here.
      if (!PENDING_TICKET.includes(ticket.status)) throw new BadRequestError('This attendance correction was already decided');
      const helpdesk = controllers.helpdesk();
      if (decision === 'reject') {
        return runHandler(helpdesk.updateStatus, approver, { id: ticketId }, { status: 'closed', rejection_reason: REJECT_NOTE });
      }
      // The website's Approve: save the requested times, then mark the ticket resolved.
      const fix = correctionTimes(ticket);
      if (!fix) throw new BadRequestError('This correction needs a closer look. Please open SpaxSync to apply it');
      await runHandler(controllers.attendance().manualEntry, approver, {}, {
        employee_id: ticket.raised_by,
        check_in_time: fix.checkIn,
        check_out_time: fix.checkOut,
        remarks: fix.reason ? `Regularization: ${fix.reason}` : 'Regularization correction',
      });
      return runHandler(helpdesk.updateStatus, approver, { id: ticketId }, { status: 'resolved' });
    },
  },
};

// ── Handling a tap ────────────────────────────────────────────────────────

/** Same check as sign-in (auth.middleware.js): a suspended company's people are locked out. */
const isCompanySuspended = async (companyId) => {
  const { data } = await supabaseAdmin
    .from('company_billing_subscriptions')
    .select('id')
    .eq('company_id', companyId)
    .eq('status', 'suspended')
    .limit(1)
    .maybeSingle();
  return Boolean(data);
};

/** Did the tap come from the WhatsApp the approver connected? */
const fromApprover = async (action, identity) => {
  const link = await linkService.getLink('employee', action.approver_id);
  if (!link || link.status !== 'active') return false;
  const { phone, bsuid } = linkService.normalizeIdentity(identity || {});
  return Boolean((phone && link.phone === phone) || (bsuid && link.bsuid === bsuid));
};

/** The approver as the website would see them signed in, or null when they could not act there now. */
const activeApprover = async (action) => {
  const { data: employee } = await supabaseAdmin
    .from('employees')
    .select(APPROVER_COLUMNS)
    .eq('id', action.approver_id)
    .eq('is_active', true)
    .maybeSingle();
  if (!employee) return null;
  const approver = { ...employee, company_id: getCompanyId(employee) };
  if (String(approver.company_id) !== String(action.company_id)) return null;
  const [{ data: company }, suspended, addOn, companySettings] = await Promise.all([
    supabaseAdmin.from('companies').select('is_active').eq('id', approver.company_id).maybeSingle(),
    isCompanySuspended(approver.company_id),
    settings.isAddOnEnabled(approver.company_id),
    settings.getCompanySettings(approver.company_id),
  ]);
  if (!company || company.is_active === false || suspended || !addOn || !companySettings.enabled) return null;
  return approver;
};

/** "ujjwal Don: Casual Leave for 17 Nov 2026", from the approval message itself. */
const subjectOf = async (action) => {
  const { data } = await supabaseAdmin.from('whatsapp_messages').select('params').eq('id', action.message_id).maybeSingle();
  const params = Array.isArray(data?.params) ? data.params : [];
  return params[1] && params[3] ? `${params[1]}: ${params[3]}` : null;
};

const finish = (id, outcome, detail = null) => supabaseAdmin
  .from('whatsapp_actions')
  .update({ outcome, outcome_detail: detail ? String(detail).slice(0, 300) : null })
  .eq('id', id);

const isRuleError = (err) => Number(err?.statusCode) >= 400 && Number(err?.statusCode) < 500;

/**
 * A tap on Approve or Reject. Returns the reply for the approver; never throws.
 * @param {{ decision: 'approve'|'reject', code: string, identity: { phone, bsuid } }} tap
 */
const handleTap = async ({ decision, code, identity }) => {
  try {
    const { data: action } = await supabaseAdmin
      .from('whatsapp_actions')
      .select('id, message_id, company_id, approver_id, kind, record_id, expires_at, used_at')
      .eq('token_hash', hashCode(code))
      .maybeSingle();
    if (!action || !DECIDE[action.kind]) return REPLIES.unknown;
    if (action.used_at) return REPLIES.used;
    if (new Date(action.expires_at) <= new Date()) return REPLIES.expired;
    if (!(await fromApprover(action, identity))) return REPLIES.notYours;
    const approver = await activeApprover(action);
    if (!approver) return REPLIES.off;

    // The first tap wins: the other button, and Meta re-delivering this one, find it used.
    const { data: claimed } = await supabaseAdmin
      .from('whatsapp_actions')
      .update({ used_at: new Date().toISOString(), decision })
      .eq('id', action.id)
      .is('used_at', null)
      .select('id')
      .maybeSingle();
    if (!claimed) return REPLIES.used;

    const rule = DECIDE[action.kind];
    try {
      if (!rule.roles.includes(approver.role)) {
        throw new ForbiddenError(rule.roles.includes('manager')
          ? 'only managers, HR and admins can decide this request'
          : 'only HR and admins can decide attendance corrections');
      }
      if (rule.feature && !(await require('./featureOverride.service').hasFeature(approver.company_id, rule.feature))) {
        throw new ForbiddenError('this feature isn\'t included in your company\'s current plan');
      }
      await rule.run(decision, approver, action.record_id);
    } catch (err) {
      if (isRuleError(err)) {
        await finish(action.id, 'refused', err.message);
        return REPLIES.refused(err.message);
      }
      // Not a "no" from the website's rules: let them try again.
      await supabaseAdmin.from('whatsapp_actions').update({ used_at: null, decision: null }).eq('id', action.id);
      logger.error('[WhatsApp] decision from WhatsApp failed', { kind: action.kind, error: err.message });
      return REPLIES.failed;
    }

    await finish(action.id, decision === 'approve' ? 'approved' : 'rejected');
    require('./auditLog.service').logAudit({
      companyId: approver.company_id,
      actorId: approver.id,
      actorRole: approver.role,
      actionType: `whatsapp.${decision}`,
      targetType: action.kind,
      targetId: action.record_id,
      afterState: { via: 'whatsapp' },
    }).catch((err) => logger.warn('[WhatsApp] audit log failed', { error: err.message }));
    return REPLIES.done(decision, await subjectOf(action));
  } catch (err) {
    logger.error('[WhatsApp] could not handle an approval button', { error: err.message });
    return REPLIES.failed;
  }
};

module.exports = {
  REJECT_NOTE,
  REPLIES,
  parsePayload,
  redactParams,
  createActions,
  prepareSend,
  handleTap,
  // for tests
  runHandler,
  correctionTimes,
  hashCode,
  _resetApprovedCache: () => { approvedAtMeta = { at: 0, names: new Set() }; },
};
