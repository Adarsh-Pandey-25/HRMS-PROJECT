const jwt = require('jsonwebtoken');
const { supabaseAdmin } = require('../config/supabase');
const config = require('../config/database');
const { UnauthorizedError, ForbiddenError } = require('../utils/errors');

/**
 * Authenticate platform Super Admin via dedicated cookies / Bearer JWT.
 * Separate from employee `authenticate` — never mixes with company sessions.
 */
const authenticateSuperAdmin = async (req, res, next) => {
  try {
    const token =
      req.cookies?.saAccessToken
      || (req.headers.authorization?.startsWith('Bearer ')
        ? req.headers.authorization.split(' ')[1]
        : null);

    if (!token) throw new UnauthorizedError('Super admin access token required');

    // Audit finding N-18: verifies against the super-admin-specific secret,
    // not the one employee tokens verify against.
    let decoded;
    try {
      decoded = jwt.verify(token, config.jwt.superAdminSecret);
    } catch {
      throw new UnauthorizedError('Invalid or expired super admin token');
    }

    if (decoded.typ !== 'super_admin' || decoded.role !== 'super_admin') {
      throw new ForbiddenError('Not a super admin session');
    }

    const { data: admin, error } = await supabaseAdmin
      .from('super_admins')
      .select('id, email, name, is_active, role')
      .eq('id', decoded.id)
      .eq('is_active', true)
      .maybeSingle();

    if (error || !admin) throw new UnauthorizedError('Super admin not found or inactive');

    req.superAdmin = admin;
    req.authType = 'super_admin';
    next();
  } catch (err) {
    next(err);
  }
};

/**
 * Module 5: role-scoped route access. full_admin passes every check — it's
 * the unrestricted role. billing_admin/support_admin are blocked from
 * routes outside the roles list passed at each route.
 */
const requireSuperAdminRole = (...allowedRoles) => (req, res, next) => {
  if (!req.superAdmin) return next(new UnauthorizedError('Super admin authentication required'));
  if (req.superAdmin.role === 'full_admin' || allowedRoles.includes(req.superAdmin.role)) {
    return next();
  }
  return next(new ForbiddenError('Your super-admin role does not have access to this action'));
};

module.exports = { authenticateSuperAdmin, requireSuperAdminRole };
