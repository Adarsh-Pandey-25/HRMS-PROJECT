const config = require('../config/database');
const { getClientIp, ipInCidr } = require('../utils/helpers');
const { ForbiddenError } = require('../utils/errors');
const logger = require('../utils/logger');
const settingsService = require('../services/settings.service');

const validateOfficeIp = async (req, res, next) => {
  try {
    const clientIp = getClientIp(req);
    req.clientIp = clientIp;

    const { allowRemoteLogin, officeCidr } = await settingsService.getEffectiveOfficeConfig();
    if (allowRemoteLogin) return next();

    const isOfficeIp = ipInCidr(clientIp, officeCidr || config.officeCidr);

    if (!isOfficeIp) {
      logger.warn('Unauthorized IP access attempt', { ip: clientIp, path: req.path });
      return next(new ForbiddenError('Access denied: Office IP required'));
    }

    next();
  } catch (err) {
    next(err);
  }
};

const attachClientIp = (req, res, next) => {
  req.clientIp = getClientIp(req);
  next();
};

const validateOfficeIpOptional = (req, res, next) => {
  Promise.resolve()
    .then(async () => {
      const clientIp = getClientIp(req);
      req.clientIp = clientIp;
      const { officeCidr } = await settingsService.getEffectiveOfficeConfig();
      req.isOfficeIp = ipInCidr(clientIp, officeCidr || config.officeCidr);
    })
    .then(() => next())
    .catch((err) => next(err));
};

const requireOfficeIpForMethod = (methodsRequiringOffice = ['office_ip']) => (req, res, next) => {
  Promise.resolve()
    .then(async () => {
      const method = req.body?.method || 'web';
      const { allowRemoteLogin, officeCidr } = await settingsService.getEffectiveOfficeConfig();
      const cidr = officeCidr || config.officeCidr;

      if (methodsRequiringOffice.includes(method) && !allowRemoteLogin) {
        const clientIp = getClientIp(req);
        if (!ipInCidr(clientIp, cidr)) {
          throw new ForbiddenError('Office IP required for this check-in method');
        }
        req.clientIp = clientIp;
      } else {
        req.clientIp = getClientIp(req);
      }
    })
    .then(() => next())
    .catch((err) => next(err));
};

module.exports = {
  validateOfficeIp,
  validateOfficeIpOptional,
  requireOfficeIpForMethod,
  attachClientIp,
};
