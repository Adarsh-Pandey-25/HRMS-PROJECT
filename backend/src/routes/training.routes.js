const express = require('express');
const trainingController = require('../controllers/training.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { isHROrAdmin, isManagerOrAbove, isEmployee } = require('../middleware/role.middleware');
const { upload } = require('../middleware/upload.middleware');
const { validate } = require('../middleware/validation.middleware');
const { trainingCreateRules, uuidParam, paginationQuery } = require('../utils/validators');

const router = express.Router();

router.use(authenticate);

router.post('/create', isHROrAdmin, upload.single('materials'), trainingCreateRules, validate, trainingController.create);
router.get('/all-trainings', paginationQuery, validate, trainingController.allTrainings);
router.get('/my-trainings', isEmployee, trainingController.myTrainings);
router.post('/assign', isManagerOrAbove, trainingController.assign);
router.put('/:id/complete', isEmployee, uuidParam(), validate, trainingController.complete);
router.get('/:id/participants', uuidParam(), validate, trainingController.participants);
router.delete('/:id', isHROrAdmin, uuidParam(), validate, trainingController.remove);

module.exports = router;
