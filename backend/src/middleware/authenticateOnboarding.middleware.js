const jwt = require('jsonwebtoken');
const { supabaseAdmin } = require('../config/supabase');
const { UnauthorizedError, ForbiddenError } = require('../utils/errors');

const authenticateOnboarding = async (req, res, next) => {
  try {
    const authHeader = String(req.headers.authorization || '');
    const token = authHeader.startsWith('Bearer ')
      ? authHeader.slice(7)
      : req.query.token;

    if (!token) {
      throw new UnauthorizedError('Onboarding token required. Use Authorization: Bearer <token> or ?token=<token>');
    }

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch {
      throw new UnauthorizedError('Invalid or expired onboarding token');
    }

    if (decoded.scope !== 'onboarding') {
      throw new UnauthorizedError('Invalid token scope');
    }

    if (!decoded.employee_id) {
      throw new UnauthorizedError('Invalid onboarding token payload');
    }
    // The link only works on the employee's own company subdomain.
    if (req.tenantCompany && String(decoded.company_id) !== String(req.tenantCompany.id)) {
      throw new UnauthorizedError('Invalid or expired onboarding token');
    }

    const { data: employee, error } = await supabaseAdmin
      .from('employees')
      .select('id, company_id, email, onboarding_completed, onboarding_token_used, is_active')
      .eq('id', decoded.employee_id)
      .eq('company_id', decoded.company_id)
      .maybeSingle();

    if (error) throw new UnauthorizedError(error.message);
    if (!employee) throw new UnauthorizedError('Employee not found');
    if (!employee.is_active) throw new ForbiddenError('Account is inactive. Contact HR.');
    if (employee.onboarding_completed) {
      throw new ForbiddenError('Onboarding already completed. You can log in normally.');
    }
    if (employee.onboarding_token_used) {
      throw new UnauthorizedError('Onboarding token has already been used.');
    }

    req.onboardingEmployee = {
      id: employee.id,
      company_id: employee.company_id,
      email: employee.email,
    };
    next();
  } catch (err) {
    next(err);
  }
};

module.exports = { authenticateOnboarding };
