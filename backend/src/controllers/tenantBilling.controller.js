const tenantBillingService = require('../services/tenantBilling.service');
const invoicePdfService = require('../services/invoicePdf.service');
const planService = require('../services/plan.service');
const { successResponse, paginate, buildMeta } = require('../utils/helpers');
const { BadRequestError } = require('../utils/errors');

/**
 * Section F: HR/Admin need to pick a target plan for the Change Plan
 * modal, but /super-admin/plans requires super-admin auth — a tenant
 * employee JWT can never reach it. Reuses the same planService.listPlans
 * read the super-admin plan list uses (active plans only, no write access
 * here) rather than building a parallel plans-lookup.
 */
const listPlans = async (req, res, next) => {
  try {
    successResponse(res, 'Plans fetched', await planService.listPlans({ includeInactive: false }));
  } catch (err) { next(err); }
};

const mySubscription = async (req, res, next) => {
  try {
    const data = await tenantBillingService.getMySubscription(req.user.company_id);
    successResponse(res, data ? 'Subscription fetched' : 'No active subscription', data);
  } catch (err) { next(err); }
};

const myFeatures = async (req, res, next) => {
  try {
    successResponse(res, 'Features fetched', await tenantBillingService.getMyFeatures(req.user.company_id));
  } catch (err) { next(err); }
};

const myInvoices = async (req, res, next) => {
  try {
    const { page, limit } = paginate(req.query);
    const { data, total } = await tenantBillingService.listMyInvoices(req.user.company_id, { page, limit });
    successResponse(res, 'Invoices fetched', data, buildMeta(page, limit, total));
  } catch (err) { next(err); }
};

const downloadInvoice = async (req, res, next) => {
  try {
    const invoice = await tenantBillingService.getInvoiceOrThrow(req.user.company_id, req.params.id);
    const buffer = await invoicePdfService.generateInvoicePdf(invoice, invoice.companies?.name);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="invoice-${invoice.invoice_number}.pdf"`);
    res.setHeader('Content-Length', buffer.length);
    res.send(buffer);
  } catch (err) { next(err); }
};

const myPaymentMethod = async (req, res, next) => {
  try {
    successResponse(res, 'Payment method fetched', await tenantBillingService.getMyPaymentMethod(req.user.company_id));
  } catch (err) { next(err); }
};

const changePlan = async (req, res, next) => {
  try {
    if (!req.body?.plan_id) throw new BadRequestError('plan_id is required');
    successResponse(res, 'Plan change requested — billing will follow up shortly', await tenantBillingService.requestPlanChange(req.user.company_id, req.body.plan_id, req.user.id), null, 201);
  } catch (err) { next(err); }
};

const changeSeats = async (req, res, next) => {
  try {
    if (!req.body?.seat_count) throw new BadRequestError('seat_count is required');
    successResponse(res, 'Seat change requested — billing will follow up shortly', await tenantBillingService.requestSeatChange(req.user.company_id, Number(req.body.seat_count), req.user.id), null, 201);
  } catch (err) { next(err); }
};

const changeBillingCycle = async (req, res, next) => {
  try {
    if (!req.body?.billing_cycle) throw new BadRequestError('billing_cycle is required');
    successResponse(res, 'Billing cycle change requested — billing will follow up shortly', await tenantBillingService.requestBillingCycleChange(req.user.company_id, req.body.billing_cycle, req.user.id), null, 201);
  } catch (err) { next(err); }
};

const requestFeature = async (req, res, next) => {
  try {
    if (!req.body?.feature_key) throw new BadRequestError('feature_key is required');
    successResponse(res, 'Feature request submitted', await tenantBillingService.requestFeature(req.user.company_id, req.body.feature_key, req.user.id), null, 201);
  } catch (err) { next(err); }
};

const cancelSubscription = async (req, res, next) => {
  try {
    if (!req.body?.confirm_company_name) throw new BadRequestError('confirm_company_name is required');
    successResponse(res, 'Cancellation processed', await tenantBillingService.cancelMySubscription(req.user.company_id, {
      reason: req.body.reason, confirmCompanyName: req.body.confirm_company_name, immediate: req.body.immediate,
    }, req.user.id));
  } catch (err) { next(err); }
};

module.exports = {
  listPlans, mySubscription, myFeatures, myInvoices, downloadInvoice, myPaymentMethod,
  changePlan, changeSeats, changeBillingCycle, requestFeature, cancelSubscription,
};
