const express = require('express');
const holidayController = require('../controllers/holiday.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { isHROrAdmin, isEmployee } = require('../middleware/role.middleware');
const { validate } = require('../middleware/validation.middleware');
const { holidayRules, uuidParam } = require('../utils/validators');

const router = express.Router();

router.use(authenticate);

router.post('/create', isHROrAdmin, holidayRules, validate, holidayController.create);
router.get('/year/:year', isEmployee, holidayController.byYear);
router.put('/:id/update', isHROrAdmin, uuidParam(), validate, holidayController.update);
router.delete('/:id', isHROrAdmin, uuidParam(), validate, holidayController.remove);
router.get('/upcoming', isEmployee, holidayController.upcoming);

module.exports = router;
