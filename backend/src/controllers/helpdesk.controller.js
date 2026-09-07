const helpdeskService = require('../services/helpdesk.service');
const { successResponse } = require('../utils/helpers');
const { getCompanyId } = require('../utils/tenant');
const logger = require('../utils/logger');

const companyIdOf = (req) => req.user.company_id || getCompanyId(req.user);

/**
 * Item 2: mirrors HRMS/src/lib/regularization.js's frontend convention
 * exactly (category 'hr' + subject prefix) — no dedicated regularization
 * table/status exists, a regularization request IS a specially-tagged
 * helpdesk ticket, so this is the same real signal the frontend already
 * uses to tell them apart from ordinary tickets.
 */
const REGULARIZATION_SUBJECT_PREFIX = 'attendance correction';
const isRegularizationTicket = (ticket) =>
  ticket?.category === 'hr' && String(ticket?.subject || '').toLowerCase().startsWith(REGULARIZATION_SUBJECT_PREFIX);

const parseRegularizationDetails = (ticket) => {
  const subjectMatch = String(ticket.subject || '').match(/Attendance correction —\s*(.+)/i);
  const desc = String(ticket.description || '');
  const checkInMatch = desc.match(/Requested check-in:\s*(.+)/i);
  const checkOutMatch = desc.match(/Requested check-out:\s*(.+)/i);
  let checkOut = checkOutMatch?.[1]?.trim() || '';
  if (checkOut === '—') checkOut = '';
  return { dateLabel: subjectMatch?.[1]?.trim() || '', checkIn: checkInMatch?.[1]?.trim() || '', checkOut };
};

/**
 * Item 2: the reg_approved/reg_rejected templates existed but were never
 * called anywhere (confirmed by grep — email.service.js's own comment on
 * regularizationApprovedEmail said as much: "Template ready; wiring needs
 * that workflow decision first"). This is that wiring — fires only for
 * tickets that are actually regularization requests, on the two status
 * transitions that mean approve ('resolved') and reject ('closed', the
 * closest fit in the existing 4-status ticket model since there's no
 * dedicated 'rejected' status and adding one would mean a schema change
 * for every OTHER ticket type too). Never blocks the status update itself
 * — email failure is caught and logged, matching this codebase's existing
 * best-effort email convention everywhere else.
 */
const maybeSendRegularizationEmail = async (ticket, status, approverName, rejectionReason) => {
  if (!isRegularizationTicket(ticket) || !ticket.raised_by) return;
  if (status !== 'resolved' && status !== 'closed') return;
  try {
    const { supabaseAdmin } = require('../config/supabase');
    const { data: employee } = await supabaseAdmin
      .from('employees')
      .select('id, first_name, last_name, email')
      .eq('id', ticket.raised_by)
      .maybeSingle();
    if (!employee?.email) return;

    const { dateLabel, checkIn, checkOut } = parseRegularizationDetails(ticket);
    const emailService = require('../services/email.service');
    if (status === 'resolved') {
      await emailService.regularizationApprovedEmail(employee, { dateLabel, checkIn, checkOut, approverName });
    } else {
      await emailService.regularizationRejectedEmail(employee, { dateLabel, approverName, reason: rejectionReason });
    }
  } catch (err) {
    logger.warn('[Helpdesk] Regularization email failed', { ticketId: ticket.id, status, error: err.message });
  }
};

const companyIds = async (req) => {
  const tenantService = require('../services/tenant.service');
  const home = companyIdOf(req);
  if (['admin', 'hr'].includes(req.user.role)) {
    return tenantService.getOrgEmployeeIds(home);
  }
  return tenantService.getCompanyEmployeeIds(home);
};

const tickets = async (req, res, next) => {
  try {
    const ids = await companyIds(req);
    const result = await helpdeskService.listTickets(req.query, ids, companyIdOf(req), req.query);
    successResponse(res, 'Tickets fetched', result.data, result.meta);
  } catch (err) { next(err); }
};

const myTickets = async (req, res, next) => {
  try {
    const result = await helpdeskService.listTickets(
      { raised_by: req.user.id },
      null,
      companyIdOf(req),
      req.query
    );
    successResponse(res, 'My tickets fetched', result.data, result.meta);
  } catch (err) { next(err); }
};

const create = async (req, res, next) => {
  try {
    const data = await helpdeskService.createTicket(req.user.id, req.body, companyIdOf(req));
    successResponse(res, 'Ticket created', data, null, 201);
  } catch (err) { next(err); }
};

const updateStatus = async (req, res, next) => {
  try {
    const ids = await companyIds(req);
    const data = await helpdeskService.updateTicketStatus(
      req.params.id,
      req.body.status,
      ids,
      companyIdOf(req)
    );
    if (!data) return res.status(404).json({ success: false, error: { message: 'Ticket not found' } });
    if (req.body.status === 'resolved') {
      require('../services/webhook.service').dispatchWebhookEvent(companyIdOf(req), 'helpdesk.ticket_resolved', {
        ticketId: req.params.id, resolvedBy: req.user.id,
      });
    }
    const approverName = `${req.user.first_name || ''} ${req.user.last_name || ''}`.trim() || req.user.email;
    const rejectionReason = req.body.rejection_reason ? String(req.body.rejection_reason).trim() : null;
    if (rejectionReason && req.body.status === 'closed') {
      helpdeskService.addComment(req.params.id, {
        by: req.user.id, text: `Rejected: ${rejectionReason}`, at: new Date().toISOString(),
      }, ids, companyIdOf(req)).catch((e) => logger.warn('[Helpdesk] Failed to log rejection comment', { error: e.message }));
    }
    maybeSendRegularizationEmail(data, req.body.status, approverName, rejectionReason)
      .catch((e) => logger.warn('[Helpdesk] Regularization email dispatch failed', { error: e.message }));
    successResponse(res, 'Ticket updated', data);
  } catch (err) { next(err); }
};

const comment = async (req, res, next) => {
  try {
    const isPrivileged = ['admin', 'hr'].includes(req.user.role);
    // HR/Admin: any company ticket. Everyone else: only tickets they raised.
    const ids = isPrivileged ? await companyIds(req) : [req.user.id];
    const data = await helpdeskService.addComment(req.params.id, {
      by: req.user.id,
      text: req.body.text,
      at: new Date().toISOString(),
    }, ids, companyIdOf(req));
    if (!data) return res.status(404).json({ success: false, error: { message: 'Ticket not found' } });
    successResponse(res, 'Comment added', data);
  } catch (err) { next(err); }
};

const kbCategories = async (req, res, next) => {
  try {
    const data = await helpdeskService.listKbCategories(companyIdOf(req));
    successResponse(res, 'KB categories fetched', data);
  } catch (err) { next(err); }
};

const kbArticles = async (req, res, next) => {
  try {
    const data = await helpdeskService.listKbArticles(req.query.category, companyIdOf(req));
    successResponse(res, 'KB articles fetched', data);
  } catch (err) { next(err); }
};

module.exports = { tickets, myTickets, create, updateStatus, comment, kbCategories, kbArticles };
