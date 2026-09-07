const express = require('express');
const assetsController = require('../controllers/assets.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { isHROrAdmin, isEmployee } = require('../middleware/role.middleware');
const { validate } = require('../middleware/validation.middleware');
const { requireFeature } = require('../middleware/featureGate.middleware');
const { paginationQuery } = require('../utils/validators');

const router = express.Router();

router.use(authenticate);
router.use(requireFeature('assets'));

router.get('/', isHROrAdmin, paginationQuery, validate, assetsController.list);
router.get('/mine', isEmployee, paginationQuery, validate, assetsController.mine);
router.get('/categories', isEmployee, assetsController.categories);
router.get('/requests', isEmployee, paginationQuery, validate, assetsController.requests);
router.post('/requests', isEmployee, assetsController.submitRequest);
router.put('/requests/:id', isHROrAdmin, assetsController.actOnRequest);
router.post('/categories', isHROrAdmin, assetsController.createCategory);
router.post('/', isHROrAdmin, assetsController.create);
router.put('/:id/assign', isHROrAdmin, assetsController.assign);
router.put('/:id/return', isHROrAdmin, assetsController.returnAsset);
router.put('/:id', isHROrAdmin, assetsController.update);

module.exports = router;
