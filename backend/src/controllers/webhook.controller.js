const webhookService = require('../services/webhook.service');
const auditLogService = require('../services/auditLog.service');
const { successResponse, paginate, buildMeta } = require('../utils/helpers');
const { getCompanyId } = require('../utils/tenant');

const companyIdOf = (req) => req.user.company_id || getCompanyId(req.user);

const listCatalog = async (req, res, next) => {
  try {
    const catalog = Object.entries(webhookService.WEBHOOK_EVENTS).map(([key, meta]) => ({ key, label: meta.label }));
    successResponse(res, 'Event catalog fetched', catalog);
  } catch (err) { next(err); }
};

const list = async (req, res, next) => {
  try {
    successResponse(res, 'Webhooks fetched', await webhookService.listWebhooks(companyIdOf(req)));
  } catch (err) { next(err); }
};

const create = async (req, res, next) => {
  try {
    const data = await webhookService.createWebhook(companyIdOf(req), {
      url: req.body.url,
      subscribedEvents: req.body.subscribed_events,
    }, req.user.id);
    await auditLogService.logAudit({
      companyId: companyIdOf(req), actorId: req.user.id, actorRole: req.user.role,
      actionType: 'webhook_created', targetType: 'webhook', targetId: data.id,
      afterState: { url: data.url, subscribedEvents: data.subscribedEvents },
    });
    successResponse(res, 'Webhook created — copy the secret now, it will not be shown again', data, null, 201);
  } catch (err) { next(err); }
};

const update = async (req, res, next) => {
  try {
    const data = await webhookService.updateWebhook(companyIdOf(req), req.params.id, {
      url: req.body.url,
      subscribedEvents: req.body.subscribed_events,
      isActive: req.body.is_active,
    });
    await auditLogService.logAudit({
      companyId: companyIdOf(req), actorId: req.user.id, actorRole: req.user.role,
      actionType: 'webhook_updated', targetType: 'webhook', targetId: data.id, afterState: data,
    });
    successResponse(res, 'Webhook updated', data);
  } catch (err) { next(err); }
};

const remove = async (req, res, next) => {
  try {
    await webhookService.deleteWebhook(companyIdOf(req), req.params.id);
    await auditLogService.logAudit({
      companyId: companyIdOf(req), actorId: req.user.id, actorRole: req.user.role,
      actionType: 'webhook_deleted', targetType: 'webhook', targetId: req.params.id,
    });
    successResponse(res, 'Webhook deleted', { deleted: true });
  } catch (err) { next(err); }
};

const deliveries = async (req, res, next) => {
  try {
    const { page, limit } = paginate(req.query);
    const { data, total } = await webhookService.listDeliveries(companyIdOf(req), req.params.id, { page, limit });
    successResponse(res, 'Deliveries fetched', data, buildMeta(page, limit, total));
  } catch (err) { next(err); }
};

const test = async (req, res, next) => {
  try {
    const result = await webhookService.sendTestEvent(companyIdOf(req), req.params.id);
    successResponse(res, result.ok ? 'Test event delivered' : 'Test event failed — see response details', result);
  } catch (err) { next(err); }
};

module.exports = { listCatalog, list, create, update, remove, deliveries, test };
