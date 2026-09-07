const express = require('express');
const { body, param } = require('express-validator');
const tenantBillingController = require('../controllers/tenantBilling.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { isHROrAdmin } = require('../middleware/role.middleware');
const { validate } = require('../middleware/validation.middleware');

const router = express.Router();

// Section F: strictly HR/Admin — "confirm a regular employee never sees this."
router.use(authenticate, isHROrAdmin);

router.get('/plans', tenantBillingController.listPlans);
router.get('/my-subscription', tenantBillingController.mySubscription);
router.get('/my-features', tenantBillingController.myFeatures);
router.get('/my-invoices', tenantBillingController.myInvoices);
router.get('/my-invoices/:id/download', param('id').isUUID(), validate, tenantBillingController.downloadInvoice);
router.get('/my-payment-method', tenantBillingController.myPaymentMethod);

router.post('/change-plan', body('plan_id').isUUID(), validate, tenantBillingController.changePlan);
router.post('/change-seats', body('seat_count').isInt({ min: 1 }), validate, tenantBillingController.changeSeats);
router.post('/change-billing-cycle', body('billing_cycle').isIn(['monthly', 'quarterly', 'annual']), validate, tenantBillingController.changeBillingCycle);
router.post('/request-feature', body('feature_key').trim().notEmpty(), validate, tenantBillingController.requestFeature);
router.post('/cancel-subscription', body('confirm_company_name').trim().notEmpty(), validate, tenantBillingController.cancelSubscription);

module.exports = router;
