const config = require('../config/database');
const { getTrustedClientIp, anyIpInCidr } = require('../utils/helpers');
const { ForbiddenError } = require('../utils/errors');
const logger = require('../utils/logger');
const settingsService = require('../services/settings.service');
const { getCompanyId, DEFAULT_COMPANY_ID } = require('../utils/tenant');

const companyIdFromReq = (req) =>
  req.user?.company_id || (req.user ? getCompanyId(req.user) : null) || DEFAULT_COMPANY_ID;

/**
 * Sets req.clientIp to the one IP we trust (helpers.getTrustedClientIp) and
 * req.clientIps to just that IP. Forwarded headers the client can type are
 * never added — matching any one of them used to pass the office check.
 */
const setClientIp = (req) => {
  const clientIp = getTrustedClientIp(req);
  req.clientIp = clientIp;
  req.clientIps = clientIp ? [clientIp] : [];
  return clientIp;
};

const validateOfficeIp = async (req, res, next) => {
  try {
    const clientIp = setClientIp(req);

    const { allowRemoteLogin, officeCidr } = await settingsService.getEffectiveOfficeConfig(companyIdFromReq(req));
    if (allowRemoteLogin) return next();

    const isOfficeIp = anyIpInCidr(req.clientIps, officeCidr || config.officeCidr);

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
  setClientIp(req);
  next();
};

const validateOfficeIpOptional = (req, res, next) => {
  Promise.resolve()
    .then(async () => {
      setClientIp(req);
      const { officeCidr } = await settingsService.getEffectiveOfficeConfig(companyIdFromReq(req));
      req.isOfficeIp = anyIpInCidr(req.clientIps, officeCidr || config.officeCidr);
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
      setClientIp(req);

      if (methodsRequiringOffice.includes(method) && !allowRemoteLogin) {
        if (!anyIpInCidr(req.clientIps, cidr)) {
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
