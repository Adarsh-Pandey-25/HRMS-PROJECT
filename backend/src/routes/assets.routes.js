const express = require('express');
const assetsController = require('../controllers/assets.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { isHROrAdmin, isEmployee } = require('../middleware/role.middleware');

const router = express.Router();

router.use(authenticate);

router.get('/', isHROrAdmin, assetsController.list);
router.get('/mine', isEmployee, assetsController.mine);
router.get('/categories', isEmployee, assetsController.categories);
router.get('/requests', isEmployee, assetsController.requests);
router.post('/requests', isEmployee, assetsController.submitRequest);
router.put('/requests/:id', isHROrAdmin, assetsController.actOnRequest);
router.post('/categories', isHROrAdmin, assetsController.createCategory);
router.post('/', isHROrAdmin, assetsController.create);
router.put('/:id/assign', isHROrAdmin, assetsController.assign);
router.put('/:id/return', isHROrAdmin, assetsController.returnAsset);
router.put('/:id', isHROrAdmin, assetsController.update);

module.exports = router;
