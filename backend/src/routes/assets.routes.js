const express = require('express');
const assetsController = require('../controllers/assets.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { isHROrAdmin, isEmployee } = require('../middleware/role.middleware');
const { validate } = require('../middleware/validation.middleware');
const { requireFeature } = require('../middleware/featureGate.middleware');
const { requirePermission } = require('../middleware/requirePermission');
const { paginationQuery } = require('../utils/validators');

const router = express.Router();

router.use(authenticate);
router.use(requireFeature('assets'));

// Settings → User & Role Management → Asset Management: Edit = Asset Inventory
// (add, assign, return, requests), Manage = categories. A person's own assets
// and requests never need it.
const can = (action) => requirePermission('assets', action);

router.get('/', isHROrAdmin, can(['edit', 'manage']), paginationQuery, validate, assetsController.list);
router.get('/mine', isEmployee, paginationQuery, validate, assetsController.mine);
router.get('/categories', isEmployee, assetsController.categories);
router.get('/requests', isEmployee, paginationQuery, validate, assetsController.requests);
router.post('/requests', isEmployee, assetsController.submitRequest);
router.put('/requests/:id', isHROrAdmin, can(['edit', 'manage']), assetsController.actOnRequest);
router.post('/categories', isHROrAdmin, can('manage'), assetsController.createCategory);
router.post('/', isHROrAdmin, can('edit'), assetsController.create);
router.post('/:id/return-request', isEmployee, assetsController.requestReturn);
router.put('/:id/assign', isHROrAdmin, can('edit'), assetsController.assign);
router.put('/:id/return', isHROrAdmin, can('edit'), assetsController.returnAsset);
router.put('/:id', isHROrAdmin, can('edit'), assetsController.update);

module.exports = router;
