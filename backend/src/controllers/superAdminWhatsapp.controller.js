const { getConfig } = require('../config/whatsapp');
const { successResponse } = require('../utils/helpers');
const { BadRequestError } = require('../utils/errors');
const admin = require('../services/whatsappAdmin.service');
const settings = require('../services/whatsappSettings.service');
const linkService = require('../services/whatsappLink.service');

/** Super Admin → WhatsApp. Full admins only (see the routes file). */

const overview = async (req, res, next) => {
  try {
    successResponse(res, 'WhatsApp overview', await admin.overview());
  } catch (err) { next(err); }
};

const messages = async (req, res, next) => {
  try {
    const result = await admin.listMessages({
      page: req.query.page,
      limit: req.query.limit,
      companyId: req.query.company_id,
      status: req.query.status,
      template: req.query.template,
      from: req.query.from,
      to: req.query.to,
    });
    successResponse(res, 'WhatsApp messages', result.items, { page: result.page, limit: result.limit, total: result.total });
  } catch (err) { next(err); }
};

const setPaused = async (req, res, next) => {
  try {
    const { paused, reason } = req.body || {};
    if (typeof paused !== 'boolean') throw new BadRequestError('paused must be true or false');
    const state = await settings.setPaused(getConfig().environment, paused, {
      reason: paused ? (String(reason || '').trim() || 'Paused by a super admin') : null,
      by: req.superAdmin.email,
    });
    successResponse(res, paused ? 'WhatsApp sending paused' : 'WhatsApp sending resumed', state);
  } catch (err) { next(err); }
};

const templates = async (req, res, next) => {
  try {
    successResponse(res, 'WhatsApp templates', await admin.templatesStatus());
  } catch (err) { next(err); }
};

const syncTemplates = async (req, res, next) => {
  try {
    successResponse(res, 'Templates submitted to Meta', await admin.syncTemplates());
  } catch (err) { next(err); }
};

const testMessage = async (req, res, next) => {
  try {
    successResponse(res, 'Test message sent', await admin.sendTestMessage({ to: req.body?.to, superAdminId: req.superAdmin.id }));
  } catch (err) { next(err); }
};

// The super admin's own WhatsApp, for platform alerts.
const getMine = async (req, res, next) => {
  try {
    const link = await linkService.getLink('super_admin', req.superAdmin.id);
    successResponse(res, 'WhatsApp alerts', linkService.describeLink(link, 'super_admin'));
  } catch (err) { next(err); }
};

const startLink = async (req, res, next) => {
  try {
    if (!getConfig().enabled) throw new BadRequestError('WhatsApp is switched off on this server (WHATSAPP_ENABLED).');
    successResponse(res, 'Open WhatsApp and send the message to connect', await linkService.startLink({
      subjectType: 'super_admin',
      subjectId: req.superAdmin.id,
    }));
  } catch (err) { next(err); }
};

const updateMyGroups = async (req, res, next) => {
  try {
    const { groups } = req.body || {};
    if (!groups || typeof groups !== 'object' || Array.isArray(groups)) throw new BadRequestError('groups must be an object of true/false switches');
    successResponse(res, 'Saved', await linkService.updateGroups('super_admin', req.superAdmin.id, 'super_admin', groups));
  } catch (err) { next(err); }
};

const disconnect = async (req, res, next) => {
  try {
    await linkService.disconnect('super_admin', req.superAdmin.id);
    successResponse(res, 'WhatsApp disconnected', linkService.describeLink(null, 'super_admin'));
  } catch (err) { next(err); }
};

module.exports = {
  overview, messages, setPaused, templates, syncTemplates, testMessage, getMine, startLink, updateMyGroups, disconnect,
};
