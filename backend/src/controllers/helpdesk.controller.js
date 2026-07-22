const helpdeskService = require('../services/helpdesk.service');
const { successResponse } = require('../utils/helpers');
const { getCompanyId } = require('../utils/tenant');

const companyIdOf = (req) => req.user.company_id || getCompanyId(req.user);

const companyIds = async (req) => {
  const tenantService = require('../services/tenant.service');
  return tenantService.getCompanyEmployeeIds(companyIdOf(req));
};

const tickets = async (req, res, next) => {
  try {
    const ids = await companyIds(req);
    const data = await helpdeskService.listTickets(req.query, ids, companyIdOf(req));
    successResponse(res, 'Tickets fetched', data);
  } catch (err) { next(err); }
};

const myTickets = async (req, res, next) => {
  try {
    const data = await helpdeskService.listTickets(
      { raised_by: req.user.id },
      null,
      companyIdOf(req)
    );
    successResponse(res, 'My tickets fetched', data);
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
    successResponse(res, 'Ticket updated', data);
  } catch (err) { next(err); }
};

const comment = async (req, res, next) => {
  try {
    const ids = await companyIds(req);
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
