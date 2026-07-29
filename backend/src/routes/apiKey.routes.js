const express = require('express');
const apiKeyController = require('../controllers/apiKey.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { isAdmin } = require('../middleware/role.middleware');
const { validate } = require('../middleware/validation.middleware');
const { body } = require('express-validator');
const { uuidParam } = require('../utils/validators');

const router = express.Router();

router.use(authenticate);
router.use(isAdmin);

router.get('/scopes', apiKeyController.scopes);
router.get('/', apiKeyController.list);
router.post(
  '/',
  [
    body('name').trim().isLength({ min: 2, max: 120 }),
    body('scopes').isArray({ min: 1 }),
    body('scopes.*').isString(),
    body('environment').optional().isIn(['live', 'test']),
    body('expires_at').optional({ nullable: true }).isISO8601(),
  ],
  validate,
  apiKeyController.create,
);
router.post('/:id/revoke', uuidParam(), validate, apiKeyController.revoke);
router.delete('/:id', uuidParam(), validate, apiKeyController.revoke);

module.exports = router;
