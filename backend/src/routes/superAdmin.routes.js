const express = require('express');
const { body, param } = require('express-validator');
const superAdminController = require('../controllers/superAdmin.controller');
const planAdminController = require('../controllers/planAdmin.controller');
const subscriptionAdminController = require('../controllers/subscriptionAdmin.controller');
const dashboardController = require('../controllers/superAdminDashboard.controller');
const companyDetailController = require('../controllers/companyDetail.controller');
const featureOverrideController = require('../controllers/featureOverride.controller');
const couponController = require('../controllers/coupon.controller');
const systemHealthController = require('../controllers/systemHealth.controller');
const { authenticateSuperAdmin, requireSuperAdminRole } = require('../middleware/superAdmin.middleware');
const { validate } = require('../middleware/validation.middleware');
const { authLimiter } = require('../middleware/rateLimiter.middleware');

const router = express.Router();

// ── Auth (2FA-aware; unchanged behavior for any admin with 2FA disabled) ───
router.post(
  '/login',
  authLimiter,
  body('email').isEmail().normalizeEmail(),
  body('password').notEmpty(),
  validate,
  superAdminController.login,
);
router.post(
  '/login/verify-2fa',
  authLimiter,
  body('pending_token').notEmpty(),
  body('code').isLength({ min: 6, max: 6 }),
  validate,
  superAdminController.verifyTwoFactor,
);

router.post('/logout', authenticateSuperAdmin, superAdminController.logout);
router.post('/refresh-token', authLimiter, superAdminController.refreshToken);
router.get('/me', authenticateSuperAdmin, superAdminController.me);

// ── Module 5: self-service 2FA enrollment (any authenticated super admin) ──
router.post('/2fa/enroll', authenticateSuperAdmin, superAdminController.startTwoFactorEnrollment);
router.post('/2fa/confirm', authenticateSuperAdmin, body('code').isLength({ min: 6, max: 6 }), validate, superAdminController.confirmTwoFactorEnrollment);
router.post('/2fa/disable', authenticateSuperAdmin, body('code').isLength({ min: 6, max: 6 }), validate, superAdminController.disableTwoFactor);

// ── Module 5: super-admin user management (full_admin only) ────────────────
router.get('/admin-users', authenticateSuperAdmin, requireSuperAdminRole(), superAdminController.listSuperAdminUsers);
router.post(
  '/admin-users',
  authenticateSuperAdmin,
  requireSuperAdminRole(),
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min: 8 }),
  body('role').isIn(['full_admin', 'billing_admin', 'support_admin']),
  validate,
  superAdminController.createSuperAdminUser,
);
router.patch('/admin-users/:id/active', authenticateSuperAdmin, requireSuperAdminRole(), param('id').isUUID(), body('is_active').isBoolean(), validate, superAdminController.setSuperAdminActive);
router.patch('/admin-users/:id/role', authenticateSuperAdmin, requireSuperAdminRole(), param('id').isUUID(), body('role').isIn(['full_admin', 'billing_admin', 'support_admin']), validate, superAdminController.updateSuperAdminRole);

// ── Module 1: Dashboard (read-only, every role) ─────────────────────────────
router.get('/dashboard/summary', authenticateSuperAdmin, dashboardController.getSummary);
router.get('/dashboard/growth', authenticateSuperAdmin, dashboardController.getGrowth);
router.get('/dashboard/attention-feed', authenticateSuperAdmin, dashboardController.getAttentionFeed);

// ── Companies (list + create-invite scoped to full_admin/billing_admin) ────
router.get('/companies', authenticateSuperAdmin, superAdminController.listCompanies);
router.patch(
  '/companies/:id',
  authenticateSuperAdmin,
  requireSuperAdminRole('support_admin'),
  param('id').isUUID(),
  body('is_active').optional().isBoolean(),
  body('isActive').optional().isBoolean(),
  validate,
  superAdminController.setCompanyActive,
);

