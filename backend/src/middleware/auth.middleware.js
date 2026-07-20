const jwt = require('jsonwebtoken');
const { supabaseAdmin } = require('../config/supabase');
const { UnauthorizedError } = require('../utils/errors');
const { getCompanyId } = require('../utils/tenant');

const attachTenant = (employee) => {
  if (!employee) return employee;
  employee.company_id = getCompanyId(employee);
  return employee;
};

const authenticate = async (req, res, next) => {
  try {
    const token =
      req.cookies?.accessToken ||
      (req.headers.authorization?.startsWith('Bearer ')
        ? req.headers.authorization.split(' ')[1]
        : null);

    if (!token) {
      throw new UnauthorizedError('Access token required');
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const { data: employee, error } = await supabaseAdmin
      .from('employees')
      .select('*')
      .eq('id', decoded.id)
      .eq('is_active', true)
      .single();

    if (error || !employee) {
      throw new UnauthorizedError('Invalid or expired token');
    }

    req.user = attachTenant(employee);
    req.token = token;
    next();
  } catch (err) {
    if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
      return next(new UnauthorizedError('Invalid or expired token'));
    }
    next(err);
  }
};

const optionalAuth = async (req, res, next) => {
  try {
    const token =
      req.cookies?.accessToken ||
      (req.headers.authorization?.startsWith('Bearer ')
        ? req.headers.authorization.split(' ')[1]
        : null);

    if (!token) return next();

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const { data: employee } = await supabaseAdmin
      .from('employees')
      .select('*')
      .eq('id', decoded.id)
      .eq('is_active', true)
      .single();

    if (employee) req.user = attachTenant(employee);
    next();
  } catch {
    next();
  }
};

module.exports = { authenticate, optionalAuth };
