const { ForbiddenError } = require('../utils/errors');
const rolePermissions = require('../services/rolePermissions.service');

const messageFor = (module, action) => {
  const label = rolePermissions.MODULE_LABELS[module] || module;
  return `Your role doesn't have "${action}" access to ${label}. An Admin can grant it in Settings → User & Role Management.`;
};

/**
 * Lets the request through when Settings → User & Role Management allows the
 * signed-in role any one of `cells` ([module, action] pairs). Admin always
 * passes. Put it after the route's role check (isHROrAdmin, …).
 *
 * options (or just a message string):
 *   message      what a refused user is told
 *   selfService  (req) => true when the request is only about the caller's
 *                own data — it always goes through, whatever the matrix says
 */
const requireAnyPermission = (cells, options = {}) => {
  const { message, selfService } = typeof options === 'string' ? { message: options } : options;
  return async (req, res, next) => {
    try {
      if (selfService && selfService(req)) return next();
      for (const [module, action] of cells) {
        // eslint-disable-next-line no-await-in-loop
        if (await rolePermissions.can(req.user, module, action)) return next();
      }
      return next(new ForbiddenError(message || messageFor(...cells[0])));
    } catch (err) {
      return next(err);
    }
  };
};

/** requireAnyPermission for one module: any one of `actions` (a name or a list). */
const requirePermission = (module, actions, options) => requireAnyPermission(
  (Array.isArray(actions) ? actions : [actions]).map((action) => [module, action]),
  options,
);

/** Is `id` the signed-in user's own id? IDs are compared ignoring case. */
const isOwnId = (req, id) => Boolean(id && req.user?.id)
  && String(id).trim().toLowerCase() === String(req.user.id).trim().toLowerCase();

module.exports = { requirePermission, requireAnyPermission, isOwnId };
