const config = require('../config/database');
const { getClientIp, getClientIps, anyIpInCidr } = require('../utils/helpers');
const { ForbiddenError } = require('../utils/errors');
const logger = require('../utils/logger');
const settingsService = require('../services/settings.service');
const { getCompanyId, DEFAULT_COMPANY_ID } = require('../utils/tenant');

const companyIdFromReq = (req) =>
  req.user?.company_id || (req.user ? getCompanyId(req.user) : null) || DEFAULT_COMPANY_ID;

const validateOfficeIp = async (req, res, next) => {
  try {
    const clientIps = getClientIps(req);
    const clientIp = getClientIp(req) || clientIps[0] || '';
    req.clientIp = clientIp;
    req.clientIps = clientIps;

    const { allowRemoteLogin, officeCidr } = await settingsService.getEffectiveOfficeConfig(companyIdFromReq(req));
    if (allowRemoteLogin) return next();

    const isOfficeIp = anyIpInCidr(clientIps.length ? clientIps : [clientIp], officeCidr || config.officeCidr);

    if (!isOfficeIp) {
      logger.warn('Unauthorized IP access attempt', { ip: clientIp, ips: clientIps, path: req.path });
      return next(new ForbiddenError('Access denied: Office IP required'));
    }

    next();
  } catch (err) {
    next(err);
  }
};

const attachClientIp = (req, res, next) => {
  req.clientIps = getClientIps(req);
  req.clientIp = getClientIp(req) || req.clientIps[0] || '';
  next();
};

const validateOfficeIpOptional = (req, res, next) => {
  Promise.resolve()
    .then(async () => {
      const clientIps = getClientIps(req);
      const clientIp = getClientIp(req) || clientIps[0] || '';
      req.clientIp = clientIp;
      req.clientIps = clientIps;
      const { officeCidr } = await settingsService.getEffectiveOfficeConfig(companyIdFromReq(req));
      req.isOfficeIp = anyIpInCidr(clientIps.length ? clientIps : [clientIp], officeCidr || config.officeCidr);
    })
    .then(() => next())
    .catch((err) => next(err));
};

const requireOfficeIpForMethod = (methodsRequiringOffice = ['office_ip']) => (req, res, next) => {
  Promise.resolve()
    .then(async () => {
      const method = req.body?.method || 'web';
      const { allowRemoteLogin, officeCidr } = await settingsService.getEffectiveOfficeConfig(companyIdFromReq(req));
      const cidr = officeCidr || config.officeCidr;
      const clientIps = getClientIps(req);
      const clientIp = getClientIp(req) || clientIps[0] || '';
      req.clientIp = clientIp;
      req.clientIps = clientIps;

      if (methodsRequiringOffice.includes(method) && !allowRemoteLogin) {
        if (!anyIpInCidr(clientIps.length ? clientIps : [clientIp], cidr)) {
          throw new ForbiddenError('Office IP required for this check-in method');
        }
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
