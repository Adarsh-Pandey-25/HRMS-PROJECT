const jwt = require('jsonwebtoken');
const { supabaseAdmin } = require('../config/supabase');
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

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch {
      throw new UnauthorizedError('Invalid or expired super admin token');
    }

    if (decoded.typ !== 'super_admin' || decoded.role !== 'super_admin') {
      throw new ForbiddenError('Not a super admin session');
    }

    const { data: admin, error } = await supabaseAdmin
      .from('super_admins')
      .select('id, email, name, is_active')
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

module.exports = { authenticateSuperAdmin };
