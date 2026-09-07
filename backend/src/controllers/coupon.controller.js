const couponService = require('../services/coupon.service');
const billingOpsService = require('../services/billingOps.service');
const auditLogService = require('../services/auditLog.service');
const { successResponse, paginate, buildMeta } = require('../utils/helpers');
const { BadRequestError } = require('../utils/errors');

const listCoupons = async (req, res, next) => {
  try {
    successResponse(res, 'Coupons fetched', await couponService.listCoupons());
  } catch (err) { next(err); }
};

const createCoupon = async (req, res, next) => {
  try {
    const data = await couponService.createCoupon(req.superAdmin.id, {
      code: req.body.code,
      discountType: req.body.discount_type,
      discountValue: req.body.discount_value,
      validFrom: req.body.valid_from,
      validUntil: req.body.valid_until,
      maxRedemptions: req.body.max_redemptions,
      applicablePlanIds: req.body.applicable_plan_ids,
    });
    await auditLogService.logPlatformAudit({
      superAdminId: req.superAdmin.id, actionType: 'coupon_created', targetType: 'coupon', targetId: data.id,
      afterState: { code: data.code, discountType: data.discount_type, discountValue: data.discount_value }, ipAddress: req.ip,
    });
    successResponse(res, 'Coupon created', data, null, 201);
  } catch (err) { next(err); }
};

const deactivateCoupon = async (req, res, next) => {
  try {
    const data = await couponService.deactivateCoupon(req.params.id);
    await auditLogService.logPlatformAudit({
      superAdminId: req.superAdmin.id, actionType: 'coupon_deactivated', targetType: 'coupon', targetId: req.params.id, ipAddress: req.ip,
    });
    successResponse(res, 'Coupon deactivated', data);
  } catch (err) { next(err); }
};

const cohorts = async (req, res, next) => {
  try {
    const months = Math.min(24, Math.max(1, parseInt(req.query.months, 10) || 12));
    successResponse(res, 'Cohort retention', await billingOpsService.cohortRetention(months));
  } catch (err) { next(err); }
};

const failedPayments = async (req, res, next) => {
  try {
    const { page, limit } = paginate(req.query);
    const { data, total } = await billingOpsService.listFailedPayments({ page, limit });
    successResponse(res, 'Failed payments fetched', data, buildMeta(page, limit, total));
  } catch (err) { next(err); }
};

const retryFailedPayment = async (req, res, next) => {
  try {
    successResponse(res, 'Payment retried', await billingOpsService.retryFailedPayment(req.params.id, req.superAdmin.id));
  } catch (err) { next(err); }
};

const issueCredit = async (req, res, next) => {
  try {
    if (!req.body?.amount || !req.body?.reason) throw new BadRequestError('amount and reason are required');
    const invoice = await billingOpsService.issueManualCredit(req.params.id, req.body.amount, req.body.reason, req.superAdmin.id);
    await auditLogService.logSuperAdminAudit({
      companyId: req.params.id, superAdminId: req.superAdmin.id, actionType: 'manual_credit_issued',
      targetType: 'subscription_invoice', targetId: invoice.id, afterState: { amount: req.body.amount, reason: req.body.reason },
    });
    successResponse(res, 'Credit issued', invoice, null, 201);
  } catch (err) { next(err); }
};

const issueManualInvoice = async (req, res, next) => {
  try {
    if (!req.body?.amount || !req.body?.description || !req.body?.reference) {
      throw new BadRequestError('amount, description and reference are required');
    }
    const invoice = await billingOpsService.issueManualInvoice(
      req.params.id, req.body.amount, req.body.description, req.body.reference, req.superAdmin.id,
    );
    await auditLogService.logSuperAdminAudit({
      companyId: req.params.id, superAdminId: req.superAdmin.id, actionType: 'manual_invoice_created',
      targetType: 'subscription_invoice', targetId: invoice.id,
      afterState: { amount: req.body.amount, description: req.body.description, reference: req.body.reference },
    });
    successResponse(res, 'Manual invoice created', invoice, null, 201);
  } catch (err) { next(err); }
};

const recordPayment = async (req, res, next) => {
  try {
    const updated = await billingOpsService.recordInvoicePayment(
      req.params.id,
      {
        paymentMethod: req.body.payment_method,
        reference: req.body.reference,
        amountReceived: req.body.amount_received,
        note: req.body.note,
      },
      req.superAdmin.id,
    );
    await auditLogService.logSuperAdminAudit({
      companyId: updated.company_id, superAdminId: req.superAdmin.id, actionType: 'invoice_payment_recorded',
      targetType: 'subscription_invoice', targetId: updated.id,
      afterState: {
        paymentMethod: req.body.payment_method, reference: req.body.reference,
        amountReceived: req.body.amount_received, status: updated.status, amountPaid: updated.amount_paid, note: req.body.note || null,
      },
    });
    successResponse(res, 'Payment recorded', updated);
  } catch (err) { next(err); }
};

const extendSubscription = async (req, res, next) => {
  try {
    if (!req.body?.reason) throw new BadRequestError('A reason is required');
    const updated = await billingOpsService.extendSubscription(
      req.params.id,
      { daysToAdd: req.body.days, explicitEndDate: req.body.end_date },
      req.body.reason,
      req.superAdmin.id,
    );
    await auditLogService.logSuperAdminAudit({
      companyId: req.params.id, superAdminId: req.superAdmin.id, actionType: 'subscription_extended',
      targetType: 'company_billing_subscription', targetId: updated.id,
      afterState: { newEnd: updated.current_period_end, reason: req.body.reason },
    });
    successResponse(res, 'Subscription extended', updated);
  } catch (err) { next(err); }
};

module.exports = {
  listCoupons, createCoupon, deactivateCoupon, cohorts, failedPayments, retryFailedPayment,
  issueCredit, issueManualInvoice, recordPayment, extendSubscription,
};