// ── Module 2: Company detail (support_admin + billing_admin can view/act) ──
router.get('/companies/:id/profile', authenticateSuperAdmin, param('id').isUUID(), validate, companyDetailController.getProfile);
router.patch('/companies/:id/profile', authenticateSuperAdmin, requireSuperAdminRole('support_admin'), param('id').isUUID(), validate, companyDetailController.updateProfile);
router.get('/companies/:id/employees', authenticateSuperAdmin, param('id').isUUID(), validate, companyDetailController.listEmployees);
router.get('/companies/:id/subscription', authenticateSuperAdmin, param('id').isUUID(), validate, companyDetailController.getSubscription);
router.get('/companies/:id/usage', authenticateSuperAdmin, param('id').isUUID(), validate, companyDetailController.getUsage);
router.get('/companies/:id/audit-log', authenticateSuperAdmin, param('id').isUUID(), validate, companyDetailController.getAuditLog);
router.get('/companies/:id/notes', authenticateSuperAdmin, param('id').isUUID(), validate, companyDetailController.listNotes);
router.post('/companies/:id/notes', authenticateSuperAdmin, requireSuperAdminRole('support_admin'), param('id').isUUID(), body('note').trim().notEmpty(), validate, companyDetailController.addNote);
router.delete('/companies/:id/notes/:noteId', authenticateSuperAdmin, requireSuperAdminRole('support_admin'), param('id').isUUID(), param('noteId').isUUID(), validate, companyDetailController.deleteNote);
router.post('/companies/:id/suspend', authenticateSuperAdmin, requireSuperAdminRole('support_admin'), param('id').isUUID(), validate, companyDetailController.suspend);
router.post('/companies/:id/reactivate', authenticateSuperAdmin, requireSuperAdminRole('support_admin'), param('id').isUUID(), validate, companyDetailController.reactivate);

// ── Module 6: Feature & seat overrides ──────────────────────────────────────
router.get('/companies/:id/features', authenticateSuperAdmin, param('id').isUUID(), validate, featureOverrideController.getFeatures);
router.post('/companies/:id/features/:key', authenticateSuperAdmin, requireSuperAdminRole('billing_admin'), param('id').isUUID(), validate, featureOverrideController.setFeature);
router.delete('/companies/:id/features/:key', authenticateSuperAdmin, requireSuperAdminRole('billing_admin'), param('id').isUUID(), validate, featureOverrideController.clearFeature);
router.post('/companies/:id/seat-override', authenticateSuperAdmin, requireSuperAdminRole('billing_admin'), param('id').isUUID(), validate, featureOverrideController.setSeatOverride);
router.post(
  '/companies/:id/features/:key/data-collection',
  authenticateSuperAdmin,
  requireSuperAdminRole('billing_admin'),
  param('id').isUUID(),
  body('mode').isIn(['continue', 'stop']),
  validate,
  featureOverrideController.setDataCollectionMode,
);
router.post(
  '/companies/:id/export-override',
  authenticateSuperAdmin,
  requireSuperAdminRole('support_admin', 'billing_admin'),
  param('id').isUUID(),
  body('enabled').isBoolean(),
  body('reason').trim().notEmpty(),
  validate,
  featureOverrideController.setExportOverride,
);

// ── Module 4: Impersonation (support_admin only, not billing_admin) ────────
router.post('/companies/:id/impersonate', authenticateSuperAdmin, requireSuperAdminRole('support_admin'), param('id').isUUID(), body('reason').trim().notEmpty(), validate, companyDetailController.impersonate);
router.get('/impersonation/active', authenticateSuperAdmin, requireSuperAdminRole(), systemHealthController.getActiveImpersonations);

router.get('/invites', authenticateSuperAdmin, superAdminController.listInvites);
router.get('/invites/suggest-slug', authenticateSuperAdmin, superAdminController.suggestSlug);
router.post(
  '/invites',
  authenticateSuperAdmin,
  requireSuperAdminRole('billing_admin'),
  body('email').isEmail().normalizeEmail(),
  body().custom((payload) => {
    const companyName = payload.company_name_hint || payload.companyNameHint;
    if (!companyName || typeof companyName !== 'string' || !companyName.trim()) {
      throw new Error('Company name is required');
    }
    if (companyName.trim().length > 200) {
      throw new Error('Company name must not exceed 200 characters');
    }
    return true;
  }),
  body('expires_in_days').optional().isInt({ min: 1, max: 30 }),
  body('expiresInDays').optional().isInt({ min: 1, max: 30 }),
  body('slug').optional().isString().isLength({ max: 63 }),
  body('company_slug').optional().isString().isLength({ max: 63 }),
  validate,
  superAdminController.createInvite,
);
router.post(
  '/invites/:id/revoke',
  authenticateSuperAdmin,
  requireSuperAdminRole('billing_admin'),
  param('id').isUUID(),
  validate,
  superAdminController.revokeInvite,
);

