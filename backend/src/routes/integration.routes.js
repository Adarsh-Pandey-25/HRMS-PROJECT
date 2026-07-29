const express = require('express');
const { supabaseAdmin } = require('../config/supabase');
const { successResponse, omitSensitive } = require('../utils/helpers');
const { authenticate } = require('../middleware/auth.middleware');
const { requireApiScope } = require('../middleware/apiKey.middleware');
const { getCompanyById } = require('../services/tenant.service');

const router = express.Router();

/**
 * Machine / third-party integration endpoints.
 * Auth: company API key only (X-API-Key or Bearer hrms_…).
 */
router.use(authenticate);

/** Sanity check — beginners use this first. */
router.get('/ping', requireApiScope('ping', 'employees:read', 'attendance:write'), async (req, res, next) => {
  try {
    const company = await getCompanyById(req.user.company_id);
    successResponse(res, 'API key is valid', {
      ok: true,
      company_id: req.user.company_id,
      company_name: company?.name || null,
      scopes: req.user.scopes || [],
      api_key_id: req.user.api_key_id,
    });
  } catch (err) {
    next(err);
  }
});

/** List employees for this company only (never other tenants). */
router.get('/employees', requireApiScope('employees:read'), async (req, res, next) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('employees')
      .select('id, employee_code, first_name, last_name, email, role, department, designation, is_active, company_id')
      .eq('company_id', req.user.company_id)
      .eq('is_active', true)
      .order('first_name', { ascending: true })
      .limit(500);
    if (error) throw error;
    const rows = (data || []).map((e) => omitSensitive(e, ['password_hash']));
    successResponse(res, 'Employees fetched', rows);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
