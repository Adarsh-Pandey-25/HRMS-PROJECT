const express = require('express');
const assetsController = require('../controllers/assets.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { isHROrAdmin } = require('../middleware/role.middleware');

const router = express.Router();

router.use(authenticate);

router.get('/', assetsController.list);
router.get('/mine', assetsController.mine);
router.get('/categories', assetsController.categories);
router.get('/requests', assetsController.requests);
router.post('/requests', assetsController.submitRequest);
router.put('/requests/:id', isHROrAdmin, assetsController.actOnRequest);
router.post('/', isHROrAdmin, assetsController.create);

module.exports = router;