// ── Billing: Plans ──────────────────────────────────────────────────────
router.get('/plans', authenticateSuperAdmin, planAdminController.list);
router.get('/plans/:id', authenticateSuperAdmin, param('id').isUUID(), validate, planAdminController.getOne);
router.post(
  '/plans',
  authenticateSuperAdmin,
  requireSuperAdminRole('billing_admin'),
  body('name').trim().notEmpty(),
  body('code').trim().notEmpty(),
  validate,
  planAdminController.create,
);
router.patch('/plans/:id', authenticateSuperAdmin, requireSuperAdminRole('billing_admin'), param('id').isUUID(), validate, planAdminController.update);
router.post('/plans/:id/deactivate', authenticateSuperAdmin, requireSuperAdminRole('billing_admin'), param('id').isUUID(), validate, planAdminController.deactivate);

// ── Billing: Subscriptions ──────────────────────────────────────────────
router.get('/subscriptions', authenticateSuperAdmin, subscriptionAdminController.list);
// Must be registered before /subscriptions/:id — otherwise Express matches
// this literal path against the :id param route first.
router.get('/subscriptions/expiring', authenticateSuperAdmin, subscriptionAdminController.expiring);
router.get('/subscriptions/:id', authenticateSuperAdmin, param('id').isUUID(), validate, subscriptionAdminController.getOne);
router.post(
  '/subscriptions',
  authenticateSuperAdmin,
  requireSuperAdminRole('billing_admin'),
  body('company_id').isUUID(),
  body('plan_id').isUUID(),
  body('billing_cycle').isIn(['monthly', 'quarterly', 'annual']),
  body('seat_count').isInt({ min: 1 }),
  validate,
  subscriptionAdminController.create,
);
router.post(
  '/subscriptions/:id/seats',
  authenticateSuperAdmin,
  requireSuperAdminRole('billing_admin'),
  param('id').isUUID(),
  body('seat_count').isInt({ min: 1 }),
  validate,
  subscriptionAdminController.changeSeats,
);
router.post(
  '/subscriptions/:id/plan',
  authenticateSuperAdmin,
  requireSuperAdminRole('billing_admin'),
  param('id').isUUID(),
  body('plan_id').isUUID(),
  validate,
  subscriptionAdminController.changePlan,
);
router.post('/subscriptions/:id/renew', authenticateSuperAdmin, requireSuperAdminRole('billing_admin'), param('id').isUUID(), validate, subscriptionAdminController.renew);
router.post(
  '/subscriptions/:id/manual-renew',
  authenticateSuperAdmin,
  requireSuperAdminRole('billing_admin'),
  param('id').isUUID(),
  body('payment_reference').trim().notEmpty(),
  validate,
  subscriptionAdminController.manualRenew,
);
router.post('/subscriptions/:id/cancel', authenticateSuperAdmin, requireSuperAdminRole('billing_admin'), param('id').isUUID(), validate, subscriptionAdminController.cancel);
router.post('/subscriptions/:id/suspend', authenticateSuperAdmin, requireSuperAdminRole('billing_admin'), param('id').isUUID(), validate, subscriptionAdminController.suspend);
router.post('/subscriptions/:id/reactivate', authenticateSuperAdmin, requireSuperAdminRole('billing_admin'), param('id').isUUID(), validate, subscriptionAdminController.reactivate);

