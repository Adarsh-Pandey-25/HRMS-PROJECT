const { ForbiddenError } = require('../utils/errors');
const { ROLES } = require('../utils/constants');

const authorize = (...allowedRoles) => (req, res, next) => {
  if (!req.user) {
    return next(new ForbiddenError('Authentication required'));
  }
  if (!allowedRoles.includes(req.user.role)) {
    return next(new ForbiddenError('Insufficient permissions'));
  }
  next();
};

const isHR = authorize(ROLES.HR, ROLES.ADMIN);
const isAdmin = authorize(ROLES.ADMIN);
const isManager = authorize(ROLES.MANAGER, ROLES.HR, ROLES.ADMIN);
const isEmployee = authorize(ROLES.EMPLOYEE, ROLES.MANAGER, ROLES.HR, ROLES.ADMIN);
const isHROrAdmin = authorize(ROLES.HR, ROLES.ADMIN);
const isManagerOrAbove = authorize(ROLES.MANAGER, ROLES.HR, ROLES.ADMIN);

module.exports = {
  authorize,
  isHR,
  isAdmin,
  isManager,
  isEmployee,
  isHROrAdmin,
  isManagerOrAbove,
};
