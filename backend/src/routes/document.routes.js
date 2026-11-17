const express = require('express');
const documentController = require('../controllers/document.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { isHROrAdmin, isEmployee } = require('../middleware/role.middleware');
const { upload } = require('../middleware/upload.middleware');
const { requirePermission } = require('../middleware/requirePermission');
const { validate } = require('../middleware/validation.middleware');
const { documentUploadRules, uuidParam, paginationQuery } = require('../utils/validators');

const router = express.Router();

router.use(authenticate);

// Everyone's documents are part of Employee Management (View to list, Edit to
// verify). A person's own documents never need it.
const can = (action) => requirePermission('employees', action);

router.post('/upload', isEmployee, upload.single('file'), documentUploadRules, validate, documentController.upload);
router.get('/my-documents', isEmployee, paginationQuery, validate, documentController.myDocuments);
router.get('/all', isHROrAdmin, can('view'), paginationQuery, validate, documentController.allDocuments);
// Owner can view own docs; HR/Admin can view any (enforced in controller)
router.get('/employee/:employeeId', uuidParam('employeeId'), validate, documentController.employeeDocuments);
router.put('/:id/verify', isHROrAdmin, can('edit'), uuidParam(), validate, documentController.verify);
router.delete('/:id', uuidParam(), validate, documentController.remove);
router.get('/:id/download', uuidParam(), validate, documentController.download);

module.exports = router;