// ── Billing: Invoices ────────────────────────────────────────────────────
router.get('/invoices', authenticateSuperAdmin, subscriptionAdminController.listInvoices);
// Item 4: reconciles an offline payment (bank transfer/cheque/cash) against
// an EXISTING invoice — distinct from /companies/:id/invoices/manual below
// (creates a brand-new already-paid invoice) and /companies/:id/credit
// above (reduces amount owed). :id here is the invoice id, not a company id.
router.post(
  '/invoices/:id/record-payment',
  authenticateSuperAdmin,
  requireSuperAdminRole('billing_admin'),
  param('id').isUUID(),
  body('payment_method').isIn(['bank_transfer', 'cheque', 'cash', 'other']),
  body('reference').trim().notEmpty(),
  body('amount_received').optional().isFloat({ gt: 0 }),
  body('note').optional().trim(),
  validate,
  couponController.recordPayment,
);

// ── Billing: Analytics ───────────────────────────────────────────────────
router.get('/revenue/summary', authenticateSuperAdmin, subscriptionAdminController.revenueSummary);
router.get('/revenue/trend', authenticateSuperAdmin, subscriptionAdminController.revenueTrend);
router.get('/revenue/by-plan', authenticateSuperAdmin, subscriptionAdminController.revenueByPlan);
router.get('/revenue/cohorts', authenticateSuperAdmin, couponController.cohorts);
router.get('/churn', authenticateSuperAdmin, subscriptionAdminController.churn);
// Module 3: "upcoming renewals" reuses the existing expiring-subscriptions
// analytics endpoint (?days=30) rather than a second implementation.
router.get('/revenue/upcoming-renewals', authenticateSuperAdmin, subscriptionAdminController.expiring);

// ── Module 3: Failed payments + manual credit ───────────────────────────────
router.get('/billing/failed-payments', authenticateSuperAdmin, requireSuperAdminRole('billing_admin'), couponController.failedPayments);
router.post('/billing/failed-payments/:id/retry', authenticateSuperAdmin, requireSuperAdminRole('billing_admin'), param('id').isUUID(), validate, couponController.retryFailedPayment);
router.post('/companies/:id/credit', authenticateSuperAdmin, requireSuperAdminRole('billing_admin'), param('id').isUUID(), body('amount').isFloat({ gt: 0 }), body('reason').trim().notEmpty(), validate, couponController.issueCredit);
router.post(
  '/companies/:id/invoices/manual',
  authenticateSuperAdmin,
  requireSuperAdminRole('billing_admin'),
  param('id').isUUID(),
  body('amount').isFloat({ gt: 0 }),
  body('description').trim().notEmpty(),
  body('reference').trim().notEmpty(),
  validate,
  couponController.issueManualInvoice,
);
router.post(
  '/companies/:id/subscription/extend',
  authenticateSuperAdmin,
  requireSuperAdminRole('billing_admin'),
  param('id').isUUID(),
  body('reason').trim().notEmpty(),
  body('days').optional().isInt({ min: 1 }),
  body('end_date').optional().isISO8601(),
  validate,
  couponController.extendSubscription,
);

// ── Module 3: Coupons ────────────────────────────────────────────────────
router.get('/coupons', authenticateSuperAdmin, requireSuperAdminRole('billing_admin'), couponController.listCoupons);
router.post(
  '/coupons',
  authenticateSuperAdmin,
  requireSuperAdminRole('billing_admin'),
  body('code').trim().notEmpty(),
  body('discount_type').isIn(['percent', 'flat']),
  body('discount_value').isFloat({ gt: 0 }),
  validate,
  couponController.createCoupon,
);
router.post('/coupons/:id/deactivate', authenticateSuperAdmin, requireSuperAdminRole('billing_admin'), param('id').isUUID(), validate, couponController.deactivateCoupon);

// ── Module 7: System health (full_admin only) ───────────────────────────────
router.get('/system/health', authenticateSuperAdmin, requireSuperAdminRole(), systemHealthController.getHealth);
router.get('/system/crons', authenticateSuperAdmin, requireSuperAdminRole(), systemHealthController.getCrons);
router.get('/system/email-failures', authenticateSuperAdmin, requireSuperAdminRole(), systemHealthController.getEmailFailures);

// Item 5: company_id required — never a global unscoped dump across tenants.
router.get('/audit-logs', authenticateSuperAdmin, superAdminController.listAuditLogs);

module.exports = router;
