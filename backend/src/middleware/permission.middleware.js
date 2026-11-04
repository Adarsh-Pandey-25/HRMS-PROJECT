const { ForbiddenError } = require('../utils/errors');
const rolePermissions = require('../services/rolePermissions.service');

/**
 * Lets the request through when the role permission matrix allows it
 * (Admin always; see rolePermissions.service.js for the rows it covers).
 */
const requirePermission = (module, action, message = 'Your role doesn\'t have this permission. An Admin can grant it in Settings → User & Role Management.') => async (req, res, next) => {
  try {
    if (await rolePermissions.can(req.user, module, action)) return next();
    return next(new ForbiddenError(message));
  } catch (err) {
    return next(err);
  }
};

module.exports = { requirePermission };
