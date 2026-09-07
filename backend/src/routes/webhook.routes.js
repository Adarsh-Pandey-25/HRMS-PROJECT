const express = require('express');
const { body, param } = require('express-validator');
const webhookController = require('../controllers/webhook.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { isHROrAdmin } = require('../middleware/role.middleware');
const { validate } = require('../middleware/validation.middleware');
const { webhookTestLimiter } = require('../middleware/rateLimiter.middleware');

const router = express.Router();

router.use(authenticate, isHROrAdmin);

router.get('/catalog', webhookController.listCatalog);
router.get('/', webhookController.list);
router.post(
  '/',
  body('url').trim().notEmpty(),
  body('subscribed_events').isArray({ min: 1 }),
  validate,
  webhookController.create,
);
router.put(
  '/:id',
  param('id').isUUID(),
  body('url').optional().trim().notEmpty(),
  body('subscribed_events').optional().isArray({ min: 1 }),
  body('is_active').optional().isBoolean(),
  validate,
  webhookController.update,
);
router.delete('/:id', param('id').isUUID(), validate, webhookController.remove);
router.get('/:id/deliveries', param('id').isUUID(), validate, webhookController.deliveries);
router.post('/:id/test', param('id').isUUID(), validate, webhookTestLimiter, webhookController.test);

module.exports = router;
